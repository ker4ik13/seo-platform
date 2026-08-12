import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { S3Config } from "../config/app-config.js";
import type {
  CompletedPart,
  DownloadObjectOptions,
  MultipartUpload,
  ObjectStoragePort,
  StoredObjectMetadata,
  StorageBucket
} from "./object-storage.port.js";

export class S3ObjectStorageAdapter implements ObjectStoragePort {
  private readonly client: S3Client;

  public constructor(private readonly config: S3Config) {
    if (
      !config.accessKeyId ||
      !config.secretAccessKey ||
      !config.buckets.uploads ||
      !config.buckets.artifacts
    ) {
      throw new Error("Cannot construct S3 adapter with incomplete config");
    }

    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  public isEnabled(): boolean {
    return true;
  }

  public async healthCheck(): Promise<void> {
    await Promise.all([
      this.client.send(
        new HeadBucketCommand({ Bucket: this.bucketName("uploads") })
      ),
      this.client.send(
        new HeadBucketCommand({ Bucket: this.bucketName("artifacts") })
      )
    ]);
  }

  public async createMultipartUpload(
    bucket: StorageBucket,
    objectKey: string,
    contentType: string
  ): Promise<MultipartUpload> {
    const logicalKey = logicalObjectKey(objectKey);
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucketName(bucket),
        Key: this.storageObjectKey(bucket, logicalKey),
        ContentType: contentType
      })
    );

    if (!result.UploadId) {
      throw new Error("S3 did not return a multipart upload ID");
    }

    return { uploadId: result.UploadId, objectKey: logicalKey };
  }

  public createUploadPartUrl(
    bucket: StorageBucket,
    objectKey: string,
    uploadId: string,
    partNumber: number
  ): Promise<string> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      return Promise.reject(new Error("Invalid multipart part number"));
    }

    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucketName(bucket),
        Key: this.storageObjectKey(bucket, objectKey),
        UploadId: uploadId,
        PartNumber: partNumber
      }),
      { expiresIn: this.config.signedUrlTtlSeconds }
    );
  }

  public async completeMultipartUpload(
    bucket: StorageBucket,
    objectKey: string,
    uploadId: string,
    parts: readonly CompletedPart[]
  ): Promise<void> {
    const normalizedParts = [...parts]
      .sort((left, right) => left.partNumber - right.partNumber)
      .map((part) => ({
        ETag: part.etag,
        PartNumber: part.partNumber
      }));

    if (normalizedParts.length === 0) {
      throw new Error("Cannot complete an empty multipart upload");
    }

    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucketName(bucket),
        Key: this.storageObjectKey(bucket, objectKey),
        UploadId: uploadId,
        MultipartUpload: { Parts: normalizedParts }
      })
    );
  }

  public async abortMultipartUpload(
    bucket: StorageBucket,
    objectKey: string,
    uploadId: string
  ): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucketName(bucket),
          Key: this.storageObjectKey(bucket, objectKey),
          UploadId: uploadId
        })
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  public createDownloadUrl(
    bucket: StorageBucket,
    objectKey: string,
    options?: DownloadObjectOptions
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: this.storageObjectKey(bucket, objectKey),
        ...(options?.filename
          ? {
              ResponseContentDisposition:
                `attachment; filename*=UTF-8''${encodeURIComponent(options.filename)}`
            }
          : {}),
        ...(options?.contentType
          ? { ResponseContentType: options.contentType }
          : {})
      }),
      { expiresIn: this.config.signedUrlTtlSeconds }
    );
  }

  public async headObject(
    bucket: StorageBucket,
    objectKey: string
  ): Promise<StoredObjectMetadata | undefined> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName(bucket),
          Key: this.storageObjectKey(bucket, objectKey)
        })
      );
      return {
        sizeBytes: BigInt(result.ContentLength ?? 0),
        ...(result.ETag ? { etag: result.ETag } : {})
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  public async getObjectStream(
    bucket: StorageBucket,
    objectKey: string
  ): Promise<AsyncIterable<Uint8Array>> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: this.storageObjectKey(bucket, objectKey)
      })
    );
    const body = result.Body;
    if (!body || !(Symbol.asyncIterator in body)) {
      throw new Error("S3 did not return a streaming object body");
    }
    return body as AsyncIterable<Uint8Array>;
  }

  public async deleteObject(
    bucket: StorageBucket,
    objectKey: string
  ): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName(bucket),
        Key: this.storageObjectKey(bucket, objectKey)
      })
    );
  }

  private bucketName(bucket: StorageBucket): string {
    const value = this.config.buckets[bucket];
    if (!value) throw new Error(`Missing S3 bucket: ${bucket}`);
    return value;
  }

  private storageObjectKey(
    bucket: StorageBucket,
    objectKey: string
  ): string {
    return buildS3ObjectKey(this.config.objectKeyPrefix, bucket, objectKey);
  }
}

export function buildS3ObjectKey(
  deploymentPrefix: string | undefined,
  bucket: StorageBucket,
  objectKey: string
): string {
  const logicalKey = logicalObjectKey(objectKey);
  const prefix = deploymentPrefix?.trim();
  if (
    prefix &&
    (prefix.length > 256 ||
      prefix.startsWith("/") ||
      prefix.endsWith("/") ||
      prefix.includes("//") ||
      prefix.includes("..") ||
      !/^[A-Za-z0-9][A-Za-z0-9._~/-]*$/u.test(prefix))
  ) {
    throw new Error("Invalid S3 object key prefix");
  }
  const storageKey = prefix
    ? `${prefix}/${bucket}/${logicalKey}`
    : logicalKey;
  if (storageKey.length > 1_024) {
    throw new Error("Invalid S3 object key");
  }
  return storageKey;
}

function logicalObjectKey(value: string): string {
  const key = value.trim();
  if (!key || key.startsWith("/") || key.includes("..") || key.length > 1_024) {
    throw new Error("Invalid S3 object key");
  }
  return key;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("name" in error && error.name === "NotFound") ||
      ("$metadata" in error &&
        typeof error.$metadata === "object" &&
        error.$metadata !== null &&
        "httpStatusCode" in error.$metadata &&
        error.$metadata.httpStatusCode === 404))
  );
}
