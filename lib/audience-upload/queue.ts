import { Queue } from "bullmq";

import { getAudienceUploadConfig } from "./env";
import { getBullConnectionOptions } from "./redis";
import type { AudienceUploadJobPayload } from "./types";

export const AUDIENCE_UPLOAD_QUEUE_JOB_NAME = "sync-meta-audience";

declare global {
  var __audienceUploadQueue__:
    | Queue<AudienceUploadJobPayload, unknown, string>
    | undefined;
}

export function getAudienceUploadQueue() {
  if (!globalThis.__audienceUploadQueue__) {
    const { jobAttempts, metaRateLimitDelayMs, queueName } =
      getAudienceUploadConfig();

    globalThis.__audienceUploadQueue__ = new Queue(queueName, {
      connection: getBullConnectionOptions(),
      defaultJobOptions: {
        attempts: jobAttempts,
        backoff: {
          type: "meta-aware",
          delay: metaRateLimitDelayMs,
        },
        removeOnComplete: 250,
        removeOnFail: 250,
      },
    });
  }

  return globalThis.__audienceUploadQueue__;
}

export async function enqueueAudienceUploadJob(jobId: string) {
  const queue = getAudienceUploadQueue();
  const existingJob = await queue.getJob(jobId);

  if (existingJob) {
    return existingJob;
  }

  return queue.add(
    AUDIENCE_UPLOAD_QUEUE_JOB_NAME,
    { jobId },
    {
      jobId,
    }
  );
}
