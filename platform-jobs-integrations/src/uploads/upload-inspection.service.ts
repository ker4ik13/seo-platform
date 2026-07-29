import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  domainEventTypes,
  type SupportedImportMediaType
} from "@seo-platform/contracts";
import type { Upload } from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  MALWARE_SCANNER,
  type MalwareScannerPort,
  type MalwareScanResult
} from "../malware/malware-scanner.port.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort
} from "../storage/object-storage.port.js";
import { inspectImportMedia } from "./import-media-inspection.js";

const SAMPLE_BYTES = 64 * 1_024;

export interface UploadInspectionOutcome {
  readonly uploadId: string;
  readonly status: "READY" | "REJECTED" | "SKIPPED";
  readonly code?: string;
}

@Injectable()
export class UploadInspectionService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(MALWARE_SCANNER) private readonly malware: MalwareScannerPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async pendingUploadIds(limit = 100): Promise<readonly string[]> {
    const staleBefore = this.staleBefore();
    const uploads = await this.prisma.upload.findMany({
      where: {
        OR: [
          { status: "UPLOADED" },
          {
            status: "SCANNING",
            OR: [
              { inspectionHeartbeatAt: { lt: staleBefore } },
              {
                inspectionHeartbeatAt: null,
                OR: [
                  { inspectionStartedAt: { lt: staleBefore } },
                  { inspectionStartedAt: null }
                ]
              }
            ]
          }
        ]
      },
      orderBy: { uploadedAt: "asc" },
      take: Math.min(Math.max(limit, 1), 500),
      select: { id: true }
    });
    return uploads.map(({ id }) => id);
  }

  public async inspect(uploadId: string): Promise<UploadInspectionOutcome> {
    const claimedAt = new Date();
    const claimed = await this.prisma.upload.updateMany({
      where: {
        id: uploadId,
        OR: [
          { status: "UPLOADED" },
          {
            status: "SCANNING",
            OR: [
              {
                inspectionHeartbeatAt: { lt: this.staleBefore() }
              },
              {
                inspectionHeartbeatAt: null,
                OR: [
                  {
                    inspectionStartedAt: { lt: this.staleBefore() }
                  },
                  { inspectionStartedAt: null }
                ]
              }
            ]
          }
        ]
      },
      data: {
        status: "SCANNING",
        inspectionStartedAt: claimedAt,
        inspectionHeartbeatAt: claimedAt,
        inspectionCompletedAt: null,
        version: { increment: 1 }
      }
    });
    if (claimed.count === 0) {
      const current = await this.prisma.upload.findUnique({
        where: { id: uploadId },
        select: { status: true }
      });
      if (!current) throw new NotFoundException("Upload not found");
      return { uploadId, status: "SKIPPED", code: current.status };
    }

    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId }
    });
    if (!upload) throw new NotFoundException("Upload not found");

    try {
      if (!this.storage.isEnabled()) {
        throw new Error("Object storage is disabled");
      }
      if (!this.malware.isEnabled()) {
        throw new Error("Malware scanner is disabled");
      }
      const source = await this.storage.getObjectStream(
        "uploads",
        upload.objectKey
      );
      const observed = observe(
        source,
        this.config.uploads.inspectionHeartbeatSeconds * 1_000,
        () => this.heartbeat(upload.id, claimedAt)
      );
      const malwareResult = await this.malware.scan(observed.stream);
      const streamResult = observed.result();
      if (malwareResult.status === "INFECTED") {
        return await this.reject(
          upload,
          claimedAt,
          "MALWARE_DETECTED",
          malwareResult,
          streamResult
        );
      }
      if (streamResult.sizeBytes !== upload.sizeBytes) {
        return await this.reject(
          upload,
          claimedAt,
          "SIZE_MISMATCH",
          malwareResult,
          streamResult
        );
      }
      const media = inspectImportMedia(
        streamResult.sample,
        upload.mediaType as SupportedImportMediaType
      );
      if (!media.accepted) {
        return await this.reject(
          upload,
          claimedAt,
          media.rejectionCode ?? "MIME_REJECTED",
          malwareResult,
          streamResult,
          media.detectedMediaType
        );
      }
      if (
        upload.declaredChecksum &&
        upload.declaredChecksum !== streamResult.checksumSha256
      ) {
        return await this.reject(
          upload,
          claimedAt,
          "CHECKSUM_MISMATCH",
          malwareResult,
          streamResult,
          media.detectedMediaType
        );
      }
      return await this.ready(
        upload,
        claimedAt,
        malwareResult,
        streamResult,
        media.detectedMediaType
      );
    } catch (error) {
      await this.releaseForRetry(upload.id, claimedAt);
      throw error;
    }
  }

  private async ready(
    upload: Upload,
    claimedAt: Date,
    malware: MalwareScanResult,
    stream: ObservedStreamResult,
    detectedMediaType: string
  ): Promise<UploadInspectionOutcome> {
    return this.prisma.$transaction(async (transaction) => {
      const completedAt = new Date();
      const changed = await transaction.upload.updateMany({
        where: {
          id: upload.id,
          status: "SCANNING",
          inspectionStartedAt: claimedAt
        },
        data: {
          status: "READY",
          checksum: stream.checksumSha256,
          detectedMediaType,
          scanResult: {
            status: "CLEAN",
            engine: malware.engine,
            checksumAlgorithm: "SHA-256",
            inspectedSizeBytes: stream.sizeBytes.toString()
          },
          inspectionCompletedAt: completedAt,
          version: { increment: 1 }
        }
      });
      if (changed.count === 0) {
        return { uploadId: upload.id, status: "SKIPPED" as const };
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: domainEventTypes.uploadReady,
          aggregateId: upload.id,
          workspaceId: upload.workspaceId,
          projectId: upload.projectId,
          payload: {
            uploadId: upload.id,
            workspaceId: upload.workspaceId,
            projectId: upload.projectId,
            checksumSha256: stream.checksumSha256,
            detectedMediaType
          },
          metadata: {
            producer: "jobs-integrations",
            source: "upload-inspection-worker"
          }
        }
      });
      return { uploadId: upload.id, status: "READY" as const };
    });
  }

  private async reject(
    upload: Upload,
    claimedAt: Date,
    code: string,
    malware: MalwareScanResult,
    stream: ObservedStreamResult,
    detectedMediaType = "application/octet-stream"
  ): Promise<UploadInspectionOutcome> {
    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.upload.updateMany({
        where: {
          id: upload.id,
          status: "SCANNING",
          inspectionStartedAt: claimedAt
        },
        data: {
          status: "REJECTED",
          checksum: stream.checksumSha256,
          detectedMediaType,
          scanResult: {
            status: "REJECTED",
            code,
            engine: malware.engine,
            ...(malware.signature
              ? { malwareSignature: malware.signature }
              : {}),
            checksumAlgorithm: "SHA-256",
            inspectedSizeBytes: stream.sizeBytes.toString()
          },
          inspectionCompletedAt: new Date(),
          version: { increment: 1 }
        }
      });
      if (changed.count === 0) {
        return { uploadId: upload.id, status: "SKIPPED" as const };
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: domainEventTypes.uploadRejected,
          aggregateId: upload.id,
          workspaceId: upload.workspaceId,
          projectId: upload.projectId,
          payload: {
            uploadId: upload.id,
            workspaceId: upload.workspaceId,
            projectId: upload.projectId,
            code
          },
          metadata: {
            producer: "jobs-integrations",
            source: "upload-inspection-worker"
          }
        }
      });
      return { uploadId: upload.id, status: "REJECTED" as const, code };
    });
  }

  private async releaseForRetry(
    uploadId: string,
    claimedAt: Date
  ): Promise<void> {
    await this.prisma.upload.updateMany({
      where: {
        id: uploadId,
        status: "SCANNING",
        inspectionStartedAt: claimedAt
      },
      data: {
        status: "UPLOADED",
        inspectionStartedAt: null,
        inspectionHeartbeatAt: null,
        scanResult: {
          status: "RETRY_PENDING",
          code: "INSPECTION_DEPENDENCY_UNAVAILABLE"
        },
        version: { increment: 1 }
      }
    });
  }

  private staleBefore(): Date {
    return new Date(
      Date.now() -
        this.config.uploads.inspectionLeaseMinutes * 60 * 1_000
    );
  }

  private async heartbeat(
    uploadId: string,
    claimedAt: Date
  ): Promise<void> {
    const updated = await this.prisma.upload.updateMany({
      where: {
        id: uploadId,
        status: "SCANNING",
        inspectionStartedAt: claimedAt
      },
      data: {
        inspectionHeartbeatAt: new Date()
      }
    });
    if (updated.count === 0) {
      throw new Error("Upload inspection lease was lost");
    }
  }
}

