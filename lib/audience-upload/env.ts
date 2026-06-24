import { FacebookApiError } from "@/app/api/audiences/meta";

const DEFAULT_QUEUE_NAME = "audience-upload-sync";
const DEFAULT_SHARD_TEMP_DIR = "/temp/fb-audience-uploader";

export interface AudienceUploadConfig {
  redisUrl: string;
  queueName: string;
  shardTempDir: string;
  jobTtlSeconds: number;
  presignedUrlTtlSeconds: number;
  jobAttempts: number;
  workerConcurrency: number;
  workerRateLimitMax: number;
  workerRateLimitDurationMs: number;
  metaRequestIntervalMs: number;
  metaRateLimitDelayMs: number;
  metaBatchSize: number;
  webdavUsername?: string;
  webdavPassword?: string;
}

let cachedConfig: AudienceUploadConfig | null = null;

export function getAudienceUploadConfig(): AudienceUploadConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const redisUrl = readRequiredEnv("REDIS_URL");

  cachedConfig = {
    redisUrl,
    queueName: readOptionalEnv("UPLOAD_JOB_QUEUE_NAME") ?? DEFAULT_QUEUE_NAME,
    shardTempDir:
      readOptionalEnv("UPLOAD_JOB_NAS_TEMP_DIR") ?? DEFAULT_SHARD_TEMP_DIR,
    jobTtlSeconds: readNumberEnv("UPLOAD_JOB_TTL_SECONDS", 24 * 60 * 60),
    presignedUrlTtlSeconds: readNumberEnv("UPLOAD_PRESIGN_TTL_SECONDS", 15 * 60),
    jobAttempts: readNumberEnv("UPLOAD_JOB_ATTEMPTS", 168),
    workerConcurrency: readNumberEnv("UPLOAD_WORKER_CONCURRENCY", 1),
    workerRateLimitMax: readNumberEnv("UPLOAD_WORKER_RATE_LIMIT_MAX", 1),
    workerRateLimitDurationMs: readNumberEnv(
      "UPLOAD_WORKER_RATE_LIMIT_DURATION_MS",
      1_000
    ),
    metaRequestIntervalMs: readNumberEnv(
      "UPLOAD_META_REQUEST_INTERVAL_MS",
      1_000
    ),
    metaRateLimitDelayMs: readNumberEnv(
      "UPLOAD_META_RATE_LIMIT_DELAY_MS",
      60 * 60 * 1_000
    ),
    metaBatchSize: readNumberEnv("UPLOAD_META_BATCH_SIZE", 10_000),
    webdavUsername: readOptionalEnv("WEBDAV_USERNAME"),
    webdavPassword: readOptionalEnv("WEBDAV_PASSWORD"),
  };

  return cachedConfig;
}

function readRequiredEnv(variableName: string) {
  const value = process.env[variableName]?.trim();

  if (!value) {
    throw new FacebookApiError(
      `Thiếu biến môi trường ${variableName} cho luồng upload production.`,
      500
    );
  }

  return value;
}

function readOptionalEnv(variableName: string) {
  const value = process.env[variableName]?.trim();
  return value || undefined;
}

function readNumberEnv(variableName: string, fallback: number) {
  const rawValue = readOptionalEnv(variableName);

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new FacebookApiError(
      `Biến môi trường ${variableName} phải là số nguyên dương.`,
      500
    );
  }

  return parsedValue;
}
