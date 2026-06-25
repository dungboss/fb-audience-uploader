import { createHash } from "node:crypto";

import { FacebookApiError } from "@/app/api/audiences/meta";
import { fetchWebDavFileHead, fetchWebDavFileRange } from "@/lib/webdav.server";

const NAS_CHUNK_BYTES = 1024 * 1024; // 1 MB per range request

export interface NasFileMeta {
  contentLength: number | null;
  contentType: string | null;
}

export async function getNasFileMeta(
  nasFilePath: string
): Promise<NasFileMeta> {
  const head = await fetchWebDavFileHead(nasFilePath);
  return {
    contentLength: head.contentLength,
    contentType: head.contentType,
  };
}

export async function* streamNasFileLines(
  nasFilePath: string
): AsyncGenerator<string[], void, void> {
  const head = await fetchWebDavFileHead(nasFilePath);

  if (head.contentLength === null) {
    throw new FacebookApiError(
      "NAS file không trả về Content-Length, không thể streaming.",
      502
    );
  }

  const totalBytes = head.contentLength;
  let offset = 0;
  let leftover = "";

  while (offset < totalBytes) {
    const end = Math.min(offset + NAS_CHUNK_BYTES - 1, totalBytes - 1);
    const buffer = await fetchWebDavFileRange(nasFilePath, offset, end);

    let chunk = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

    // Remove BOM from the first chunk
    if (offset === 0 && chunk.startsWith("\uFEFF")) {
      chunk = chunk.slice(1);
    }

    // Prepend leftover from previous chunk boundary
    const text = leftover + chunk;
    const lines = text.split("\n");

    // The last line may be incomplete (crosses chunk boundary)
    leftover = lines.pop() ?? "";

    offset = end + 1;

    if (lines.length > 0) {
      const hashes: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        const normalized = normalizeLineValue(trimmed);
        const hash = createHash("sha256").update(normalized).digest("hex");
        hashes.push(hash);
      }

      if (hashes.length > 0) {
        yield hashes;
      }
    }
  }

  // Process final leftover line
  if (leftover.trim().length > 0) {
    const normalized = normalizeLineValue(leftover.trim());
    const hash = createHash("sha256").update(normalized).digest("hex");
    yield [hash];
  }
}

function normalizeLineValue(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/\s+/g, "")
    .replaceAll(/[^\x20-\x7E\xC0-\xFF\xA0-\xFF]/g, "");
}