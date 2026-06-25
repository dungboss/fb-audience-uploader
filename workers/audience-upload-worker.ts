import { Worker } from "bullmq";

import {
  createEmptyAudience,
  isFacebookRateLimitError,
  uploadHashedUsers,
} from "../app/api/audiences/meta";
import { getAudienceUploadConfig } from "../lib/audience-upload/env";
import {
  getAudienceUploadJob,
  markAudienceUploadJobCompleted,
  markAudienceUploadJobFailed,
  patchAudienceUploadJob,
} from "../lib/audience-upload/jobs";
import {
  getBullConnectionOptions,
  getRedis,
} from "../lib/audience-upload/redis";
import {
  getNasFileMeta,
  streamNasFileLines,
} from "../lib/audience-upload/storage";
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

      // Create audience if needed
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

      // Get file metadata
      const fileMeta = await getNasFileMeta(uploadJob.nasFilePath);
      console.info(
        `[audience-upload-worker] nas file ${uploadJob.nasFilePath}, content-length=${fileMeta.contentLength} (jobId=${jobId})`
      );

      // Sync hashes while streaming from NAS
      const totalBytes = fileMeta.contentLength ?? 0;
      const result = await syncLinesFromNas(
        audienceId,
        uploadJob.nasFilePath,
        totalBytes,
        jobId,
        async (progress) => {
          await patchAudienceUploadJob(jobId, {
            processedLines: progress.processedLines,
            processedBytes: progress.processedBytes,
            syncedHashCount: progress.syncedHashCount,
            syncedLines: progress.syncedLines,
            totalBytes: totalBytes > 0 ? totalBytes : null,
            lastSessionId: progress.lastSessionId,
            updatedAt: new Date().toISOString(),
          });

          await bullJob.updateProgress({
            processedLines: progress.processedLines,
            processedBytes: progress.processedBytes,
            totalBytes: totalBytes > 0 ? totalBytes : undefined,
            syncedHashCount: progress.syncedHashCount,
          });
        }
      );

      // Final update
      await patchAudienceUploadJob(jobId, {
        processedLines: result.processedLines,
        processedBytes: result.processedBytes,
        syncedHashCount: result.syncedHashCount,
        syncedLines: result.syncedLines,
        totalLines: result.processedLines,
        totalBytes: totalBytes > 0 ? totalBytes : null,
        lastSessionId: result.lastSessionId,
        updatedAt: new Date().toISOString(),
      });

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
    const bullJobId = bullJob?.id ?? "unknown";
    const attemptsMade = bullJob?.attemptsMade ?? 0;
    const maxAttempts = bullJob?.opts?.attempts ?? 1;

    console.error(
      `[audience-upload-worker] failed ${bullJobId} (jobId=${jobId}, attempts=${attemptsMade}/${maxAttempts}): ${error.message}`,
      error.stack ? `\n${error.stack}` : ""
    );

    if (jobId) {
      if (bullJob && shouldRetryLater(bullJob, error)) {
        const retryMessage = buildRetryMessage(error);
        console.info(
          `[audience-upload-worker] retrying ${bullJobId} later (attempt ${attemptsMade}/${maxAttempts}): ${retryMessage}`
        );
        await patchAudienceUploadJob(jobId, {
          status: "queued",
          errorMessage: retryMessage,
          updatedAt: new Date().toISOString(),
        });
      } else {
        console.error(
          `[audience-upload-worker] permanently failing ${bullJobId} (attempt ${attemptsMade}/${maxAttempts} exhausted): ${error.message}`
        );
        await markAudienceUploadJobFailed(jobId, error.message);
      }
    }
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

interface SyncProgress {
  processedLines: number;
  processedBytes: number;
  syncedHashCount: number;
  syncedLines: number;
  lastSessionId: string | null;
}

async function syncLinesFromNas(
  audienceId: string,
  nasFilePath: string,
  totalBytes: number,
  jobId: string,
  onProgress: (progress: SyncProgress) => Promise<void>
) {
  const { metaBatchSize, metaRequestIntervalMs } = getAudienceUploadConfig();
  const effectiveBatchSize = Math.min(
    metaBatchSize,
    FACEBOOK_MAX_HASHES_PER_SECOND
  );

  let processedLines = 0;
  let processedBytes = 0;
  let syncedHashCount = 0;
  let syncedLines = 0;
  let lastSessionId: string | null = null;

  // Accumulate hashes across stream yields until we reach batch size
  let accumulator: string[] = [];

  for await (const { hashes, bytesRead } of streamNasFileLines(nasFilePath)) {
    processedLines += hashes.length;
    processedBytes += bytesRead;
    accumulator.push(...hashes);

    // Flush accumulator in batches
    while (accumulator.length >= effectiveBatchSize) {
      const batch = accumulator.splice(0, effectiveBatchSize);

      await acquireMetaRequestSlot(metaRequestIntervalMs);

      const result = await retryMetaAware(() =>
        uploadHashedUsers(audienceId, batch)
      );
      syncedHashCount += result.num_received ?? batch.length;
      syncedLines += batch.length;
      lastSessionId = result.session_id ?? lastSessionId;

      await onProgress({
        processedLines,
        processedBytes,
        syncedHashCount,
        syncedLines,
        lastSessionId,
      });
    }
  }

  // Flush remaining accumulator
  if (accumulator.length > 0) {
    await acquireMetaRequestSlot(metaRequestIntervalMs);

    const result = await retryMetaAware(() =>
      uploadHashedUsers(audienceId, accumulator)
    );
    syncedHashCount += result.num_received ?? accumulator.length;
    syncedLines += accumulator.length;
    lastSessionId = result.session_id ?? lastSessionId;

    await onProgress({
      processedLines,
      processedBytes,
      syncedHashCount,
      syncedLines,
      lastSessionId,
    });
  }

  return {
    processedLines,
    processedBytes,
    syncedHashCount,
    syncedLines,
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