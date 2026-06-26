import { randomUUID } from "node:crypto";

import { FacebookApiError } from "@/app/api/audiences/meta";

import { getAudienceUploadConfig } from "./env";
import { getRedis } from "./redis";
import type {
  AudienceUploadJob,
  AudienceUploadJobKind,
  AudienceUploadJobStatus,
} from "./types";

const JOB_KEY_PREFIX = "audience-upload:job:";
const JOB_INDEX_KEY = "audience-upload:job-index";
const RECENT_JOBS_KEY = "audience-upload:recent-jobs";
const MAX_RECENT_JOBS = 20;

export async function createAudienceUploadJob(input: {
  kind: AudienceUploadJobKind;
  nasFilePath: string;
  name?: string;
  description?: string;
  audienceId?: string;
  fileSize?: number | null;
}) {
  const kind = input.kind;
  const nasFilePath = input.nasFilePath.trim();
  const name = input.name?.trim() ?? "";
  const description = input.description?.trim() ?? "";
  const audienceId = input.audienceId?.trim() ?? "";

  if (!nasFilePath) {
    throw new FacebookApiError("Đường dẫn file trên NAS không hợp lệ.", 400);
  }

  if (kind === "create" && !name) {
    throw new FacebookApiError("Tên đối tượng là bắt buộc.", 400);
  }

  if (kind === "append" && !audienceId) {
    throw new FacebookApiError("Audience ID không hợp lệ.", 400);
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();
  const fileName = nasFilePath.split("/").filter(Boolean).pop() ?? nasFilePath;

  const job: AudienceUploadJob = {
    id: jobId,
    kind,
    status: "queued",
    name,
    description,
    nasFilePath,
    fileName,
    fileSize: typeof input.fileSize === "number" && input.fileSize > 0 ? input.fileSize : null,
    audienceId: kind === "append" ? audienceId : null,
    syncedHashCount: 0,
    syncedLines: 0,
    processedLines: 0,
    processedBytes: 0,
    totalLines: null,
    totalBytes: null,
    lastSessionId: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };

  await persistJob(job);
  await refreshJobExpiry(jobId);
  await pushToRecentJobs(jobId);

  return job;
}

export async function getAudienceUploadJob(jobId: string) {
  const normalizedJobId = jobId.trim();

  if (!normalizedJobId) {
    throw new FacebookApiError("Job ID không hợp lệ.", 400);
  }

  const payload = await getRedis().hgetall(getJobKey(normalizedJobId));

  if (Object.keys(payload).length === 0) {
    throw new FacebookApiError("Không tìm thấy upload job.", 404);
  }

  return parseJobPayload(normalizedJobId, payload);
}

export async function patchAudienceUploadJob(
  jobId: string,
  patch: Partial<
    Pick<
      AudienceUploadJob,
      | "status"
      | "audienceId"
      | "processedLines"
      | "processedBytes"
      | "totalLines"
      | "totalBytes"
      | "syncedHashCount"
      | "syncedLines"
      | "lastSessionId"
      | "errorMessage"
      | "updatedAt"
    >
  >
) {
  const payload = toRedisHashPatch(patch);

  if (Object.keys(payload).length === 0) {
    return getAudienceUploadJob(jobId);
  }

  await getRedis().hset(getJobKey(jobId), payload);
  await refreshJobExpiry(jobId);

  return getAudienceUploadJob(jobId);
}

export async function markAudienceUploadJobCompleted(jobId: string) {
  await getRedis().hset(getJobKey(jobId), {
    status: "completed",
    updatedAt: new Date().toISOString(),
  });
  await refreshJobExpiry(jobId);

  return getAudienceUploadJob(jobId);
}

export async function markAudienceUploadJobFailed(
  jobId: string,
  errorMessage: string
) {
  await getRedis().hset(getJobKey(jobId), {
    status: "failed",
    errorMessage,
    updatedAt: new Date().toISOString(),
  });
  await refreshJobExpiry(jobId);

  return getAudienceUploadJob(jobId);
}

export async function cancelAudienceUploadJob(jobId: string) {
  const normalizedJobId = jobId.trim();

  if (!normalizedJobId) {
    throw new FacebookApiError("Job ID không hợp lệ.", 400);
  }

  const existing = await getAudienceUploadJob(normalizedJobId);

  if (existing.status !== "queued" && existing.status !== "processing") {
    // Job already reached a terminal state — return as-is silently
    return existing;
  }

  await getRedis().hset(getJobKey(normalizedJobId), {
    status: "cancelled",
    updatedAt: new Date().toISOString(),
  });
  await refreshJobExpiry(normalizedJobId);

  return getAudienceUploadJob(normalizedJobId);
}

async function persistJob(job: AudienceUploadJob) {
  await getRedis().hset(getJobKey(job.id), toRedisHashPatch(job));
}

async function refreshJobExpiry(jobId: string) {
  const ttlSeconds = getAudienceUploadConfig().jobTtlSeconds;
  await getRedis().expire(getJobKey(jobId), ttlSeconds);
}

function parseJobPayload(jobId: string, payload: Record<string, string>) {
  return {
    id: jobId,
    kind: parseEnum(payload.kind, ["create", "append"], "create"),
    status: parseEnum(
      payload.status,
      ["draft", "queued", "processing", "completed", "failed", "cancelled"],
      "draft"
    ) as AudienceUploadJobStatus,
    name: payload.name ?? "",
    description: payload.description ?? "",
    nasFilePath: payload.nasFilePath ?? "",
    fileName: payload.fileName ?? "",
    fileSize: parseNullableInteger(payload.fileSize),
    audienceId: payload.audienceId || null,
    syncedHashCount: parseInteger(payload.syncedHashCount),
    syncedLines: parseInteger(payload.syncedLines),
    processedLines: parseInteger(payload.processedLines),
    processedBytes: parseInteger(payload.processedBytes),
    totalLines: parseNullableInteger(payload.totalLines),
    totalBytes: parseNullableInteger(payload.totalBytes),
    lastSessionId: payload.lastSessionId || null,
    errorMessage: payload.errorMessage || null,
    createdAt: payload.createdAt ?? new Date(0).toISOString(),
    updatedAt: payload.updatedAt ?? new Date(0).toISOString(),
  } satisfies AudienceUploadJob;
}

function toRedisHashPatch(
  payload: Partial<Record<keyof AudienceUploadJob, string | number | null>>
) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      value === null ? "" : String(value),
    ])
  );
}

