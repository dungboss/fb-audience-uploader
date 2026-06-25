export type AudienceUploadJobKind = "create" | "append";
export type AudienceUploadJobStatus =
  | "draft"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface AudienceUploadJob {
  id: string;
  kind: AudienceUploadJobKind;
  status: AudienceUploadJobStatus;
  name: string;
  description: string;
  nasFilePath: string;
  fileName: string;
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
