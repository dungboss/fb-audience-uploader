import { randomUUID } from "node:crypto";

import { FacebookApiError } from "@/app/api/audiences/meta";

import { getAudienceUploadConfig } from "./env";
import { getRedis } from "./redis";
import type {
  AudienceUploadJob,
  AudienceUploadJobKind,
  AudienceUploadPart,
  AudienceUploadJobStatus,
} from "./types";

const JOB_KEY_PREFIX = "audience-upload:job:";
const PARTS_KEY_PREFIX = "audience-upload:parts:";

export async function createAudienceUploadJob(input: {
  kind: AudienceUploadJobKind;
  fileName: string;
  name?: string;
  description?: string;
  audienceId?: string;
}) {
  const kind = input.kind;
  const fileName = input.fileName.trim();
  const name = input.name?.trim() ?? "";
  const description = input.description?.trim() ?? "";
  const audienceId = input.audienceId?.trim() ?? "";

  if (!fileName) {
    throw new FacebookApiError("Tên file upload không hợp lệ.", 400);
  }

  if (kind === "create" && !name) {
    throw new FacebookApiError("Tên đối tượng là bắt buộc.", 400);
  }

  if (kind === "append" && !audienceId) {
    throw new FacebookApiError("Audience ID không hợp lệ.", 400);
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();
  const job: AudienceUploadJob = {
    id: jobId,
    kind,
    status: "draft",
    name,
    description,
    fileName,
    audienceId: kind === "append" ? audienceId : null,
    receivedPartCount: 0,
    processedPartCount: 0,
    receivedHashCount: 0,
    syncedHashCount: 0,
    totalParts: null,
    totalHashes: null,
    duplicateCount: 0,
    invalidEntryCount: 0,
    lastSessionId: null,
    errorMessage: null,
    finalizedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await persistJob(job);
  await refreshJobExpiry(jobId);

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

export async function recordAudienceUploadPart(input: {
  jobId: string;
  partIndex: number;
  objectKey: string;
  hashCount: number;
}) {
  const job = await getAudienceUploadJob(input.jobId);

  if (job.finalizedAt) {
    throw new FacebookApiError("Upload job đã được finalize.", 409);
  }

  if (!Number.isInteger(input.partIndex) || input.partIndex < 0) {
    throw new FacebookApiError("Part index không hợp lệ.", 400);
  }

  if (!Number.isInteger(input.hashCount) || input.hashCount <= 0) {
    throw new FacebookApiError("Số hash của shard không hợp lệ.", 400);
  }

  if (!input.objectKey.trim()) {
    throw new FacebookApiError("Object key của shard không hợp lệ.", 400);
  }

  const redis = getRedis();
  const partKey = getPartsKey(job.id);
  const partField = String(input.partIndex);
  const serializedPart = JSON.stringify({
    partIndex: input.partIndex,
    objectKey: input.objectKey.trim(),
    hashCount: input.hashCount,
  } satisfies AudienceUploadPart);
  const inserted = await redis.hsetnx(partKey, partField, serializedPart);

  if (!inserted) {
    const existingPart = await redis.hget(partKey, partField);

    if (existingPart !== serializedPart) {
      throw new FacebookApiError(
        `Shard ${input.partIndex + 1} đã tồn tại với manifest khác.`,
        409
      );
    }

    return getAudienceUploadJob(job.id);
  }

  const now = new Date().toISOString();
  await redis
    .multi()
    .hincrby(getJobKey(job.id), "receivedPartCount", 1)
    .hincrby(getJobKey(job.id), "receivedHashCount", input.hashCount)
    .hset(getJobKey(job.id), {
      status: "uploading",
      updatedAt: now,
    })
    .expire(getJobKey(job.id), getAudienceUploadConfig().jobTtlSeconds)
    .expire(partKey, getAudienceUploadConfig().jobTtlSeconds)
    .exec();

  return getAudienceUploadJob(job.id);
}

export async function finalizeAudienceUploadJob(input: {
  jobId: string;
  totalParts: number;
  totalHashes: number;
  duplicateCount: number;
}) {
  const job = await getAudienceUploadJob(input.jobId);

  if (!Number.isInteger(input.totalParts) || input.totalParts <= 0) {
    throw new FacebookApiError("Tổng số shard không hợp lệ.", 400);
  }

  if (!Number.isInteger(input.totalHashes) || input.totalHashes <= 0) {
    throw new FacebookApiError("Tổng số hash không hợp lệ.", 400);
  }

  if (
    !Number.isInteger(input.duplicateCount) ||
    input.duplicateCount < 0
  ) {
    throw new FacebookApiError("Số lượng bản ghi trùng lặp không hợp lệ.", 400);
  }

  const redis = getRedis();
  const partCount = await redis.hlen(getPartsKey(job.id));

  if (partCount !== input.totalParts) {
    throw new FacebookApiError(
      "Số shard đã ack không khớp với manifest cuối cùng.",
      400
    );
  }

  if (job.receivedHashCount !== input.totalHashes) {
    throw new FacebookApiError(
      "Số hash đã ack không khớp với manifest cuối cùng.",
      400
    );
  }

  const now = new Date().toISOString();
  await redis.hset(getJobKey(job.id), {
    totalParts: String(input.totalParts),
    totalHashes: String(input.totalHashes),
    duplicateCount: String(input.duplicateCount),
    status: "queued",
    errorMessage: "",
    finalizedAt: now,
    updatedAt: now,
  });
  await refreshJobExpiry(job.id);

  return getAudienceUploadJob(job.id);
}

export async function listAudienceUploadParts(jobId: string) {
  const manifest = await getRedis().hgetall(getPartsKey(jobId));

  return Object.values(manifest)
    .map((value) => parsePartPayload(value))
    .sort((left, right) => left.partIndex - right.partIndex);
}

export async function patchAudienceUploadJob(
  jobId: string,
  patch: Partial<
    Pick<
      AudienceUploadJob,
      | "status"
      | "audienceId"
      | "errorMessage"
      | "finalizedAt"
      | "completedAt"
      | "lastSessionId"
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

export async function markAudienceUploadPartProcessed(input: {
  jobId: string;
  partIndex: number;
  syncedHashCount: number;
  invalidEntryCount: number;
  audienceId: string;
  lastSessionId?: string | null;
}) {
  const now = new Date().toISOString();

  await getRedis()
    .multi()
    .hdel(getPartsKey(input.jobId), String(input.partIndex))
    .hincrby(getJobKey(input.jobId), "processedPartCount", 1)
    .hincrby(getJobKey(input.jobId), "syncedHashCount", input.syncedHashCount)
    .hincrby(
      getJobKey(input.jobId),
      "invalidEntryCount",
      input.invalidEntryCount
    )
    .hset(getJobKey(input.jobId), {
      status: "processing",
      audienceId: input.audienceId,
      lastSessionId: input.lastSessionId ?? "",
      updatedAt: now,
    })
    .expire(getJobKey(input.jobId), getAudienceUploadConfig().jobTtlSeconds)
    .expire(getPartsKey(input.jobId), getAudienceUploadConfig().jobTtlSeconds)
    .exec();

  return getAudienceUploadJob(input.jobId);
}

export async function markAudienceUploadJobCompleted(jobId: string) {
  const now = new Date().toISOString();

  await getRedis().hset(getJobKey(jobId), {
    status: "completed",
    completedAt: now,
    updatedAt: now,
  });
  await refreshJobExpiry(jobId);

  return getAudienceUploadJob(jobId);
}

export async function markAudienceUploadJobFailed(
  jobId: string,
  errorMessage: string
) {
  const now = new Date().toISOString();

  await getRedis().hset(getJobKey(jobId), {
    status: "failed",
    errorMessage,
    updatedAt: now,
  });
  await refreshJobExpiry(jobId);

  return getAudienceUploadJob(jobId);
}

async function persistJob(job: AudienceUploadJob) {
  await getRedis().hset(getJobKey(job.id), toRedisHashPatch(job));
}

async function refreshJobExpiry(jobId: string) {
  const ttlSeconds = getAudienceUploadConfig().jobTtlSeconds;
  await getRedis()
    .multi()
    .expire(getJobKey(jobId), ttlSeconds)
    .expire(getPartsKey(jobId), ttlSeconds)
    .exec();
}

function parseJobPayload(jobId: string, payload: Record<string, string>) {
  return {
    id: jobId,
    kind: parseEnum(payload.kind, ["create", "append"], "create"),
    status: parseEnum(
      payload.status,
      ["draft", "uploading", "queued", "processing", "completed", "failed"],
      "draft"
    ) as AudienceUploadJobStatus,
    name: payload.name ?? "",
    description: payload.description ?? "",
    fileName: payload.fileName ?? "",
    audienceId: payload.audienceId || null,
    receivedPartCount: parseInteger(payload.receivedPartCount),
    processedPartCount: parseInteger(payload.processedPartCount),
    receivedHashCount: parseInteger(payload.receivedHashCount),
    syncedHashCount: parseInteger(payload.syncedHashCount),
    totalParts: parseNullableInteger(payload.totalParts),
    totalHashes: parseNullableInteger(payload.totalHashes),
    duplicateCount: parseInteger(payload.duplicateCount),
    invalidEntryCount: parseInteger(payload.invalidEntryCount),
    lastSessionId: payload.lastSessionId || null,
    errorMessage: payload.errorMessage || null,
    finalizedAt: payload.finalizedAt || null,
    completedAt: payload.completedAt || null,
    createdAt: payload.createdAt ?? new Date(0).toISOString(),
    updatedAt: payload.updatedAt ?? new Date(0).toISOString(),
  } satisfies AudienceUploadJob;
}

function parsePartPayload(payload: string) {
  try {
    const part = JSON.parse(payload) as AudienceUploadPart;

    if (
      !Number.isInteger(part.partIndex) ||
      part.partIndex < 0 ||
      !part.objectKey ||
      !Number.isInteger(part.hashCount) ||
      part.hashCount <= 0
    ) {
      throw new Error("invalid");
    }

    return part;
  } catch {
    throw new FacebookApiError("Manifest shard trong Redis không hợp lệ.", 500);
  }
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

function getPartsKey(jobId: string) {
  return `${PARTS_KEY_PREFIX}${jobId}`;
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
