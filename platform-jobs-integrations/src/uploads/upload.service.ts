import { randomBytes } from "node:crypto";
import {
  BadGatewayException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  domainEventTypes,
  type CompleteUploadInput,
  type CreatedMultipartUpload,
  type InternalCreateUploadInput,
  type UploadPartUrls,
  type UploadSummary
} from "@seo-platform/contracts";
import type {
  Prisma,
  Upload
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
  type StoredObjectMetadata
} from "../storage/object-storage.port.js";
import {
  assertStorageCapacity,
  lockStorageCapacity
} from "./storage-capacity.js";

const MEBIBYTE = 1_024 * 1_024;
const STORAGE_RESERVING_UPLOAD_STATUSES = [
  "INITIATED",
  "UPLOADING",
  "UPLOADED",
  "SCANNING",
  "READY"
] as const;

@Injectable()
export class UploadService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queue: QueueService
  ) {}

  public async create(
    input: InternalCreateUploadInput
  ): Promise<CreatedMultipartUpload> {
    this.requireStorage();
    const existing = await this.findIdempotent(input);
    if (existing) return this.createdResult(existing);

    const sizeBytes = BigInt(input.sizeBytes);
    const partSizeBytes = this.partSize(Number(sizeBytes));
    const partCount = Math.ceil(Number(sizeBytes) / partSizeBytes);
    const objectKey = this.objectKey(input);
    let multipart:
      | { readonly uploadId: string; readonly objectKey: string }
      | undefined;

    try {
      multipart = await this.storage.createMultipartUpload(
        "uploads",
        objectKey,
        input.mediaType
      );
      const initiatedMultipart = multipart;
      const stored = await this.prisma.$transaction(
        async (transaction) => {
          await lockStorageCapacity(transaction, input.workspaceId);
          const winner = await this.findIdempotent(input, transaction);
          if (winner) return { upload: winner, created: false };

          const used = await transaction.upload.aggregate({
            where: {
              workspaceId: input.workspaceId,
              status: { in: [...STORAGE_RESERVING_UPLOAD_STATUSES] }
            },
            _sum: { sizeBytes: true }
          });
          assertStorageCapacity(
            used._sum.sizeBytes ?? 0n,
            sizeBytes,
            input.entitlement
          );
          const upload = await transaction.upload.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              actorId: input.actorId,
              bucket: "uploads",
              objectKey: initiatedMultipart.objectKey,
              originalName: input.fileName,
              mediaType: input.mediaType,
              sizeBytes,
              ...(input.checksumSha256
                ? { declaredChecksum: input.checksumSha256 }
                : {}),
              multipartId: initiatedMultipart.uploadId,
              partSizeBytes,
              partCount,
              idempotencyKey: input.idempotencyKey,
              expiresAt: new Date(
                Date.now() +
                  this.config.uploads.expiresHours * 60 * 60 * 1_000
              )
            }
          });
          return { upload, created: true };
        },
        { isolationLevel: "ReadCommitted" }
      );
      if (!stored.created) {
        await this.abortMultipart(initiatedMultipart);
      }
      return this.createdResult(stored.upload);
    } catch (error) {
      if (multipart) {
        await this.abortMultipart(multipart);
      }
      if (isUniqueConstraintError(error)) {
        const winner = await this.findIdempotent(input);
        if (winner) return this.createdResult(winner);
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        "Unable to initiate object storage upload",
        { cause: error }
      );
    }
  }

  public async partUrls(
    uploadId: string,
    workspaceId: string,
    projectId: string,
    actorId: string,
    partNumbers: readonly number[]
  ): Promise<UploadPartUrls> {
    this.requireStorage();
    const upload = await this.load(uploadId, workspaceId, projectId, actorId);
    this.assertUploadable(upload);
    if (
      partNumbers.some(
        (partNumber) => partNumber < 1 || partNumber > upload.partCount
      )
    ) {
      throw new UnprocessableEntityException(
        "Part number is outside the upload range"
      );
    }
    if (!upload.multipartId) {
      throw new ConflictException("Multipart upload is unavailable");
    }

    await this.prisma.upload.updateMany({
      where: { id: upload.id, status: "INITIATED" },
      data: {
        status: "UPLOADING",
        version: { increment: 1 }
      }
    });
    const expiresAt = new Date(
      Date.now() + this.config.s3.signedUrlTtlSeconds * 1_000
    ).toISOString();
    try {
      const parts = await Promise.all(
        partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await this.storage.createUploadPartUrl(
            "uploads",
            upload.objectKey,
            upload.multipartId!,
            partNumber
          ),
          expiresAt
        }))
      );
      return { uploadId: upload.id, parts };
    } catch (error) {
      throw new ServiceUnavailableException(
        "Unable to sign upload part URLs",
        { cause: error }
      );
    }
  }

  public async get(
    uploadId: string,
    workspaceId: string,
    projectId: string
  ): Promise<UploadSummary> {
    const upload = await this.prisma.upload.findFirst({
      where: {
        id: uploadId,
        workspaceId,
        projectId
      }
    });
    if (!upload) throw new NotFoundException("Upload not found");
    return toUploadSummary(upload);
  }

  public async complete(
    uploadId: string,
    workspaceId: string,
    projectId: string,
    actorId: string,
    input: CompleteUploadInput,
    requestId: string
  ): Promise<UploadSummary> {
    this.requireStorage();
    const upload = await this.load(uploadId, workspaceId, projectId, actorId);
    if (upload.status === "UPLOADED") {
      await this.enqueueInspection(upload.id);
      return toUploadSummary(upload);
    }
    if (["SCANNING", "READY"].includes(upload.status)) {
      return toUploadSummary(upload);
    }
    this.assertUploadable(upload);
    if (!upload.multipartId) {
      throw new ConflictException("Multipart upload is unavailable");
    }
    const parts = [...input.parts].sort(
      (left, right) => left.partNumber - right.partNumber
    );
    if (
      parts.length !== upload.partCount ||
      parts.some((part, index) => part.partNumber !== index + 1)
    ) {
      throw new UnprocessableEntityException(
        "Every upload part must be completed exactly once"
      );
    }

    try {
      await this.storage.completeMultipartUpload(
        "uploads",
        upload.objectKey,
        upload.multipartId,
        parts
      );
    } catch (error) {
      const recovered = await this.storage
        .headObject("uploads", upload.objectKey)
        .catch(() => undefined);
      if (!recovered) {
        throw new BadGatewayException(
          "Object storage did not complete the upload",
          { cause: error }
        );
      }
    }

    let metadata: StoredObjectMetadata | undefined;
    try {
      metadata = await this.storage.headObject("uploads", upload.objectKey);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Unable to verify uploaded object",
        { cause: error }
      );
    }
    if (!metadata || metadata.sizeBytes !== upload.sizeBytes) {
      if (metadata) {
        await this.storage.deleteObject("uploads", upload.objectKey);
      }
      await this.prisma.upload.updateMany({
        where: {
          id: upload.id,
          status: { in: ["INITIATED", "UPLOADING"] }
        },
        data: {
          status: "REJECTED",
          scanResult: {
            code: "SIZE_MISMATCH",
            expectedSizeBytes: upload.sizeBytes.toString(),
            actualSizeBytes: metadata?.sizeBytes.toString()
          },
          version: { increment: 1 }
        }
      });
      throw new UnprocessableEntityException(
        "Uploaded object size does not match its declaration"
      );
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.upload.updateMany({
        where: {
          id: upload.id,
          status: { in: ["INITIATED", "UPLOADING"] }
        },
        data: {
          status: "UPLOADED",
          uploadedAt: new Date(),
          version: { increment: 1 }
        }
      });
      const current = await transaction.upload.findUnique({
        where: { id: upload.id }
      });
      if (!current) throw new NotFoundException("Upload not found");
      if (changed.count === 1) {
        await transaction.outboxEvent.create({
          data: {
            eventType: domainEventTypes.uploadCompleted,
            aggregateId: current.id,
            workspaceId: current.workspaceId,
            projectId: current.projectId,
            payload: {
              uploadId: current.id,
              workspaceId: current.workspaceId,
              projectId: current.projectId,
              mediaType: current.mediaType,
              sizeBytes: current.sizeBytes.toString(),
              ...(current.declaredChecksum
                ? { declaredChecksumSha256: current.declaredChecksum }
                : {})
            },
            metadata: {
              requestId,
              producer: "jobs-integrations"
            }
          }
        });
      }
      return toUploadSummary(current);
    });
    await this.enqueueInspection(result.id);
    return result;
  }

  public async abort(
    uploadId: string,
    workspaceId: string,
    projectId: string,
    actorId: string,
    requestId: string
  ): Promise<UploadSummary> {
    this.requireStorage();
    const upload = await this.load(uploadId, workspaceId, projectId, actorId);
    if (upload.status === "ABORTED") return toUploadSummary(upload);
    if (["UPLOADED", "SCANNING", "READY"].includes(upload.status)) {
      throw new ConflictException("Completed upload cannot be aborted");
    }
    if (upload.multipartId) {
      await this.storage.abortMultipartUpload(
        "uploads",
        upload.objectKey,
        upload.multipartId
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.upload.updateMany({
        where: {
          id: upload.id,
          status: { in: ["INITIATED", "UPLOADING"] }
        },
        data: {
          status: "ABORTED",
          abortedAt: new Date(),
          version: { increment: 1 }
        }
      });
      const current = await transaction.upload.findUnique({
        where: { id: upload.id }
      });
      if (!current) throw new NotFoundException("Upload not found");
      if (changed.count === 1 && current.status === "ABORTED") {
        await transaction.outboxEvent.create({
          data: {
            eventType: domainEventTypes.uploadAborted,
            aggregateId: current.id,
            workspaceId: current.workspaceId,
            projectId: current.projectId,
            payload: {
              uploadId: current.id,
              workspaceId: current.workspaceId,
              projectId: current.projectId
            },
            metadata: {
              requestId,
              producer: "jobs-integrations"
            }
          }
        });
      }
      return toUploadSummary(current);
    });
  }

  private async findIdempotent(
    input: InternalCreateUploadInput,
    prisma: Pick<Prisma.TransactionClient, "upload"> = this.prisma
  ): Promise<Upload | null> {
    const upload = await prisma.upload.findUnique({
      where: {
        workspaceId_actorId_idempotencyKey: {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey
        }
      }
    });
    if (
      upload &&
      (upload.projectId !== input.projectId ||
        upload.originalName !== input.fileName ||
        upload.mediaType !== input.mediaType ||
        upload.sizeBytes.toString() !== input.sizeBytes ||
        (upload.declaredChecksum ?? undefined) !== input.checksumSha256)
    ) {
      throw new HttpException(
        {
          error: {
            code: "IDEMPOTENCY_CONFLICT",
            message:
              "Idempotency key was already used for another upload"
          }
        },
        HttpStatus.CONFLICT
      );
    }
    return upload;
  }

  private load(
    uploadId: string,
    workspaceId: string,
    projectId: string,
    actorId: string
  ): Promise<Upload> {
    return this.prisma.upload
      .findFirst({
        where: {
          id: uploadId,
          workspaceId,
          projectId,
          actorId
        }
      })
      .then((upload) => {
        if (!upload) throw new NotFoundException("Upload not found");
        return upload;
      });
  }

  private assertUploadable(upload: Upload): void {
    if (upload.expiresAt <= new Date()) {
      throw new ConflictException("Upload has expired");
    }
    if (!["INITIATED", "UPLOADING"].includes(upload.status)) {
      throw new ConflictException(
        `Upload cannot be changed in ${upload.status} state`
      );
    }
  }

  private createdResult(upload: Upload): CreatedMultipartUpload {
    return {
      upload: toUploadSummary(upload),
      partSizeBytes: upload.partSizeBytes,
      partCount: upload.partCount
    };
  }

  private partSize(sizeBytes: number): number {
    const minimumForPartLimit = Math.ceil(sizeBytes / 10_000);
    const configured = Math.max(
      this.config.uploads.partSizeBytes,
      minimumForPartLimit,
      5 * MEBIBYTE
    );
    return Math.ceil(configured / MEBIBYTE) * MEBIBYTE;
  }

  private objectKey(input: InternalCreateUploadInput): string {
    const extension = safeExtension(input.fileName);
    return [
      input.workspaceId,
      input.projectId,
      `${randomBytes(20).toString("hex")}${extension}`
    ].join("/");
  }

  private async abortMultipart(multipart: {
    readonly uploadId: string;
    readonly objectKey: string;
  }): Promise<void> {
    await this.storage
      .abortMultipartUpload(
        "uploads",
        multipart.objectKey,
        multipart.uploadId
      )
      .catch(() => undefined);
  }

  private requireStorage(): void {
    if (!this.storage.isEnabled()) {
      throw new ServiceUnavailableException(
        "Object storage is not configured"
      );
    }
  }

  private async enqueueInspection(uploadId: string): Promise<void> {
    try {
      await this.queue.enqueueUploadInspection(uploadId);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Unable to schedule upload inspection",
        { cause: error }
      );
    }
  }
}

