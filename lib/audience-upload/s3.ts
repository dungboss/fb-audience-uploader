import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { FacebookApiError } from "@/app/api/audiences/meta";

import { getAudienceUploadConfig } from "./env";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

declare global {
  var __audienceUploadS3__: S3Client | undefined;
}

export function getS3Client() {
  if (!globalThis.__audienceUploadS3__) {
    const config = getAudienceUploadConfig();

    globalThis.__audienceUploadS3__ = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    });
  }

  return globalThis.__audienceUploadS3__;
}

export function buildShardObjectKey(jobId: string, partIndex: number) {
  const { s3Prefix } = getAudienceUploadConfig();

  return `${s3Prefix}/${jobId}/parts/${String(partIndex).padStart(6, "0")}.json`;
}

export async function createShardUploadUrl(jobId: string, partIndex: number) {
  if (!Number.isInteger(partIndex) || partIndex < 0) {
    throw new FacebookApiError("Part index không hợp lệ.", 400);
  }

  const config = getAudienceUploadConfig();
  const objectKey = buildShardObjectKey(jobId, partIndex);
  const command = new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: objectKey,
    ContentType: "application/json",
  });
  const uploadUrl = await getSignedUrl(getS3Client(), command, {
    expiresIn: config.presignedUrlTtlSeconds,
  });

  return {
    objectKey,
    uploadUrl,
    expiresIn: config.presignedUrlTtlSeconds,
  };
}

export async function readShardHashes(objectKey: string) {
  const { s3Bucket } = getAudienceUploadConfig();
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: s3Bucket,
      Key: objectKey,
    })
  );
  const body = response.Body;

  if (!body) {
    throw new FacebookApiError("R2 shard không có dữ liệu để xử lý.", 502);
  }

  const payload =
    "transformToString" in body
      ? await body.transformToString()
      : await new Response(body as BodyInit).text();

  try {
    const parsedPayload = JSON.parse(payload) as unknown;
    return normalizeHashList(parsedPayload);
  } catch {
    throw new FacebookApiError("R2 shard chứa dữ liệu JSON không hợp lệ.", 502);
  }
}

export async function deleteShardObject(objectKey: string) {
  const { s3Bucket } = getAudienceUploadConfig();

  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: s3Bucket,
      Key: objectKey,
    })
  );
}

function normalizeHashList(input: unknown) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new FacebookApiError("Shard hash không hợp lệ hoặc đang trống.", 400);
  }

  const hashes = input.map((value) => String(value).trim().toLowerCase());
  const invalidHash = hashes.find((hash) => !HASH_PATTERN.test(hash));

  if (invalidHash) {
    throw new FacebookApiError(
      "R2 shard chứa dữ liệu không phải SHA-256 hợp lệ.",
      400
    );
  }

  return hashes;
}
