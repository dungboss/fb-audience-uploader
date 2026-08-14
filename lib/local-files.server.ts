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
  name: string;
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
 * Rejects anything that is not a bare file name (no separators, no "..", no
 * dotfiles) and with an unsupported extension. Cheap, no I/O — safe to call
 * from job creation as well as from the worker.
 */
export function assertValidLocalFileName(fileName: string): string {
  const trimmed = fileName.trim();

  if (
    !trimmed ||
    trimmed.startsWith(".") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed !== path.basename(trimmed)
  ) {
    throw new LocalFileError(`Tên file local không hợp lệ: ${fileName}`);
  }

  if (!isSupportedWebDavUploadFile({ name: trimmed, mimeType: null, isDirectory: false })) {
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

  if (realFilePath !== path.join(root, path.basename(realFilePath))) {
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

/** Flat listing of supported files directly inside the root. */
export async function listLocalFiles(): Promise<LocalFileListing> {
  const root = await getLocalFileRoot();

  if (!root) {
    return { configured: false, root: null, files: [] };
  }

  const dirEntries = await readdir(root, { withFileTypes: true });
  const files: LocalFileEntry[] = [];

  for (const entry of dirEntries) {
    // Sub-directories are hidden on purpose (flat root only), as are dotfiles.
    // isFile() is also false for symlinks, so links out of the root never even
    // show up — matching what resolveLocalFilePath() would reject anyway.
    if (!entry.isFile() || entry.name.startsWith(".")) {
      continue;
    }

    if (!isSupportedWebDavUploadFile({ name: entry.name, mimeType: null, isDirectory: false })) {
      continue;
    }

    try {
      const stats = await stat(path.join(root, entry.name));
      files.push({
        name: entry.name,
        size: stats.size,
        lastModified: stats.mtime.toISOString(),
      });
    } catch {
      // Unreadable entry (permissions, race with a delete) — just skip it.
    }
  }

  files.sort((left, right) => left.name.localeCompare(right.name));

  return { configured: true, root, files };
}
