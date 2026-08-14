import { getLocalFileMeta, streamLocalFileLines } from "./local-storage";
import type { StreamChunk } from "./line-hash-stream";
import { getNasFileMeta, streamNasFileLines } from "./nas-storage";
import type { AudienceUploadSourceType } from "./types";

/**
 * Single entry point the worker reads files through. It picks the NAS or local
 * source from the job's sourceType so nothing downstream has to know where the
 * bytes came from.
 */

export type { StreamChunk } from "./line-hash-stream";

export interface FileSourceRef {
  sourceType: AudienceUploadSourceType;
  /** WebDAV path for "nas"; bare file name (relative to LOCAL_FILE_ROOT) for "local". */
  filePath: string;
}

export interface FileSourceMeta {
  /** Size in bytes, or null when the source can't report one (some NAS HEADs). */
  contentLength: number | null;
}

export async function getFileSourceMeta(
  source: FileSourceRef
): Promise<FileSourceMeta> {
  if (source.sourceType === "local") {
    const meta = await getLocalFileMeta(source.filePath);
    return { contentLength: meta.contentLength };
  }

  const meta = await getNasFileMeta(source.filePath);
  return { contentLength: meta.contentLength };
}

export interface StreamFileLinesOptions {
  /** Size recorded on the job (PROPFIND for NAS, fs.stat for local). */
  knownSize?: number | null;
  /** Absolute byte offset to start from (resume). */
  startByte?: number;
}

export function streamFileSourceLines(
  source: FileSourceRef,
  options: StreamFileLinesOptions = {}
): AsyncGenerator<StreamChunk, void, void> {
  if (source.sourceType === "local") {
    return streamLocalFileLines(source.filePath, {
      startByte: options.startByte,
      expectedSize: options.knownSize,
    });
  }

  return streamNasFileLines(source.filePath, {
    knownSize: options.knownSize,
    startByte: options.startByte,
  });
}
