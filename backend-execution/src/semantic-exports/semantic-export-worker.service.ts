import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalCreateSemanticExportInput,
  KeywordListQuery,
  SemanticKeywordGroup,
  SemanticKeywordListItem,
  SemanticPositionHistoryExportRow,
  SemanticPositionHistorySearchEngine
} from "@seo-platform/contracts";
import {
  Prisma,
  type Job
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  SeoDataClient,
  SeoDataClientError
} from "../seo-data/seo-data.client.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort
} from "../storage/object-storage.port.js";
import { writeArtifact } from "./multipart-object-writer.js";
import {
  semanticExportFile,
  semanticPositionHistoryExportFile,
  type SemanticExportFile,
  type SemanticPositionHistoryWorkbookPlan
} from "./semantic-export-encoder.js";
import { storedSemanticExportInput } from "./semantic-export-input.js";

const PAGE_SIZE = 1_000;
const POSITION_HISTORY_PAGE_SIZE = 25;
const LEASE_MILLISECONDS = 15 * 60 * 1_000;
const MAX_PENDING_EXPORTS = 200;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface SemanticExportWorkerResult {
  readonly exportId: string;
  readonly outcome:
    | "SKIPPED"
    | "COMPLETED"
    | "CANCELLED"
    | "RETRY_SCHEDULED"
    | "FAILED_FINAL";
  readonly rowCount?: number;
}

