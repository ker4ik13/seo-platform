import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { RemoteWorkRetentionService } from "../worker-nodes/remote-work-retention.service.js";
import type { Upload } from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { semanticExportResult } from "../semantic-exports/semantic-export-record.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort
} from "../storage/object-storage.port.js";

const BATCH_SIZE = 100;
const MAX_BATCHES = 10;
const DAY_MS = 24 * 60 * 60 * 1_000;
const UPLOAD_CLEANUP_STATUSES = [
  "INITIATED",
  "UPLOADING",
  "READY",
  "REJECTED",
  "ABORTED",
  "EXPIRED"
] as const;
const ACTIVE_IMPORT_STATUSES = [
  "QUEUED",
  "PARSING",
  "AWAITING_MAPPING",
  "VALIDATING",
  "AWAITING_CONFIRMATION",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "CANCEL_REQUESTED"
] as const;

@Injectable()
export class FileRetentionService {
  private readonly logger = new Logger(FileRetentionService.name);

  public constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly remoteWork?: RemoteWorkRetentionService
  ) {}

  public async sweep(now = new Date()): Promise<void> {
    if (!this.storage.isEnabled()) return;
    const uploadCutoff = new Date(
      now.getTime() - this.config.fileRetention.uploadDays * DAY_MS
    );
    const exportCutoff = new Date(
      now.getTime() - this.config.fileRetention.exportDays * DAY_MS
    );
    await this.sweepUploads(uploadCutoff);
    await this.sweepExports(exportCutoff);
    await this.remoteWork?.sweep(now);
  }

  private async sweepUploads(cutoff: Date): Promise<void> {
    let cursor: string | undefined;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const uploads = await this.prisma.upload.findMany({
        where: {
          objectDeletedAt: null,
          status: { in: [...UPLOAD_CLEANUP_STATUSES] },
          ...(cursor ? { id: { gt: cursor } } : {}),
          OR: [
            { uploadedAt: { lte: cutoff } },
            { uploadedAt: null, createdAt: { lte: cutoff } }
          ]
        },
        orderBy: { id: "asc" },
        take: BATCH_SIZE
      });
      for (const upload of uploads) {
        try {
          await this.expireUpload(upload, cutoff);
        } catch {
          this.logger.warn("Unable to expire an uploaded file; next sweep will retry");
        }
      }
      if (uploads.length < BATCH_SIZE) return;
      cursor = uploads.at(-1)?.id;
    }
  }

  private async expireUpload(upload: Upload, cutoff: Date): Promise<void> {
    if (
      upload.bucket !== "uploads" ||
      !upload.projectId ||
      !upload.objectKey.startsWith(`${upload.workspaceId}/${upload.projectId}/`)
    ) {
      throw new Error("Upload object key is outside its project scope");
    }
    const claimed = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{ status: string; multipart_id: string | null }>
      >`
        SELECT status::text AS status, multipart_id
        FROM uploads
        WHERE id = ${upload.id}::uuid
          AND object_deleted_at IS NULL
          AND (uploaded_at <= ${cutoff} OR
               (uploaded_at IS NULL AND created_at <= ${cutoff}))
        FOR UPDATE SKIP LOCKED
      `;
      const current = rows[0];
      if (!current || !UPLOAD_CLEANUP_STATUSES.some((status) => status === current.status)) {
        return null;
      }
      const activeImports = await transaction.semanticImport.count({
        where: {
          uploadId: upload.id,
          status: { in: [...ACTIVE_IMPORT_STATUSES] }
        }
      });
      if (activeImports > 0) return null;
      if (current.status !== "EXPIRED") {
        await transaction.upload.update({
          where: { id: upload.id },
          data: { status: "EXPIRED", version: { increment: 1 } }
        });
      }
      return current;
    });
    if (!claimed) return;
    if (claimed.multipart_id && upload.uploadedAt === null) {
      try {
        await this.storage.abortMultipartUpload(
          "uploads",
          upload.objectKey,
          claimed.multipart_id
        );
      } catch (error) {
        if (!missingMultipart(error)) throw error;
      }
    }
    await this.storage.deleteObject("uploads", upload.objectKey);
    await this.prisma.upload.updateMany({
      where: { id: upload.id, status: "EXPIRED", objectDeletedAt: null },
      data: { objectDeletedAt: new Date(), version: { increment: 1 } }
    });
  }

  private async sweepExports(cutoff: Date): Promise<void> {
    let cursor: string | undefined;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const jobs = await this.prisma.job.findMany({
        where: {
          type: "SEMANTIC_EXPORT",
          status: "COMPLETED",
          stage: "completed",
          finishedAt: { lte: cutoff },
          ...(cursor ? { id: { gt: cursor } } : {})
        },
        orderBy: { id: "asc" },
        take: BATCH_SIZE
      });
      for (const job of jobs) {
        const artifact = semanticExportResult(job);
        if (!artifact) {
          this.logger.warn("Completed export has invalid artifact metadata");
          continue;
        }
        try {
          await this.storage.deleteObject("artifacts", artifact.objectKey);
          await this.prisma.job.updateMany({
            where: {
              id: job.id,
              type: "SEMANTIC_EXPORT",
              status: "COMPLETED",
              stage: "completed",
              finishedAt: { lte: cutoff }
            },
            data: { stage: "expired", version: { increment: 1 } }
          });
        } catch {
          this.logger.warn("Unable to expire an export file; next sweep will retry");
        }
      }
      if (jobs.length < BATCH_SIZE) return;
      cursor = jobs.at(-1)?.id;
    }
  }
}

function missingMultipart(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { readonly name?: unknown; readonly $metadata?: { readonly httpStatusCode?: unknown } };
  return value.name === "NoSuchUpload" || value.$metadata?.httpStatusCode === 404;
}