interface ObservedStreamResult {
  readonly checksumSha256: string;
  readonly sample: Uint8Array;
  readonly sizeBytes: bigint;
}

function observe(
  source: AsyncIterable<Uint8Array>,
  heartbeatIntervalMs: number,
  heartbeat: () => Promise<void>
): {
  readonly stream: AsyncIterable<Uint8Array>;
  readonly result: () => ObservedStreamResult;
} {
  const hash = createHash("sha256");
  const sample: Buffer[] = [];
  let sampleBytes = 0;
  let sizeBytes = 0n;
  let completed = false;
  let lastHeartbeatAt = Date.now();

  async function* stream(): AsyncGenerator<Uint8Array> {
    for await (const value of source) {
      const chunk = Buffer.from(value);
      sizeBytes += BigInt(chunk.length);
      hash.update(chunk);
      if (sampleBytes < SAMPLE_BYTES) {
        const part = chunk.subarray(
          0,
          Math.min(chunk.length, SAMPLE_BYTES - sampleBytes)
        );
        sample.push(part);
        sampleBytes += part.length;
      }
      if (Date.now() - lastHeartbeatAt >= heartbeatIntervalMs) {
        await heartbeat();
        lastHeartbeatAt = Date.now();
      }
      yield chunk;
    }
    completed = true;
  }

  return {
    stream: stream(),
    result: () => {
      if (!completed) throw new Error("Object stream was not consumed");
      return {
        checksumSha256: hash.digest("hex"),
        sample: Buffer.concat(sample),
        sizeBytes
      };
    }
  };
}
