import { homedir } from "node:os";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { getAudienceUploadConfig } from "@/lib/audience-upload/env";
import { isSupportedWebDavUploadFile } from "@/lib/webdav";

/**
 * Local-disk file source. Deliberately narrow: exactly ONE configured folder
 * (LOCAL_FILE_ROOT), files directly inside it only — no sub-directories, no
 * traversal. A job stores just the file name and it is re-resolved against the
 * root on every read, so a stored path can never escape the folder.
 */

export type LocalFileEntry = {
  /**
   * Path relative to LOCAL_FILE_ROOT, POSIX-style ("roth.txt", "1/roth.txt").
   * This is what a job stores. A bare file name is just a relative path with no
   * directory, so jobs created before sub-folders were supported still resolve.
   */
  path: string;
  /** Base name, for display and for deriving the audience name. */
  name: string;
  /** Containing folder relative to the root, "" when directly in the root. */
  folder: string;
  size: number | null;
  lastModified: string | null;
};

export type LocalFileListing = {
  /** False when LOCAL_FILE_ROOT is unset — the UI hides the feature entirely. */
  configured: boolean;
  root: string | null;
  files: LocalFileEntry[];
};

export class LocalFileError extends Error {}

/** Absolute, symlink-resolved root, or null when the feature is off. */
export async function getLocalFileRoot(): Promise<string | null> {
  const configured = getAudienceUploadConfig().localFileRoot;

  if (!configured) {
    return null;
  }

  const expanded = configured.startsWith("~")
    ? path.join(homedir(), configured.slice(1))
    : configured;

  try {
    // realpath so a symlinked root still compares correctly against resolved
    // file paths below.
    return await realpath(path.resolve(expanded));
  } catch {
    throw new LocalFileError(
      `Thư mục LOCAL_FILE_ROOT không tồn tại hoặc không đọc được: ${expanded}`
    );
  }
}

/**
 * Accepts a path RELATIVE to the root, with or without sub-folders
 * ("roth.txt", "1/roth.txt"). Rejects absolute paths, any ".." segment, and
 * dot-prefixed segments. Cheap, no I/O — safe to call from job creation as well
 * as from the worker.
 */
export function assertValidLocalFileName(fileName: string): string {
  const trimmed = fileName.trim().replaceAll("\\", "/");

  if (!trimmed || trimmed.startsWith("/") || path.isAbsolute(trimmed)) {
    throw new LocalFileError(`Đường dẫn file local không hợp lệ: ${fileName}`);
  }

  const segments = trimmed.split("/");

  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))
  ) {
    throw new LocalFileError(`Đường dẫn file local không hợp lệ: ${fileName}`);
  }

  const baseName = segments.at(-1)!;

  if (!isSupportedWebDavUploadFile({ name: baseName, mimeType: null, isDirectory: false })) {
    throw new LocalFileError("Chỉ hỗ trợ file .csv hoặc .txt.");
  }

  return trimmed;
}

/** Absolute path of a local source file, after validating it stays in the root. */
export async function resolveLocalFilePath(fileName: string): Promise<string> {
  const root = await getLocalFileRoot();

  if (!root) {
    throw new LocalFileError(
      "Chưa cấu hình LOCAL_FILE_ROOT nên không thể đọc file local."
    );
  }

  const safeName = assertValidLocalFileName(fileName);
  const absolutePath = path.join(root, safeName);

  // Second line of defence: resolve symlinks and re-check containment, so a
  // symlink inside the root cannot point at a file outside it.
  let realFilePath: string;
  try {
    realFilePath = await realpath(absolutePath);
  } catch {
    throw new LocalFileError(`Không tìm thấy file local: ${safeName}`);
  }

  // Must still sit inside the root after symlinks are resolved.
  if (realFilePath !== root && !realFilePath.startsWith(root + path.sep)) {
    throw new LocalFileError(`File local nằm ngoài thư mục cho phép: ${safeName}`);
  }

  return realFilePath;
}

/** Size in bytes of a local source file (also proves it exists and is a file). */
export async function statLocalFile(fileName: string): Promise<number> {
  const absolutePath = await resolveLocalFilePath(fileName);
  const stats = await stat(absolutePath);

  if (!stats.isFile()) {
    throw new LocalFileError(`${fileName} không phải là file.`);
  }

  return stats.size;
}

// How deep below the root the listing walks. Guards against a pathological
// tree (or a symlink loop) turning the picker into a full-disk scan.
const MAX_LISTING_DEPTH = 5;

/** Supported files inside the root, including sub-folders. */
export async function listLocalFiles(): Promise<LocalFileListing> {
  const root = await getLocalFileRoot();

  if (!root) {
    return { configured: false, root: null, files: [] };
  }

  const files: LocalFileEntry[] = [];
  await collectFiles(root, "", 0, files);

  // Root files first, then by folder, then by name.
  files.sort(
    (left, right) =>
      left.folder.localeCompare(right.folder) || left.name.localeCompare(right.name)
  );

  return { configured: true, root, files };
}

async function collectFiles(
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  out: LocalFileEntry[]
): Promise<void> {
  const dirEntries = await readdir(absoluteDir, { withFileTypes: true });

  for (const entry of dirEntries) {
    // Dot-prefixed entries stay hidden. isFile()/isDirectory() are both false
    // for symlinks, so links out of the root never show up — matching what
    // resolveLocalFilePath() would reject anyway.
    if (entry.name.startsWith(".")) {
      continue;
    }

    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (depth < MAX_LISTING_DEPTH) {
        await collectFiles(path.join(absoluteDir, entry.name), relativePath, depth + 1, out);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!isSupportedWebDavUploadFile({ name: entry.name, mimeType: null, isDirectory: false })) {
      continue;
    }

    try {
      const stats = await stat(path.join(absoluteDir, entry.name));
      out.push({
        path: relativePath,
        name: entry.name,
        folder: relativeDir,
        size: stats.size,
        lastModified: stats.mtime.toISOString(),
      });
    } catch {
      // Unreadable entry (permissions, race with a delete) — just skip it.
    }
  }
}