export function toUploadSummary(upload: Upload): UploadSummary {
  if (!upload.projectId) {
    throw new Error("Project upload is missing projectId");
  }
  const rejectionCode =
    upload.status === "REJECTED"
      ? safeRejectionCode(upload.scanResult)
      : undefined;
  return {
    id: upload.id,
    workspaceId: upload.workspaceId,
    projectId: upload.projectId,
    originalName: upload.originalName,
    mediaType: upload.mediaType,
    ...(upload.detectedMediaType
      ? { detectedMediaType: upload.detectedMediaType }
      : {}),
    sizeBytes: upload.sizeBytes.toString(),
    ...(upload.checksum ? { checksumSha256: upload.checksum } : {}),
    ...(rejectionCode ? { rejectionCode } : {}),
    status: upload.status,
    expiresAt: upload.expiresAt.toISOString(),
    createdAt: upload.createdAt.toISOString(),
    ...(upload.uploadedAt
      ? { uploadedAt: upload.uploadedAt.toISOString() }
      : {}),
    ...(upload.inspectionCompletedAt
      ? {
          inspectionCompletedAt:
            upload.inspectionCompletedAt.toISOString()
        }
      : {}),
    version: upload.version
  };
}

function safeRejectionCode(value: unknown): string | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("code" in value) ||
    typeof value.code !== "string"
  ) {
    return undefined;
  }
  return /^[A-Z][A-Z0-9_]{1,63}$/u.test(value.code)
    ? value.code
    : undefined;
}

function safeExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index < 1) return "";
  const extension = fileName.slice(index).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/u.test(extension) ? extension : "";
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