@Injectable()
export class SemanticExportWorkerService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly seoData: SeoDataClient,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort
  ) {}

  public workerId(): string {
    return `semantic-export-${randomUUID()}`;
  }

  public async process(
    exportId: string,
    leaseOwner: string
  ): Promise<SemanticExportWorkerResult> {
    const claimed = await this.claim(exportId, leaseOwner);
    if (!claimed) return { exportId, outcome: "SKIPPED" };

    let objectKey: string | undefined;
    let artifactStored = false;
    try {
      if (!this.storage.isEnabled()) {
        throw new ExportFailure("STORAGE_UNAVAILABLE", true);
      }
      let input: InternalCreateSemanticExportInput;
      try {
        input = storedSemanticExportInput(claimed);
      } catch {
        throw new ExportFailure("INVALID_EXPORT_MANIFEST", false);
      }
      const context = exportContext(input);
      const counter = { value: 0 };
      let file: SemanticExportFile;
      if (input.positionHistory) {
        const plan = await this.positionHistoryPlan(claimed, input, leaseOwner);
        await this.updateProgressTotal(claimed.id, leaseOwner, plan.rowCount);
        file = semanticPositionHistoryExportFile(
          counted(
            this.exportPositionHistoryRows(claimed, input, leaseOwner, true),
            counter
          ),
          input,
          plan
        );
      } else {
        const customColumns = await this.seoData.listExportCustomColumns(context);
        const customColumnNames = customColumnNameMap(customColumns);
        file = semanticExportFile(
          counted(this.exportRows(claimed, input, leaseOwner), counter),
          input,
          customColumnNames
        );
      }
      objectKey = artifactObjectKey(claimed, file.filename);
      const sizeBytes = await writeArtifact(
        this.storage,
        objectKey,
        file.contentType,
        file.bytes
      );
      artifactStored = true;
      await this.assertLease(claimed.id, leaseOwner, counter.value);
      const storedObject = await this.storage.headObject("artifacts", objectKey);
      if (!storedObject || storedObject.sizeBytes !== sizeBytes) {
        throw new ExportFailure("EXPORT_ARTIFACT_INCOMPLETE", true);
      }
      const completed = await this.prisma.job.updateMany({
        where: {
          id: claimed.id,
          type: "SEMANTIC_EXPORT",
          status: "RUNNING",
          leaseOwner
        },
        data: {
          status: "COMPLETED",
          stage: "completed",
          progressCurrent: BigInt(counter.value),
          progressTotal: BigInt(counter.value),
          resultSummary: {
            objectKey,
            filename: file.filename,
            contentType: file.contentType,
            rowCount: counter.value,
            sizeBytes: sizeBytes.toString()
          },
          errorSummary: Prisma.DbNull,
          finishedAt: new Date(),
          retryAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: { increment: 1 }
        }
      });
      if (completed.count !== 1) {
        await this.assertLease(claimed.id, leaseOwner, counter.value);
        throw new LeaseLost();
      }
      return {
        exportId,
        outcome: "COMPLETED",
        rowCount: counter.value
      };
    } catch (error) {
      if (artifactStored && objectKey) {
        await this.storage.deleteObject("artifacts", objectKey).catch(() => undefined);
      }
      return this.settleFailure(claimed, leaseOwner, error);
    }
  }

  public async pendingIds(): Promise<readonly string[]> {
    const now = new Date();
    const jobs = await this.prisma.job.findMany({
      where: {
        type: "SEMANTIC_EXPORT",
        OR: [
          { status: "QUEUED" },
          { status: "RETRY_SCHEDULED", retryAt: { lte: now } },
          { status: "FAILED_RETRYABLE", retryAt: { lte: now } },
          {
            status: "RUNNING",
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
          }
        ]
      },
      select: { id: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: MAX_PENDING_EXPORTS
    });
    return jobs.map(({ id }) => id);
  }

  private async claim(exportId: string, leaseOwner: string): Promise<Job | undefined> {
    const current = await this.prisma.job.findFirst({
      where: { id: exportId, type: "SEMANTIC_EXPORT" }
    });
    if (!current || !claimable(current, new Date())) return undefined;
    if (current.attempt >= current.maxAttempts) {
      await this.prisma.job.updateMany({
        where: {
          id: current.id,
          type: "SEMANTIC_EXPORT",
          status: current.status,
          version: current.version
        },
        data: {
          status: "FAILED_FINAL",
          stage: "failed",
          errorSummary: { code: "EXPORT_RETRY_EXHAUSTED", retryable: false },
          finishedAt: new Date(),
          retryAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: { increment: 1 }
        }
      });
      return undefined;
    }

    const now = new Date();
    const claimed = await this.prisma.job.updateMany({
      where: {
        id: current.id,
        type: "SEMANTIC_EXPORT",
        status: current.status,
        version: current.version,
        attempt: current.attempt
      },
      data: {
        status: "RUNNING",
        stage: "generating",
        attempt: { increment: 1 },
        progressCurrent: 0n,
        ...(current.progressTotal === null ? {} : { progressTotal: current.progressTotal }),
        errorSummary: Prisma.DbNull,
        resultSummary: Prisma.DbNull,
        startedAt: current.startedAt ?? now,
        finishedAt: null,
        retryAt: null,
        cancelRequestedAt: null,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MILLISECONDS),
        version: { increment: 1 }
      }
    });
    if (claimed.count !== 1) return undefined;
    return (await this.prisma.job.findUnique({ where: { id: current.id } })) ?? undefined;
  }

  private async *exportRows(
    job: Job,
    input: InternalCreateSemanticExportInput,
    leaseOwner: string
  ): AsyncGenerator<SemanticKeywordListItem> {
    const context = exportContext(input);
    const selected = input.keywordIds ? new Set(input.keywordIds) : undefined;
    const query = await this.exportQuery(input, context);
    let cursor: string | undefined;
    let exportedRows = 0;
    const observedCursors = new Set<string>();
    do {
      await this.assertLease(job.id, leaseOwner, exportedRows);
      const page = await this.seoData.listExportKeywords(context, {
        ...query,
        ...(cursor ? { cursor } : {})
      });
      if (page.page.totalApprox !== undefined) {
        await this.updateProgressTotal(
          job.id,
          leaseOwner,
          selected ? selected.size + exportedRows : page.page.totalApprox
        );
      }
      for (const item of page.data) {
        if (selected && !selected.delete(item.id)) continue;
        exportedRows += 1;
        if (!Number.isSafeInteger(exportedRows)) {
          throw new ExportFailure("EXPORT_ROW_COUNT_TOO_LARGE", false);
        }
        yield item;
      }
      await this.assertLease(job.id, leaseOwner, exportedRows);
      if (selected?.size === 0) break;
      if (!page.page.hasNext) break;
      const nextCursor = page.page.nextCursor;
      if (!nextCursor || observedCursors.has(nextCursor)) {
        throw new ExportFailure("EXPORT_PAGINATION_STALLED", true);
      }
      observedCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);

    if (selected && selected.size > 0) {
      throw new ExportFailure("EXPORT_KEYWORDS_UNAVAILABLE", false);
    }
  }

  private async positionHistoryPlan(
    job: Job,
    input: InternalCreateSemanticExportInput,
    leaseOwner: string
  ): Promise<SemanticPositionHistoryWorkbookPlan> {
    if (!input.positionHistory) {
      throw new ExportFailure("INVALID_EXPORT_MANIFEST", false);
    }
    const dates: Record<
      SemanticPositionHistorySearchEngine,
      Set<string>
    > = {
      YANDEX: new Set(),
      GOOGLE: new Set()
    };
    let rowCount = 0;
    for await (const row of this.exportPositionHistoryRows(
      job,
      input,
      leaseOwner,
      false
    )) {
      rowCount += 1;
      for (const snapshot of row.snapshots) {
        if (!input.positionHistory.searchEngines.includes(snapshot.searchEngine)) {
          throw new ExportFailure("INVALID_EXPORT_DATA", false);
        }
        dates[snapshot.searchEngine].add(snapshot.observedDate);
      }
    }
    return {
      rowCount,
      dates: {
        YANDEX: [...dates.YANDEX].sort().reverse(),
        GOOGLE: [...dates.GOOGLE].sort().reverse()
      }
    };
  }

  private async *exportPositionHistoryRows(
    job: Job,
    input: InternalCreateSemanticExportInput,
    leaseOwner: string,
    reportProgress: boolean
  ): AsyncGenerator<SemanticPositionHistoryExportRow> {
    if (!input.positionHistory) {
      throw new ExportFailure("INVALID_EXPORT_MANIFEST", false);
    }
    const context = exportContext(input);
    const selected = input.keywordIds ? new Set(input.keywordIds) : undefined;
    const query = await this.exportQuery(
      input,
      context,
      POSITION_HISTORY_PAGE_SIZE
    );
    let cursor: string | undefined;
    let exportedRows = 0;
    const observedCursors = new Set<string>();
    do {
      await this.assertLease(
        job.id,
        leaseOwner,
        reportProgress ? exportedRows : 0
      );
      const page = await this.seoData.listExportPositionHistory(
        context,
        { ...query, ...(cursor ? { cursor } : {}) },
        input.positionHistory
      );
      if (reportProgress && page.page.totalApprox !== undefined) {
        await this.updateProgressTotal(
          job.id,
          leaseOwner,
          selected ? selected.size + exportedRows : page.page.totalApprox
        );
      }
      for (const item of page.data) {
        if (selected && !selected.delete(item.keywordId)) continue;
        exportedRows += 1;
        if (!Number.isSafeInteger(exportedRows)) {
          throw new ExportFailure("EXPORT_ROW_COUNT_TOO_LARGE", false);
        }
        yield item;
      }
      await this.assertLease(
        job.id,
        leaseOwner,
        reportProgress ? exportedRows : 0
      );
      if (selected?.size === 0) break;
      if (!page.page.hasNext) break;
      const nextCursor = page.page.nextCursor;
      if (!nextCursor || observedCursors.has(nextCursor)) {
        throw new ExportFailure("EXPORT_PAGINATION_STALLED", true);
      }
      observedCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);

    if (selected && selected.size > 0) {
      throw new ExportFailure("EXPORT_KEYWORDS_UNAVAILABLE", false);
    }
  }

  private async exportQuery(
    input: InternalCreateSemanticExportInput,
    context: ReturnType<typeof exportContext>,
    pageSize = PAGE_SIZE
  ): Promise<KeywordListQuery> {
    const base: KeywordListQuery = {
      limit: pageSize,
      ...input.filters,
      sort: input.sort ?? "CREATED_DESC"
    };
    if (input.scope !== "GROUP_SUBTREE") return base;

    const groups = await this.seoData.listExportKeywordGroups(context);
    const rootId = input.filters?.groupId;
    if (!rootId || !groups.some(({ id }) => id === rootId)) {
      throw new ExportFailure("EXPORT_GROUP_NOT_FOUND", false);
    }
    const descendants = descendantGroupIds(groups, rootId);
    const { groupId: _groupId, ...filters } = input.filters;
    return {
      limit: pageSize,
      ...filters,
      ...(descendants.length === 1
        ? { groupId: rootId }
        : { groupIds: descendants }),
      sort: input.sort ?? "CREATED_DESC"
    };
  }

  private async updateProgressTotal(
    exportId: string,
    leaseOwner: string,
    total: number
  ): Promise<void> {
    if (!Number.isSafeInteger(total) || total < 0) return;
    await this.prisma.job.updateMany({
      where: {
        id: exportId,
        type: "SEMANTIC_EXPORT",
        status: "RUNNING",
        leaseOwner
      },
      data: {
        progressTotal: BigInt(total),
        leaseExpiresAt: new Date(Date.now() + LEASE_MILLISECONDS),
        version: { increment: 1 }
      }
    });
  }

  private async assertLease(
    exportId: string,
    leaseOwner: string,
    processedRows: number
  ): Promise<void> {
    const renewed = await this.prisma.job.updateMany({
      where: {
        id: exportId,
        type: "SEMANTIC_EXPORT",
        status: "RUNNING",
        leaseOwner
      },
      data: {
        progressCurrent: BigInt(processedRows),
        leaseExpiresAt: new Date(Date.now() + LEASE_MILLISECONDS),
        version: { increment: 1 }
      }
    });
    if (renewed.count === 1) return;
    const current = await this.prisma.job.findUnique({ where: { id: exportId } });
    if (current?.status === "CANCEL_REQUESTED") throw new ExportCancelled();
    throw new LeaseLost();
  }

  private async settleFailure(
    job: Job,
    leaseOwner: string,
    error: unknown
  ): Promise<SemanticExportWorkerResult> {
    if (error instanceof LeaseLost) {
      return { exportId: job.id, outcome: "SKIPPED" };
    }
    const current = await this.prisma.job.findUnique({ where: { id: job.id } });
    if (
      error instanceof ExportCancelled ||
      current?.status === "CANCEL_REQUESTED"
    ) {
      await this.prisma.job.updateMany({
        where: {
          id: job.id,
          type: "SEMANTIC_EXPORT",
          status: "CANCEL_REQUESTED",
          leaseOwner
        },
        data: {
          status: "CANCELLED",
          stage: "cancelled",
          finishedAt: new Date(),
          retryAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: { increment: 1 }
        }
      });
      return { exportId: job.id, outcome: "CANCELLED" };
    }
    if (current?.status !== "RUNNING" || current.leaseOwner !== leaseOwner) {
      return { exportId: job.id, outcome: "SKIPPED" };
    }

    const failure = exportFailure(error);
    const retryable = failure.retryable && current.attempt < current.maxAttempts;
    const now = new Date();
    const retryAt = retryable
      ? new Date(now.getTime() + retryDelayMilliseconds(current.attempt))
      : null;
    await this.prisma.job.updateMany({
      where: {
        id: job.id,
        type: "SEMANTIC_EXPORT",
        status: "RUNNING",
        leaseOwner,
        version: current.version
      },
      data: {
        status: retryable ? "RETRY_SCHEDULED" : "FAILED_FINAL",
        stage: retryable ? "retry_scheduled" : "failed",
        errorSummary: { code: failure.code, retryable },
        ...(retryable ? { retryAt } : { retryAt: null, finishedAt: now }),
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 }
      }
    });
    return {
      exportId: job.id,
      outcome: retryable ? "RETRY_SCHEDULED" : "FAILED_FINAL"
    };
  }
}

