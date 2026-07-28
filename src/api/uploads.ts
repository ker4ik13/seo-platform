export const supportedImportMediaTypes = [
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip"
] as const;

export type SupportedImportMediaType =
  (typeof supportedImportMediaTypes)[number];

export const importExtensionByMediaType: Readonly<
  Record<SupportedImportMediaType, string>
> = {
  "text/csv": ".csv",
  "text/tab-separated-values": ".tsv",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    ".xlsx",
  "application/zip": ".zip"
};

export type UploadStatus =
  | "INITIATED"
  | "UPLOADING"
  | "UPLOADED"
  | "SCANNING"
  | "READY"
  | "REJECTED"
  | "EXPIRED"
  | "ABORTED";

export interface CreateUploadInput {
  readonly fileName: string;
  readonly mediaType: SupportedImportMediaType;
  readonly sizeBytes: string;
  readonly checksumSha256?: string;
}

export interface UploadSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly originalName: string;
  readonly mediaType: string;
  readonly detectedMediaType?: string;
  readonly sizeBytes: string;
  readonly checksumSha256?: string;
  readonly rejectionCode?: string;
  readonly status: UploadStatus;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly uploadedAt?: string;
  readonly inspectionCompletedAt?: string;
  readonly version: number;
}

export interface CreatedMultipartUpload {
  readonly upload: UploadSummary;
  readonly partSizeBytes: number;
  readonly partCount: number;
}

export interface CreateUploadPartUrlsInput {
  readonly partNumbers: readonly number[];
}

export interface UploadPartUrl {
  readonly partNumber: number;
  readonly url: string;
  readonly expiresAt: string;
}

export interface UploadPartUrls {
  readonly uploadId: string;
  readonly parts: readonly UploadPartUrl[];
}

export interface CompletedUploadPart {
  readonly partNumber: number;
  readonly etag: string;
}

export interface CompleteUploadInput {
  readonly parts: readonly CompletedUploadPart[];
}

export interface InternalCreateUploadInput extends CreateUploadInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}
