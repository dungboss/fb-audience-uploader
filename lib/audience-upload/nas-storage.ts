import {
  fetchWebDavFileHead,
  fetchWebDavFileRange,
  fetchWebDavFileStream,
  WebDavRangeUnsupportedError,
} from "@/lib/webdav.server";

import { hashLinesFromByteChunks, type StreamChunk } from "./line-hash-stream";

const NAS_CHUNK_BYTES = 10 * 1024 * 1024; // 10 MB per range request

export interface NasFileMeta {
  contentLength: number | null;
  contentType: string | null;
}

export async function getNasFileMeta(nasFilePath: string): Promise<NasFileMeta> {
  const head = await fetchWebDavFileHead(nasFilePath);
  return {
    contentLength: head.contentLength,
    contentType: head.contentType,
  };
}

export interface StreamNasFileLinesOptions {
  /**
   * Known file size from PROPFIND listing (used for progress % when
   * the server doesn't return Content-Length on HEAD requests).
   */
  knownSize?: number | null;
  /**
   * Begin reading from this absolute byte offset instead of 0. Requires the NAS
   * to support Range requests.
   */
  startByte?: number;
}

export async function* streamNasFileLines(
  nasFilePath: string,
  options: StreamNasFileLinesOptions = {}
): AsyncGenerator<StreamChunk, void, void> {
  const head = await fetchWebDavFileHead(nasFilePath);

  // Drive range requests by HEAD Content-Length when present, otherwise by the
  // PROPFIND size (knownSize). Large files often omit Content-Length on HEAD but
  // still support Range — using knownSize keeps them on the resilient, resumable
  // 10MB-per-request path instead of one fragile long-lived stream.
  const totalBytes = head.contentLength ?? options.knownSize ?? null;
  const startByte =
    options.startByte && options.startByte > 0 ? options.startByte : 0;

  if (totalBytes !== null && totalBytes > 0) {
    try {
      yield* hashLinesFromByteChunks(
        readRangeChunks(nasFilePath, totalBytes, startByte),
        { startByte }
      );
      return;
    } catch (error) {
      if (!(error instanceof WebDavRangeUnsupportedError)) {
        throw error;
      }
      // Server ignored Range (returned 200) — fall through to full-read streaming.
      console.warn(
        `[nas-storage] NAS ignored Range for ${nasFilePath}; falling back to full read.`
      );
    }
  }

  // A start offset can only be honored via Range requests.
  if (startByte > 0) {
    throw new Error(
      "NAS không hỗ trợ Range nên không thể bắt đầu upload từ offset đã chọn."
    );
  }

  // Fallback: no size known, or server doesn't support Range — stream the file.
  yield* hashLinesFromByteChunks(readFullStreamChunks(nasFilePath));
}

async function* readRangeChunks(
  nasFilePath: string,
  totalBytes: number,
  startByte: number
): AsyncGenerator<Uint8Array, void, void> {
  let offset = startByte;

  while (offset < totalBytes) {
    const end = Math.min(offset + NAS_CHUNK_BYTES - 1, totalBytes - 1);
    const buffer = await fetchWebDavFileRange(nasFilePath, offset, end);
    offset = end + 1;
    yield new Uint8Array(buffer);
  }
}

async function* readFullStreamChunks(
  nasFilePath: string
): AsyncGenerator<Uint8Array, void, void> {
  const stream = await fetchWebDavFileStream(nasFilePath);
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
