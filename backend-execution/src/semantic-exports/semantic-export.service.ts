import { createHash, timingSafeEqual } from "node:crypto";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  InternalCancelSemanticExportInput,
  InternalCreateSemanticExportInput,
  SemanticExportCollection,
  SemanticExportDownload,
  SemanticExportJobSummary
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type { Job } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { assertJobCapacity } from "../jobs/job-capacity.js";
import { QueueService } from "../queue/queue.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort
} from "../storage/object-storage.port.js";
import {
  semanticExportResult,
  semanticExportSummary
} from "./semantic-export-record.js";

const CREATE_SCOPE_PREFIX = "semantic-export:create";
const CANCELLABLE = new Set([
  "QUEUED",
  "RUNNING",
  "CANCEL_REQUESTED",
  "RETRY_SCHEDULED",
  "FAILED_RETRYABLE"
]);

@Injectable()
export class SemanticExportService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort
  ) {}

  public async create(
    input: InternalCreateSemanticExportInput
  ): Promise<SemanticExportJobSummary> {
    if (!this.storage.isEnabled()) {
      throw new HttpException(
        { code: "STORAGE_UNAVAILABLE", message: "Export storage is unavailable" },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const scope = `${CREATE_SCOPE_PREFIX}:${input.projectId}:${input.actorId}`;
    const hash = requestHash(input);
    const existing = await this.existing(input.workspaceId, scope, input.idempotencyKey);
    if (existing) {
      assertReplay(existing, hash);
      await this.enqueueForRecovery(existing);
      return semanticExportSummary(existing);
    }

    let job: Job;
    try {
      job = await this.prisma.$transaction(async (transaction) => {
        await assertJobCapacity(transaction, input.workspaceId, input.jobCapacity);
        return transaction.job.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            type: "SEMANTIC_EXPORT",
            status: "QUEUED",
            stage: "queued",
            actorId: input.actorId,
            idempotencyScope: scope,
            idempotencyKey: input.idempotencyKey,
            requestHash: Buffer.from(hash, "hex"),
            inputSnapshot: exportInputSnapshot(input),
            scopeSnapshot: {
              workspaceId: input.workspaceId,
              projectId: input.projectId
            },
            progressTotal:
              (input.scope === "SELECTED" || input.scope === "CURRENT_PAGE")
                ? BigInt(input.keywordIds?.length ?? 0)
                : null,
            progressUnit: "rows",
            credentialMode: "PLATFORM_INCLUDED",
            correlationId: input.correlationId,
            queuedAt: new Date(),
            maxAttempts: 5
          }
        });
      });
    } catch (error) {
      if (!unique(error)) throw error;
      const winner = await this.existing(input.workspaceId, scope, input.idempotencyKey);
      if (!winner) throw new ConflictException("Semantic export command conflicted");
      assertReplay(winner, hash);
      job = winner;
    }
    await this.enqueueForRecovery(job);
    return semanticExportSummary(job);
  }

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<SemanticExportCollection> {
    const jobs = await this.prisma.job.findMany({
      where: {
        workspaceId,
        projectId,
        type: "SEMANTIC_EXPORT",
        dismissedAt: null
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50
    });
    return { exports: jobs.map(semanticExportSummary) };
  }

  public async get(
    workspaceId: string,
    projectId: string,
    exportId: string
  ): Promise<SemanticExportJobSummary> {
    return semanticExportSummary(await this.required(workspaceId, projectId, exportId));
  }

  public async cancel(
    exportId: string,
    input: InternalCancelSemanticExportInput
  ): Promise<SemanticExportJobSummary> {
    const current = await this.required(input.workspaceId, input.projectId, exportId);
    if (current.version !== input.version) versionConflict();
    if (!CANCELLABLE.has(current.status)) return semanticExportSummary(current);
    const updated = await this.prisma.job.updateMany({
      where: { id: exportId, status: current.status, version: current.version },
      data: {
        status: "CANCELLED",
        cancelRequestedAt: current.cancelRequestedAt ?? new Date(),
        stage: "cancelled",
        finishedAt: new Date(),
        retryAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 }
      }
    });
    if (updated.count !== 1) versionConflict();
    return this.get(input.workspaceId, input.projectId, exportId);
  }

  public async download(
    workspaceId: string,
    projectId: string,
    exportId: string
  ): Promise<SemanticExportDownload> {
    const job = await this.required(workspaceId, projectId, exportId);
    if (job.status === "COMPLETED" && job.stage === "expired") {
      throw new HttpException(
        { code: "EXPORT_FILE_EXPIRED", message: "Export file has expired" },
        HttpStatus.GONE
      );
    }
    const result = semanticExportResult(job);
    if (job.status !== "COMPLETED" || !result) {
      throw new ConflictException("Semantic export is not ready for download");
    }
    const object = await this.storage.headObject("artifacts", result.objectKey);
    if (!object || object.sizeBytes.toString() !== result.sizeBytes) {
      throw new HttpException(
        { code: "EXPORT_ARTIFACT_UNAVAILABLE", message: "Export artifact is unavailable" },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return {
      url: await this.storage.createDownloadUrl("artifacts", result.objectKey, {
        filename: result.filename,
        contentType: result.contentType
      }),
      filename: result.filename,
      contentType: result.contentType,
      rowCount: result.rowCount,
      sizeBytes: result.sizeBytes
    };
  }

  private existing(
    workspaceId: string,
    scope: string,
    key: string
  ): Promise<Job | null> {
    return this.prisma.job.findUnique({
      where: {
        workspaceId_idempotencyScope_idempotencyKey: {
          workspaceId,
          idempotencyScope: scope,
          idempotencyKey: key
        }
      }
    });
  }

  private async required(
    workspaceId: string,
    projectId: string,
    exportId: string
  ): Promise<Job> {
    const job = await this.prisma.job.findFirst({
      where: { id: exportId, workspaceId, projectId, type: "SEMANTIC_EXPORT" }
    });
    if (!job) throw new NotFoundException("Semantic export not found");
    return job;
  }

  private async enqueueForRecovery(job: Job): Promise<void> {
    if (["QUEUED", "RETRY_SCHEDULED", "FAILED_RETRYABLE"].includes(job.status)) {
      await this.queue.enqueueSemanticExport(job.id).catch(() => undefined);
    }
  }
}

function exportInputSnapshot(
  input: InternalCreateSemanticExportInput
): Prisma.InputJsonObject {
  return {
    format: input.format,
    scope: input.scope,
    locale: input.locale,
    columns: [...input.columns],
    ...(input.filters ? { filters: input.filters as Prisma.InputJsonObject } : {}),
    ...(input.sort ? { sort: input.sort } : {}),
    ...(input.rankSortDimensionKey
      ? { rankSortDimensionKey: input.rankSortDimensionKey }
      : {}),
    ...(input.keywordIds ? { keywordIds: [...input.keywordIds] } : {}),
    ...(input.includeBom === undefined ? {} : { includeBom: input.includeBom }),
    ...(input.competitorRows === undefined ? {} : { competitorRows: input.competitorRows }),
    ...(input.positionHistory
      ? {
          positionHistory: {
            ...input.positionHistory,
            searchEngines: [...input.positionHistory.searchEngines]
          }
        }
      : {}),
    ...(input.folderMap
      ? {
          folderMap: {
            groupIds: [...input.folderMap.groupIds],
            includeDescendants: input.folderMap.includeDescendants
          }
        }
      : {})
  };
}

function requestHash(input: InternalCreateSemanticExportInput): string {
  return createHash("sha256")
    .update(JSON.stringify(exportInputSnapshot(input)), "utf8")
    .digest("hex");
}

function assertReplay(job: Job, hash: string): void {
  const expected = Buffer.from(hash, "hex");
  const actual = job.requestHash ? Buffer.from(job.requestHash) : undefined;
  if (
    !actual ||
    actual.byteLength !== expected.byteLength ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new ConflictException({
      code: "IDEMPOTENCY_CONFLICT",
      message: "Idempotency key was already used for another semantic export"
    });
  }
}

function unique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function versionConflict(): never {
  throw new HttpException(
    { code: "VERSION_CONFLICT", message: "Semantic export version conflict" },
    HttpStatus.PRECONDITION_FAILED
  );
}
