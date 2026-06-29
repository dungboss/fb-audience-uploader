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
  syncedHashCount: number;
  syncedLines: number;
  processedLines: number;
  processedBytes: number;
  totalLines: number | null;
  totalBytes: number | null;
  lastSessionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceUploadJobPayload {
  jobId: string;
}