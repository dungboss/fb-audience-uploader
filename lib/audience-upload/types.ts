export type AudienceUploadJobKind = "create" | "append";
export type AudienceUploadJobStatus =
  | "draft"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface AudienceUploadJob {
  id: string;
  kind: AudienceUploadJobKind;
  status: AudienceUploadJobStatus;
  name: string;
  description: string;
  nasFilePath: string;
  fileName: string;
  fileSize: number | null;
  // Ad account this job targets, snapshotted at creation so the worker (a
  // separate process) creates the audience under the account the user picked.
  adAccountId: string | null;
  // Access token (id reference into the encrypted token store) this job uses.
  // Snapshotted so the worker resolves the same token the user picked. Empty =
  // fall back to FACEBOOK_ACCESS_TOKEN in .env.
  tokenId: string | null;
  audienceId: string | null;
  // Absolute byte offset in the NAS file to START uploading from (user-chosen,
  // e.g. to resume a previously-interrupted upload). 0 = from the beginning.
  startOffsetBytes: number;
  syncedHashCount: number;
  syncedLines: number;
  // Absolute byte offset successfully uploaded so far (a clean line boundary).
  // Shown to the user as MB so they can resume a new job from here after a
  // failure. Always conservative — never ahead of what Meta actually received.
  syncedByteOffset: number;
  processedLines: number;
  processedBytes: number;
  totalLines: number | null;
  totalBytes: number | null;
  lastSessionId: string | null;
  errorMessage: string | null;
  // When the worker is waiting (after #2650 / rate limit / proactive pause)
  // before retrying — ISO timestamp the upload is expected to resume at. Null
  // when not waiting. Lets the UI show a countdown to the next attempt.
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceUploadJobPayload {
  jobId: string;
}