async function* counted<Row>(
  rows: AsyncIterable<Row>,
  counter: { value: number }
): AsyncGenerator<Row> {
  for await (const row of rows) {
    counter.value += 1;
    yield row;
  }
}

function claimable(job: Job, now: Date): boolean {
  if (job.status === "QUEUED") return true;
  if (
    job.status === "RETRY_SCHEDULED" ||
    job.status === "FAILED_RETRYABLE"
  ) {
    return job.retryAt !== null && job.retryAt <= now;
  }
  return (
    job.status === "RUNNING" &&
    (job.leaseExpiresAt === null || job.leaseExpiresAt <= now)
  );
}

function exportContext(input: InternalCreateSemanticExportInput): {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
} {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId
  };
}

function customColumnNameMap(
  columns: readonly { readonly id: string; readonly name: string }[]
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const column of columns) {
    if (
      !UUID_PATTERN.test(column.id) ||
      typeof column.name !== "string" ||
      column.name.length < 1 ||
      column.name.length > 160
    ) {
      throw new ExportFailure("INVALID_EXPORT_METADATA", false);
    }
    result[column.id.toLowerCase()] = column.name;
  }
  return result;
}

function descendantGroupIds(
  groups: readonly SemanticKeywordGroup[],
  rootId: string
): readonly string[] {
  if (
    groups.some(
      (group) =>
        !UUID_PATTERN.test(group.id) ||
        (group.parentId !== undefined && !UUID_PATTERN.test(group.parentId))
    )
  ) {
    throw new ExportFailure("INVALID_EXPORT_METADATA", false);
  }
  const result = new Set([rootId]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const group of groups) {
      if (group.parentId && result.has(group.parentId) && !result.has(group.id)) {
        result.add(group.id);
        changed = true;
      }
    }
  }
  return [...result].sort();
}