function getJobKey(jobId: string) {
  return `${JOB_KEY_PREFIX}${jobId}`;
}

function parseInteger(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullableInteger(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEnum<T extends string>(
  value: string | undefined,
  allowedValues: readonly T[],
  fallback: T
) {
  if (value && allowedValues.includes(value as T)) {
    return value as T;
  }

  return fallback;
}

async function pushToRecentJobs(jobId: string) {
  await getRedis().lpush(RECENT_JOBS_KEY, jobId);
  await getRedis().ltrim(RECENT_JOBS_KEY, 0, MAX_RECENT_JOBS - 1);
}

export async function listRecentAudienceUploadJobs() {
  const jobIds = await getRedis().lrange(RECENT_JOBS_KEY, 0, -1);

  if (jobIds.length === 0) {
    return [];
  }

  const pipeline = getRedis().pipeline();
  for (const id of jobIds) {
    pipeline.hgetall(getJobKey(id));
  }

  const results = (await pipeline.exec()) as [Error | null, Record<string, string>][];

  return results
    .map(([error, payload], index) => {
      if (error || !payload || Object.keys(payload).length === 0) {
        return null;
      }

      return parseJobPayload(jobIds[index], payload);
    })
    .filter((job): job is AudienceUploadJob => job !== null);
}