import { FacebookApiError } from "@/app/api/audiences/meta";
import {
  deleteWebDavFile,
  writeTextToWebDav,
} from "@/lib/webdav.server";

import { getAudienceUploadConfig } from "./env";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function buildShardObjectKey(jobId: string, partIndex: number) {
  const { shardTempDir } = getAudienceUploadConfig();

  return `${shardTempDir}/${jobId}/parts/${String(partIndex).padStart(6, "0")}.json`;
}

export async function createShardUploadUrl(
  jobId: string,
  partIndex: number
): Promise<{ objectKey: string; uploadUrl: string; expiresIn: number }> {
  if (!Number.isInteger(partIndex) || partIndex < 0) {
    throw new FacebookApiError("Part index không hợp lệ.", 400);
  }

  const config = getAudienceUploadConfig();
  const objectKey = buildShardObjectKey(jobId, partIndex);

  return {
    objectKey,
    uploadUrl: `/api/upload-jobs/${jobId}/parts/upload?partIndex=${partIndex}`,
    expiresIn: config.presignedUrlTtlSeconds,
  };
}

export async function writeShardHashes(
  objectKey: string,
  content: string
): Promise<void> {
  await writeTextToWebDav(objectKey, content);
}

export async function readShardHashes(objectKey: string): Promise<string[]> {
  const config = getAudienceUploadConfig();

  const response = await fetch(
    buildShardReadUrl(objectKey),
    {
      method: "GET",
      headers: {
        ...getShardReadHeaders(config),
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new FacebookApiError(
      `Không thể đọc shard từ NAS temp (${response.status}).`,
      502
    );
  }

  const payload = await response.text();

  try {
    const parsedPayload = JSON.parse(payload) as unknown;
    return normalizeHashList(parsedPayload);
  } catch {
    throw new FacebookApiError(
      "NAS temp shard chứa dữ liệu JSON không hợp lệ.",
      502
    );
  }
}

export async function deleteShardObject(objectKey: string): Promise<void> {
  await deleteWebDavFile(objectKey);
}

function normalizeHashList(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new FacebookApiError("Shard hash không hợp lệ hoặc đang trống.", 400);
  }

  const hashes = input.map((value) => String(value).trim().toLowerCase());
  const invalidHash = hashes.find((hash) => !HASH_PATTERN.test(hash));

  if (invalidHash) {
    throw new FacebookApiError(
      "NAS temp shard chứa dữ liệu không phải SHA-256 hợp lệ.",
      400
    );
  }

  return hashes;
}

function buildShardReadUrl(objectKey: string): string {
  const baseUrl = process.env.WEBDAV_BASE_URL?.trim() || "https://nas-api.batmedia.info/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const encoded = objectKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${normalizedBase}${encoded}`;
}

function getShardReadHeaders(
  config: ReturnType<typeof getAudienceUploadConfig>
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (config.webdavUsername && config.webdavPassword) {
    headers.Authorization = `Basic ${Buffer.from(
      `${config.webdavUsername}:${config.webdavPassword}`
    ).toString("base64")}`;
  }

  return headers;
}