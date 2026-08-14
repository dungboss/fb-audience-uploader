import { createHash } from "node:crypto";

/**
 * Source-agnostic half of the upload pipeline: turns a stream of raw byte
 * chunks into batches of hashed lines. NAS (WebDAV ranges) and local disk (fs)
 * only differ in how they produce those bytes — everything about line
 * splitting, normalising, hashing and resume offsets lives here.
 */

export interface StreamChunk {
  hashes: string[];
  bytesRead: number;
  /**
   * Absolute byte offset (from file start) up to which COMPLETE lines have been
   * emitted — i.e. the start of the next, not-yet-complete line. A clean newline
   * boundary safe to resume from.
   */
  endOffset: number;
}

export interface HashLinesOptions {
  /**
   * Absolute byte offset the first chunk starts at. When > 0 the partial first
   * line is dropped so the stream always begins on a clean line boundary.
   */
  startByte?: number;
}

export async function* hashLinesFromByteChunks(
  chunks: AsyncIterable<Uint8Array>,
  options: HashLinesOptions = {}
): AsyncGenerator<StreamChunk, void, void> {
  const startByte = options.startByte && options.startByte > 0 ? options.startByte : 0;

  let absoluteOffset = startByte;
  let leftover = "";
  let isFirstChunk = true;

  for await (const value of chunks) {
    const chunkBytes = value.byteLength;
    absoluteOffset += chunkBytes;

    let chunk = new TextDecoder("utf-8", { fatal: false }).decode(value);

    if (isFirstChunk) {
      if (startByte === 0) {
        // Remove BOM from the very first chunk.
        if (chunk.startsWith("\uFEFF")) {
          chunk = chunk.slice(1);
        }
      } else {
        // Starting mid-file: drop the partial first line so we begin on a clean
        // boundary (everything up to the first newline is assumed already done).
        const firstNewline = chunk.indexOf("\n");
        chunk = firstNewline >= 0 ? chunk.slice(firstNewline + 1) : "";
      }
      isFirstChunk = false;
    }

    // Prepend leftover from previous chunk boundary.
    const text = leftover + chunk;
    const lines = text.split("\n");

    // The last line may be incomplete (crosses the chunk boundary).
    leftover = lines.pop() ?? "";

    // Absolute offset of the start of `leftover` = boundary of complete lines.
    const endOffset = absoluteOffset - Buffer.byteLength(leftover, "utf8");

    const hashed = lines.length > 0 ? hashLines(lines) : [];
    yield { hashes: hashed, bytesRead: chunkBytes, endOffset };
  }

  // Process the final leftover line (no trailing newline at end of file).
  if (leftover.trim().length > 0) {
    const normalized = normalizeLineValue(leftover.trim());
    const hash = createHash("sha256").update(normalized).digest("hex");
    yield { hashes: [hash], bytesRead: 0, endOffset: absoluteOffset };
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
