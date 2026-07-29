export type StorageBucket = "uploads" | "artifacts";

export interface MultipartUpload {
  readonly uploadId: string;
  readonly objectKey: string;
}

export interface CompletedPart {
  readonly partNumber: number;
  readonly etag: string;
}

export interface StoredObjectMetadata {
  readonly sizeBytes: bigint;
  readonly etag?: string;
}

export interface ObjectStoragePort {
  isEnabled(): boolean;
  healthCheck(): Promise<void>;
  createMultipartUpload(
    bucket: StorageBucket,
    objectKey: string,
    contentType: string
  ): Promise<MultipartUpload>;
  createUploadPartUrl(
    bucket: StorageBucket,
    objectKey: string,
    uploadId: string,
    partNumber: number
  ): Promise<string>;
  completeMultipartUpload(
    bucket: StorageBucket,
    objectKey: string,
    uploadId: string,
    parts: readonly CompletedPart[]
  ): Promise<void>;
  abortMultipartUpload(
    bucket: StorageBucket,
    objectKey: string,
    uploadId: string
  ): Promise<void>;
  createDownloadUrl(
    bucket: StorageBucket,
    objectKey: string
  ): Promise<string>;
  headObject(
    bucket: StorageBucket,
    objectKey: string
  ): Promise<StoredObjectMetadata | undefined>;
  getObjectStream(
    bucket: StorageBucket,
    objectKey: string
  ): Promise<AsyncIterable<Uint8Array>>;
  deleteObject(bucket: StorageBucket, objectKey: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");
