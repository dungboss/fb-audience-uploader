import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";

import { resolveLocalFilePath } from "@/lib/local-files.server";

import { getAudienceUploadConfig } from "./env";
import { listAllAudienceUploadJobs } from "./jobs";
import type { AudienceUploadJob } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Statuses that mean "this job still needs its source file on disk". A queued
 * or delayed job has not read a single byte yet; a processing one is reading
 * right now; a failed one is waiting to be retried or resumed by hand.
 */
const ACTIVE_STATUSES = new Set([
  "draft",
  "queued",
  "processing",
  "failed",
]);

export type LocalCleanupResult =
  | { deleted: true; mode: "trash" | "permanent"; path: string }
  | { deleted: false; reason: string };

/**
 * Delete a LOCAL source file after its upload finished successfully.
 *
 * Mirrors the manual rule we have always applied by hand: a file may only go
 * when it has a completed job, no job that still needs it, and no cancelled
 * job holding a resumable offset (deleting that file would throw away the
 * ability to continue from where it stopped).
 *
 * Never throws — cleanup failing must not fail an upload that already
 * succeeded. The caller logs the returned reason.
 */
export async function deleteLocalFileAfterUpload(
  completedJob: AudienceUploadJob
): Promise<LocalCleanupResult> {
  const config = getAudienceUploadConfig();

  if (config.localDeleteAfterUpload === "off") {
    return { deleted: false, reason: "LOCAL_DELETE_AFTER_UPLOAD=off" };
  }

  if (completedJob.sourceType !== "local") {
    return { deleted: false, reason: "không phải file local" };
  }

  const relativePath = completedJob.nasFilePath;

  const blocker = await findBlockingJob(relativePath, completedJob.id);
  if (blocker) {
    return { deleted: false, reason: blocker };
  }

  try {
    // Resolves against LOCAL_FILE_ROOT and rejects anything outside it, so a
    // tampered job payload can never point this delete at another folder.
    const absolutePath = await resolveLocalFilePath(relativePath);

    if (config.localDeleteAfterUpload === "trash") {
      await moveToTrash(absolutePath);
      return { deleted: true, mode: "trash", path: absolutePath };
    }

    await rm(absolutePath, { force: true });
    return { deleted: true, mode: "permanent", path: absolutePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { deleted: false, reason: `xoá thất bại: ${message}` };
  }
}

/**
 * Returns a human-readable reason when another job still needs this file, or
 * null when the file is free to delete.
 */
async function findBlockingJob(relativePath: string, completedJobId: string) {
  const jobs = await listAllAudienceUploadJobs();

  for (const job of jobs) {
    if (job.id === completedJobId) {
      continue;
    }

    if (job.sourceType !== "local" || job.nasFilePath !== relativePath) {
      continue;
    }

    if (ACTIVE_STATUSES.has(job.status)) {
      return `job ${job.id} (${job.status}) vẫn cần file này`;
    }

    // A cancelled job with progress can be resumed from its offset, which only
    // works while the file is still there.
    if (job.status === "cancelled" && job.syncedByteOffset > 0) {
      return `job ${job.id} đã huỷ nhưng còn offset resume được`;
    }
  }

  return null;
}

/**
 * macOS-only: hand the file to Finder so it lands in the Trash and keeps its
 * "Put Back" entry, instead of being unlinked outright.
 */
async function moveToTrash(absolutePath: string) {
  if (process.platform !== "darwin") {
    throw new Error(
      'LOCAL_DELETE_AFTER_UPLOAD="trash" chỉ hỗ trợ macOS. Dùng "permanent" trên hệ khác.'
    );
  }

  const escapedPath = absolutePath.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

  await execFileAsync("osascript", [
    "-e",
    `tell application "Finder" to delete POSIX file "${escapedPath}"`,
  ]);
}
