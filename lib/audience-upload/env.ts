import { FacebookApiError } from "@/app/api/audiences/meta";

const DEFAULT_QUEUE_NAME = "audience-upload-sync";
const DEFAULT_S3_PREFIX = "audience-uploads";
const DEFAULT_R2_REGION = "auto";

export interface AudienceUploadConfig {
  redisUrl: string;
  queueName: string;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string;
  s3Prefix: string;
  jobTtlSeconds: number;
  presignedUrlTtlSeconds: number;
  jobAttempts: number;
  workerConcurrency: number;
  workerRateLimitMax: number;
  workerRateLimitDurationMs: number;
  metaRequestIntervalMs: number;
  metaRateLimitDelayMs: number;
  metaBatchSize: number;
  accessKeyId?: string;
  secretAccessKey?: string;
}

let cachedConfig: AudienceUploadConfig | null = null;

export function getAudienceUploadConfig(): AudienceUploadConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const redisUrl = readRequiredEnv("REDIS_URL");
  const r2AccountId = readOptionalEnv("R2_ACCOUNT_ID");
  const s3Bucket = pickRequiredEnv(["R2_BUCKET", "AWS_S3_BUCKET"]);
  const s3Region =
    readOptionalEnv("R2_REGION") ??
    readOptionalEnv("AWS_REGION") ??
    DEFAULT_R2_REGION;
  const s3Endpoint =
    readOptionalEnv("R2_ENDPOINT") ??
    (r2AccountId
      ? `https://${r2AccountId}.r2.cloudflarestorage.com`
      : undefined) ??
    readOptionalEnv("AWS_S3_ENDPOINT");

  cachedConfig = {
    redisUrl,
    queueName: readOptionalEnv("UPLOAD_JOB_QUEUE_NAME") ?? DEFAULT_QUEUE_NAME,
    s3Bucket,
    s3Region,
    s3Endpoint: s3Endpoint ?? "",
    s3Prefix: readOptionalEnv("UPLOAD_JOB_S3_PREFIX") ?? DEFAULT_S3_PREFIX,
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
    accessKeyId:
      readOptionalEnv("R2_ACCESS_KEY_ID") ?? readOptionalEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey:
      readOptionalEnv("R2_SECRET_ACCESS_KEY") ??
      readOptionalEnv("AWS_SECRET_ACCESS_KEY"),
  };

  if (!cachedConfig.s3Endpoint) {
    throw new FacebookApiError(
      "Thiếu R2 endpoint. Hãy cung cấp R2_ACCOUNT_ID hoặc R2_ENDPOINT.",
      500
    );
  }

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

function pickRequiredEnv(variableNames: string[]) {
  for (const variableName of variableNames) {
    const value = readOptionalEnv(variableName);

    if (value) {
      return value;
    }
  }

  throw new FacebookApiError(
    `Thiếu một trong các biến môi trường: ${variableNames.join(", ")}.`,
    500
  );
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
