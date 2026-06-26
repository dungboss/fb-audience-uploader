import { createHash } from "node:crypto";

import {
  fetchWebDavFileHead,
  fetchWebDavFileRange,
  fetchWebDavFileStream,
} from "@/lib/webdav.server";

const NAS_CHUNK_BYTES = 10 * 1024 * 1024; // 10 MB per range request

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

export interface StreamChunk {
  hashes: string[];
  bytesRead: number;
}

export interface StreamNasFileLinesOptions {
  /**
   * Known file size from PROPFIND listing (used for progress % when
   * the server doesn't return Content-Length on HEAD requests).
   */
  knownSize?: number | null;
}

export async function* streamNasFileLines(
  nasFilePath: string,
  options: StreamNasFileLinesOptions = {}
): AsyncGenerator<StreamChunk, void, void> {
  const head = await fetchWebDavFileHead(nasFilePath);

  // Prefer PROPFIND size over HEAD Content-Length for progress display
  const knownSize = options.knownSize ?? head.contentLength;

  // When server returns Content-Length, use range requests (efficient, resumable)
  if (head.contentLength !== null) {
    yield* streamViaRangeRequests(nasFilePath, head.contentLength);
    return;
  }

  // Fallback: server didn't return Content-Length — stream the whole file
  yield* streamViaFullRead(nasFilePath, knownSize);
}

async function* streamViaRangeRequests(
  nasFilePath: string,
  totalBytes: number
): AsyncGenerator<StreamChunk, void, void> {
  let offset = 0;
  let leftover = "";

  while (offset < totalBytes) {
    const end = Math.min(offset + NAS_CHUNK_BYTES - 1, totalBytes - 1);
    const buffer = await fetchWebDavFileRange(nasFilePath, offset, end);
    const chunkBytes = buffer.byteLength;

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
      const hashed = hashLines(lines);
      if (hashed.length > 0) {
        yield { hashes: hashed, bytesRead: chunkBytes };
      }
    }
  }

  // Process final leftover line
  if (leftover.trim().length > 0) {
    const normalized = normalizeLineValue(leftover.trim());
    const hash = createHash("sha256").update(normalized).digest("hex");
    yield { hashes: [hash], bytesRead: 0 };
  }
}

async function* streamViaFullRead(
  nasFilePath: string,
  knownSize: number | null
): AsyncGenerator<StreamChunk, void, void> {
  const stream = await fetchWebDavFileStream(nasFilePath);
  const reader = stream.getReader();
  let leftover = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunkBytes = value.byteLength;
      let chunk = new TextDecoder("utf-8", { fatal: false }).decode(value);

      // Prepend leftover from previous chunk boundary
      const text = leftover + chunk;
      const lines = text.split("\n");

      // The last line may be incomplete
      leftover = lines.pop() ?? "";

      if (lines.length > 0) {
        const hashed = hashLines(lines);
        if (hashed.length > 0) {
          yield { hashes: hashed, bytesRead: chunkBytes };
        }
      }
    }

    // Process final leftover line
    if (leftover.trim().length > 0) {
      const normalized = normalizeLineValue(leftover.trim());
      const hash = createHash("sha256").update(normalized).digest("hex");
      yield { hashes: [hash], bytesRead: 0 };
    }
  } finally {
    reader.releaseLock();
  }
}

function hashLines(lines: string[]): string[] {
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const normalized = normalizeLineValue(trimmed);
    const hash = createHash("sha256").update(normalized).digest("hex");
    result.push(hash);
  }

  return result;
}

function normalizeLineValue(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/\s+/g, "")
    .replaceAll(/[^\x20-\x7E\xC0-\xFF\xA0-\xFF]/g, "");
}