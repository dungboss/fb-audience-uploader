import { Worker } from "bullmq";

import {
  createEmptyAudience,
  isFacebookRateLimitError,
  uploadHashedUsers,
} from "../app/api/audiences/meta";
import { getAudienceUploadConfig } from "../lib/audience-upload/env";
import {
  getAudienceUploadJob,
  listAudienceUploadParts,
  markAudienceUploadJobCompleted,
  markAudienceUploadJobFailed,
  markAudienceUploadPartProcessed,
  patchAudienceUploadJob,
} from "../lib/audience-upload/jobs";
import {
  getBullConnectionOptions,
  getRedis,
} from "../lib/audience-upload/redis";
import { deleteShardObject, readShardHashes } from "../lib/audience-upload/s3";
import type { AudienceUploadJobPayload } from "../lib/audience-upload/types";

const FACEBOOK_MAX_HASHES_PER_SECOND = 10_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const META_REQUEST_THROTTLE_KEY = "audience-upload:meta-request-throttle";

async function main() {
  const config = getAudienceUploadConfig();
  const worker = new Worker<AudienceUploadJobPayload>(
    config.queueName,
    async (bullJob) => {
      const { jobId } = bullJob.data;
      let uploadJob = await getAudienceUploadJob(jobId);

      if (uploadJob.status === "completed") {
        return {
          jobId,
          audienceId: uploadJob.audienceId,
          syncedHashCount: uploadJob.syncedHashCount,
        };
      }

      await patchAudienceUploadJob(jobId, {
        status: "processing",
        errorMessage: "",
        updatedAt: new Date().toISOString(),
      });
      uploadJob = await getAudienceUploadJob(jobId);

      let audienceId = uploadJob.audienceId;

      if (uploadJob.kind === "create" && !audienceId) {
        const createdAudience = await retryMetaAware(() =>
          createEmptyAudience({
            name: uploadJob.name,
            description: uploadJob.description,
          })
        );

        audienceId = createdAudience.id;
        await patchAudienceUploadJob(jobId, {
          audienceId,
          status: "processing",
          updatedAt: new Date().toISOString(),
        });
      }

      if (!audienceId) {
        throw new Error("Worker chưa có audienceId để sync dữ liệu lên Meta.");
      }

      const parts = await listAudienceUploadParts(jobId);

      for (const part of parts) {
        const hashes = await readShardHashes(part.objectKey);
        const syncResult = await syncHashesToMeta(audienceId, hashes);

        await deleteShardObject(part.objectKey);
        uploadJob = await markAudienceUploadPartProcessed({
          jobId,
          partIndex: part.partIndex,
          syncedHashCount: syncResult.uploadedCount,
          invalidEntryCount: syncResult.invalidEntryCount,
          audienceId,
          lastSessionId: syncResult.lastSessionId,
        });

        await bullJob.updateProgress({
          processedParts: uploadJob.processedPartCount,
          totalParts: uploadJob.totalParts ?? uploadJob.receivedPartCount,
          syncedHashCount: uploadJob.syncedHashCount,
        });
      }

      uploadJob = await markAudienceUploadJobCompleted(jobId);

      return {
        jobId,
        audienceId: uploadJob.audienceId,
        syncedHashCount: uploadJob.syncedHashCount,
      };
    },
    {
      connection: getBullConnectionOptions(),
      concurrency: config.workerConcurrency,
      limiter: {
        max: config.workerRateLimitMax,
        duration: config.workerRateLimitDurationMs,
      },
      settings: {
        backoffStrategy: (attemptsMade, type, error) => {
          if (type !== "meta-aware") {
            return DEFAULT_RETRY_DELAY_MS;
          }

          if (isMetaRateLimitRetryError(error)) {
            return config.metaRateLimitDelayMs;
          }

          return Math.min(
            DEFAULT_RETRY_DELAY_MS * 2 ** Math.max(attemptsMade - 1, 0),
            config.metaRateLimitDelayMs
          );
        },
      },
    }
  );

  worker.on("completed", (bullJob) => {
    console.info(
      `[audience-upload-worker] completed ${bullJob.id} for upload job ${bullJob.data.jobId}`
    );
  });

  worker.on("failed", async (bullJob, error) => {
    const jobId = bullJob?.data?.jobId;

    if (jobId) {
      if (bullJob && shouldRetryLater(bullJob, error)) {
        await patchAudienceUploadJob(jobId, {
          status: "queued",
          errorMessage: buildRetryMessage(error),
          updatedAt: new Date().toISOString(),
        });
      } else {
        await markAudienceUploadJobFailed(jobId, error.message);
      }
    }

    console.error(
      `[audience-upload-worker] failed ${bullJob?.id ?? "unknown"}: ${error.message}`
    );
  });

  const shutdown = async (signal: string) => {
    console.info(`[audience-upload-worker] shutting down on ${signal}`);
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  console.info(
    `[audience-upload-worker] listening queue=${config.queueName} concurrency=${config.workerConcurrency}`
  );
}

async function syncHashesToMeta(audienceId: string, hashes: string[]) {
  const { metaBatchSize, metaRequestIntervalMs } = getAudienceUploadConfig();
  const effectiveBatchSize = Math.min(
    metaBatchSize,
    FACEBOOK_MAX_HASHES_PER_SECOND
  );
  let uploadedCount = 0;
  let invalidEntryCount = 0;
  let lastSessionId: string | null = null;

  for (let index = 0; index < hashes.length; index += effectiveBatchSize) {
    const batch = hashes.slice(index, index + effectiveBatchSize);
    await acquireMetaRequestSlot(metaRequestIntervalMs);

    const result = await retryMetaAware(() => uploadHashedUsers(audienceId, batch));
    uploadedCount += result.num_received ?? batch.length;
    invalidEntryCount += result.num_invalid_entries ?? 0;
    lastSessionId = result.session_id ?? lastSessionId;
  }

  return {
    uploadedCount,
    invalidEntryCount,
    lastSessionId,
  };
}

async function retryMetaAware<T>(callback: () => Promise<T>) {
  try {
    return await callback();
  } catch (error) {
    if (isFacebookRateLimitError(error)) {
      throw new MetaRateLimitRetryError(
        "Facebook rate limit reached. Worker se thu lai sau 1 gio."
      );
    }

    throw error;
  }
}

async function acquireMetaRequestSlot(intervalMs: number) {
  const redis = getRedis();

  while (true) {
    const acquired = await redis.set(
      META_REQUEST_THROTTLE_KEY,
      String(Date.now()),
      "PX",
      intervalMs,
      "NX"
    );

    if (acquired === "OK") {
      return;
    }

    const retryAfterMs = await redis.pttl(META_REQUEST_THROTTLE_KEY);
    await waitFor(retryAfterMs > 0 ? retryAfterMs : 100);
  }
}

class MetaRateLimitRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaRateLimitRetryError";
  }
}

function isMetaRateLimitRetryError(error: unknown) {
  return error instanceof Error && error.name === "MetaRateLimitRetryError";
}

function shouldRetryLater(
  bullJob: { attemptsMade: number; opts: { attempts?: number } },
  error: Error
) {
  const maxAttempts = bullJob.opts.attempts ?? 1;
  return isMetaRateLimitRetryError(error) && bullJob.attemptsMade < maxAttempts;
}

function buildRetryMessage(error: Error) {
  if (isMetaRateLimitRetryError(error)) {
    const retryAt = new Date(
      Date.now() + getAudienceUploadConfig().metaRateLimitDelayMs
    ).toLocaleString("vi-VN");
    return `Facebook dang gioi han toc do. Worker se gui tiep sau ${retryAt}.`;
  }

  return error.message;
}

function waitFor(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

void main().catch((error) => {
  console.error("[audience-upload-worker] fatal", error);
  process.exit(1);
});
