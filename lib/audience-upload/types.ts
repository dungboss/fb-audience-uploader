export type AudienceUploadJobKind = "create" | "append";
export type AudienceUploadJobStatus =
  | "draft"
  | "uploading"
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
  fileName: string;
  audienceId: string | null;
  receivedPartCount: number;
  processedPartCount: number;
  receivedHashCount: number;
  syncedHashCount: number;
  totalParts: number | null;
  totalHashes: number | null;
  duplicateCount: number;
  invalidEntryCount: number;
  lastSessionId: string | null;
  errorMessage: string | null;
  finalizedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceUploadPart {
  partIndex: number;
  objectKey: string;
  hashCount: number;
}

export interface AudienceUploadJobPayload {
  jobId: string;
}
