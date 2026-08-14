import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { LocalFileError, resolveLocalFilePath } from "@/lib/local-files.server";

import { hashLinesFromByteChunks, type StreamChunk } from "./line-hash-stream";

/**
 * Local-disk file source. The job stores only the file name; it is resolved
 * against LOCAL_FILE_ROOT here, on every read.
 */

export interface LocalFileMeta {
  contentLength: number;
}

export async function getLocalFileMeta(fileName: string): Promise<LocalFileMeta> {
  const absolutePath = await resolveLocalFilePath(fileName);
  const stats = await stat(absolutePath);

  if (!stats.isFile()) {
    throw new LocalFileError(`${fileName} không phải là file.`);
  }

  return { contentLength: stats.size };
}

export interface StreamLocalFileLinesOptions {
  /** Begin reading from this absolute byte offset instead of 0. */
  startByte?: number;
  /**
   * Size recorded when the job was created. When the file changed underneath a
   * queued job we fail loudly instead of uploading half-rewritten data.
   */
  expectedSize?: number | null;
}

export async function* streamLocalFileLines(
  fileName: string,
  options: StreamLocalFileLinesOptions = {}
): AsyncGenerator<StreamChunk, void, void> {
  const absolutePath = await resolveLocalFilePath(fileName);
  const stats = await stat(absolutePath);

  if (!stats.isFile()) {
    throw new LocalFileError(`${fileName} không phải là file.`);
  }

  if (
    typeof options.expectedSize === "number" &&
    options.expectedSize > 0 &&
    options.expectedSize !== stats.size
  ) {
    throw new LocalFileError(
      `File local "${fileName}" đã thay đổi kể từ lúc tạo job ` +
        `(${options.expectedSize} → ${stats.size} bytes). Hãy tạo job mới.`
    );
  }

  const startByte =
    options.startByte && options.startByte > 0 ? options.startByte : 0;

  if (startByte >= stats.size) {
    return;
  }

  yield* hashLinesFromByteChunks(readFileChunks(absolutePath, startByte), {
    startByte,
  });
}

async function* readFileChunks(
  absolutePath: string,
  startByte: number
): AsyncGenerator<Uint8Array, void, void> {
  const stream = createReadStream(absolutePath, { start: startByte });

  for await (const chunk of stream) {
    yield chunk as Uint8Array;
  }
}