function artifactObjectKey(job: Job, filename: string): string {
  if (!job.projectId) throw new ExportFailure("INVALID_EXPORT_MANIFEST", false);
  const extension = filename.split(".").at(-1);
  if (!extension || !/^[a-z0-9]{2,8}$/u.test(extension)) {
    throw new ExportFailure("INVALID_EXPORT_MANIFEST", false);
  }
  if (!Number.isSafeInteger(job.attempt) || job.attempt < 1) {
    throw new ExportFailure("INVALID_EXPORT_MANIFEST", false);
  }
  return `${job.workspaceId}/${job.projectId}/semantic-exports/${job.id}/attempt-${job.attempt}.${extension}`;
}

function retryDelayMilliseconds(attempt: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

function exportFailure(error: unknown): ExportFailure {
  if (error instanceof ExportFailure) return error;
  if (error instanceof SeoDataClientError) {
    return new ExportFailure(`SEO_DATA_${error.code}`, error.retryable);
  }
  if (error instanceof TypeError) {
    return new ExportFailure("INVALID_EXPORT_DATA", false);
  }
  return new ExportFailure("EXPORT_DEPENDENCY_UNAVAILABLE", true);
}

class ExportFailure extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "ExportFailure";
  }
}

class ExportCancelled extends Error {}
class LeaseLost extends Error {}
