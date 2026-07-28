import type {
  CompletedPart,
  MultipartUpload,
  ObjectStoragePort,
  StorageBucket
} from "./object-storage.port.js";

export class DisabledObjectStorageAdapter implements ObjectStoragePort {
  public isEnabled(): boolean {
    return false;
  }

  public async healthCheck(): Promise<void> {}

  public createMultipartUpload(
    _bucket: StorageBucket,
    _objectKey: string,
    _contentType: string
  ): Promise<MultipartUpload> {
    return Promise.reject(this.disabled());
  }

  public createUploadPartUrl(
    _bucket: StorageBucket,
    _objectKey: string,
    _uploadId: string,
    _partNumber: number
  ): Promise<string> {
    return Promise.reject(this.disabled());
  }

  public completeMultipartUpload(
    _bucket: StorageBucket,
    _objectKey: string,
    _uploadId: string,
    _parts: readonly CompletedPart[]
  ): Promise<void> {
    return Promise.reject(this.disabled());
  }

  public abortMultipartUpload(
    _bucket: StorageBucket,
    _objectKey: string,
    _uploadId: string
  ): Promise<void> {
    return Promise.reject(this.disabled());
  }

  public createDownloadUrl(
    _bucket: StorageBucket,
    _objectKey: string
  ): Promise<string> {
    return Promise.reject(this.disabled());
  }

  public deleteObject(
    _bucket: StorageBucket,
    _objectKey: string
  ): Promise<void> {
    return Promise.reject(this.disabled());
  }

  private disabled(): Error {
    return new Error("Object storage is disabled");
  }
}
