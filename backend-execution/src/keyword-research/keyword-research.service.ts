import { createHash } from "node:crypto";
import { paidOperationJobFields } from "../paid-operations/paid-operation-admission.js";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  InternalCancelKeywordResearchRunInput,
  InternalConfirmKeywordResearchRunInput,
  InternalCreateKeywordResearchRunInput,
  InternalRetryKeywordResearchImportInput,
  KeywordResearchRunSummary,
  KeywordResearchRowPage
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { assertJobCapacity } from "../jobs/job-capacity.js";
import { WorkspaceConnectorRoutingService } from "../integrations/workspace-connector-routing.service.js";
import {
  entitlementJson,
  keywordResearchRowPage,
  keywordResearchSummary
} from "./keyword-research-record.js";

function destinationsByPath(
  destinations: NonNullable<InternalConfirmKeywordResearchRunInput["rowDestinations"]>
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const { rowId, targetGroupPath } of destinations) {
    const rowIds = grouped.get(targetGroupPath) ?? [];
    rowIds.push(rowId);
    grouped.set(targetGroupPath, rowIds);
  }
  return grouped;
}

const CREATE_SCOPE = "keyword-research:create";
const CANCELLABLE = [
  "QUEUED",
  "RUNNING",
  "RETRY_SCHEDULED",
  "READY_TO_IMPORT"
] as const;

@Injectable()
export class KeywordResearchService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly routing: WorkspaceConnectorRoutingService
  ) {}

  public async create(
    input: InternalCreateKeywordResearchRunInput
  ): Promise<KeywordResearchRunSummary> {
    const hash = requestHash(input);
    const existing = await this.prisma.job.findUnique({
      where: {
        workspaceId_idempotencyScope_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyScope: CREATE_SCOPE,
          idempotencyKey: input.idempotencyKey
        }
      },
      include: { keywordResearchRun: { include: { rows: true } } }
    });
    if (existing) return replay(existing, hash);

    const capability = input.source === "KEYS_SO"
      ? "COMPETITOR_RESEARCH"
      : "KEYWORD_RESEARCH";
    const expectedProvider = input.source === "KEYS_SO"
      ? "KEYS_SO"
      : input.source === "ARSENKIN_WORDSTAT"
        ? "ARSENKIN"
        : "XMLSTOCK";
    const route = await this.routing.resolve(
      input.workspaceId,
      input.projectId,
      capability,
      input.actorId,
      expectedProvider,
      input.billing?.credentialId
    );
    if (route.provider !== expectedProvider) {
      throw new HttpException(
        {
          code: "CONNECTOR_NOT_READY",
          message: input.source === "KEYS_SO"
            ? "Configure and verify an active Keys.so competitor research credential"
            : input.source === "ARSENKIN_WORDSTAT"
              ? "Configure and verify an active Arsenkin Wordstat credential"
              : "Configure and verify an active XMLStock Wordstat credential"
        },
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }

    try {
      const run = await this.prisma.$transaction(async (transaction) => {
        await assertJobCapacity(
          transaction,
          input.workspaceId,
          input.jobCapacity
        );
        const inputSnapshot = researchInputSnapshot(input);
        const job = await transaction.job.create({
          data: {
            ...paidOperationJobFields("KEYWORD_RESEARCH", input, route),
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            type: "KEYWORD_RESEARCH",
            status: "QUEUED",
            stage: "collecting",
            actorId: input.actorId,
            idempotencyScope: CREATE_SCOPE,
            idempotencyKey: input.idempotencyKey,
            requestHash: Buffer.from(hash, "hex"),
            inputSnapshot,
            scopeSnapshot: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              bindingId: route.bindingId,
              bindingVersion: route.bindingVersion,
              routeId: route.routeId,
              credentialId: route.credentialId,
              routingScope: route.routingScope,
              connectorAttempts: route.attempts.map((entry) => ({
                sequence: entry.sequence,
                provider: entry.provider,
                routingScope: entry.routingScope,
                outcome: entry.outcome,
                ...(entry.reasonCode ? { reasonCode: entry.reasonCode } : {}),
                occurredAt: entry.occurredAt
              }))
            },
            progressTotal: BigInt(input.maxKeywords),
            progressUnit: "keywords",
            credentialMode: route.credentialMode,
            provider: expectedProvider,
            correlationId: input.correlationId,
            queuedAt: new Date(),
            maxAttempts: input.source === "ARSENKIN_WORDSTAT" ? 120 : 8
          }
        });
        return transaction.keywordResearchRun.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            jobId: job.id,
            actorId: input.actorId,
            bindingId: route.bindingId,
            routeId: route.routeId,
            credentialId: route.credentialId,
            source: input.source,
            provider: expectedProvider,
            ...(input.source === "KEYS_SO"
              ? { domain: input.domain, database: input.database }
              : {}),
            inputSnapshot,
            maxKeywords: input.maxKeywords
          },
          include: { rows: true }
        });
      });
      return keywordResearchSummary(run, run.rows);
    } catch (error) {
      if (!unique(error)) throw error;
      const winner = await this.prisma.job.findUnique({
        where: {
          workspaceId_idempotencyScope_idempotencyKey: {
            workspaceId: input.workspaceId,
            idempotencyScope: CREATE_SCOPE,
            idempotencyKey: input.idempotencyKey
          }
        },
        include: { keywordResearchRun: { include: { rows: true } } }
      });
      if (winner) return replay(winner, hash);
      throw new ConflictException("Keyword research command conflicted");
    }
  }

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly KeywordResearchRunSummary[]> {
    const runs = await this.prisma.keywordResearchRun.findMany({
      where: { workspaceId, projectId },
      include: { rows: { orderBy: { ordinal: "asc" }, take: 500 } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25
    });
    return runs.map((run) => keywordResearchSummary(run, run.rows));
  }

  public async get(
    workspaceId: string,
    projectId: string,
    runId: string
  ): Promise<KeywordResearchRunSummary> {
    const run = await this.required(workspaceId, projectId, runId);
    return keywordResearchSummary(run, run.rows);
  }

  public async rows(
    workspaceId: string,
    projectId: string,
    runId: string,
    query: Readonly<{ cursor?: number; limit: number }>
  ): Promise<KeywordResearchRowPage> {
    const run = await this.prisma.keywordResearchRun.findFirst({
      where: { id: runId, workspaceId, projectId },
      select: { id: true }
    });
    if (!run) throw new NotFoundException("Keyword research run not found");
    const rows = await this.prisma.keywordResearchRow.findMany({
      where: {
        workspaceId,
        projectId,
        runId,
        ...(query.cursor === undefined
          ? {}
          : { ordinal: { gt: query.cursor } })
      },
      orderBy: [{ ordinal: "asc" }, { id: "asc" }],
      take: query.limit + 1
    });
    return keywordResearchRowPage(rows, query.limit);
  }

  public async confirm(
    runId: string,
    input: InternalConfirmKeywordResearchRunInput
  ): Promise<KeywordResearchRunSummary> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.keywordResearchRun.findFirst({
        where: {
          id: runId,
          workspaceId: input.workspaceId,
          projectId: input.projectId
        }
      });
      if (!current) throw new NotFoundException("Keyword research run not found");
      assertVersion(current.version, input.version);
      if (current.status !== "READY_TO_IMPORT") {
        throw new ConflictException("Keyword research run is not ready to import");
      }
      if (current.source !== "KEYS_SO" && !input.targetGroupPath) {
        throw new ConflictException("Choose a target folder for Wordstat keywords");
      }
      const selectedRowIds = input.selectedRowIds ?? [];
      const excludedRowIds = input.excludedRowIds ?? [];
      const totalRows = await transaction.keywordResearchRow.count({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          runId
        }
      });
      const explicitRowIds = input.selectionMode === "ALL"
        ? excludedRowIds
        : selectedRowIds;
      const matchedExplicitRows = explicitRowIds.length === 0
        ? 0
        : await transaction.keywordResearchRow.count({
            where: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              runId,
              id: { in: [...explicitRowIds] }
            }
          });
      const expectedExplicitRows = input.selectionMode === "ALL"
        ? excludedRowIds.length
        : selectedRowIds.length;
      if (matchedExplicitRows !== expectedExplicitRows) {
        throw new ConflictException("Selected keyword research rows are stale");
      }
      const selected = input.selectionMode === "ALL"
        ? totalRows - excludedRowIds.length
        : selectedRowIds.length;
      if (selected < 1) {
        throw new ConflictException("Keyword research selection is empty");
      }
      const rowDestinations = input.rowDestinations ?? [];
      if (rowDestinations.length > 0) {
        const destinationRows = await transaction.keywordResearchRow.count({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            runId,
            id: { in: rowDestinations.map(({ rowId }) => rowId) }
          }
        });
        if (destinationRows !== rowDestinations.length) {
          throw new ConflictException("Keyword research folder assignments are stale");
        }
      }
      await transaction.keywordResearchRow.updateMany({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          runId
        },
        data: {
          selected: input.selectionMode === "ALL",
          targetGroupPath: null
        }
      });
      if (input.selectionMode === "SELECTED") {
        await transaction.keywordResearchRow.updateMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            runId,
            id: { in: [...selectedRowIds] }
          },
          data: { selected: true }
        });
      } else if (excludedRowIds.length > 0) {
        await transaction.keywordResearchRow.updateMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            runId,
            id: { in: [...excludedRowIds] }
          },
          data: { selected: false }
        });
      }
      for (const [targetGroupPath, rowIds] of destinationsByPath(rowDestinations)) {
        const assigned = await transaction.keywordResearchRow.updateMany({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            runId,
            selected: true,
            id: { in: [...rowIds] }
          },
          data: { targetGroupPath }
        });
        if (assigned.count !== rowIds.length) {
          throw new ConflictException("Keyword research folder assignments are stale");
        }
      }
      const updated = await transaction.keywordResearchRun.updateMany({
        where: {
          id: runId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "READY_TO_IMPORT",
          version: input.version
        },
        data: {
          status: "IMPORT_QUEUED",
          selectedKeywords: selected,
          duplicatePolicy: input.duplicatePolicy,
          targetGroupPath: input.targetGroupPath ?? null,
          distributionMode: input.distributionMode ?? "SINGLE_GROUP",
          entitlement: entitlementJson(input.entitlement),
          failureCode: null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw versionConflict();
      await transaction.job.update({
        where: { id: current.jobId },
        data: {
          status: "QUEUED",
          stage: "importing",
          progressCurrent: 0,
          progressTotal: BigInt(selected),
          retryAt: null,
          errorSummary: Prisma.JsonNull,
          version: { increment: 1 }
        }
      });
    });
    return this.get(input.workspaceId, input.projectId, runId);
  }

  public async cancel(
    runId: string,
    input: InternalCancelKeywordResearchRunInput
  ): Promise<KeywordResearchRunSummary> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.keywordResearchRun.findFirst({
        where: {
          id: runId,
          workspaceId: input.workspaceId,
          projectId: input.projectId
        }
      });
      if (!current) throw new NotFoundException("Keyword research run not found");
      assertVersion(current.version, input.version);
      if (
        !CANCELLABLE.includes(
          current.status as (typeof CANCELLABLE)[number]
        )
      ) {
        return;
      }
      const updated = await transaction.keywordResearchRun.updateMany({
        where: { id: runId, status: current.status, version: input.version },
        data: {
          status: "CANCELLED",
          retryAt: null,
          leaseToken: null,
          finishedAt: new Date(),
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw versionConflict();
      await transaction.job.update({
        where: { id: current.jobId },
        data: {
          status: "CANCELLED",
          retryAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          finishedAt: new Date(),
          version: { increment: 1 }
        }
      });
    });
    return this.get(input.workspaceId, input.projectId, runId);
  }

  public async retryImport(
    runId: string,
    input: InternalRetryKeywordResearchImportInput
  ): Promise<KeywordResearchRunSummary> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.keywordResearchRun.findFirst({
        where: {
          id: runId,
          workspaceId: input.workspaceId,
          projectId: input.projectId
        }
      });
      if (!current) throw new NotFoundException("Keyword research run not found");
      assertVersion(current.version, input.version);
      if (
        current.status !== "FAILED" ||
        !current.failureCode?.startsWith("SEO_DATA_") ||
        current.selectedKeywords < 1 ||
        current.duplicatePolicy === null ||
        current.entitlement === null
      ) {
        throw new ConflictException("Keyword research import cannot be retried");
      }
      const updated = await transaction.keywordResearchRun.updateMany({
        where: {
          id: runId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          status: "FAILED",
          version: input.version
        },
        data: {
          status: "IMPORT_QUEUED",
          failureCode: null,
          retryAt: null,
          finishedAt: null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw versionConflict();
      await transaction.job.update({
        where: { id: current.jobId },
        data: {
          status: "QUEUED",
          stage: "importing",
          progressCurrent: 0,
          progressTotal: BigInt(current.selectedKeywords),
          retryAt: null,
          errorSummary: Prisma.JsonNull,
          leaseOwner: null,
          leaseExpiresAt: null,
          finishedAt: null,
          version: { increment: 1 }
        }
      });
    });
    return this.get(input.workspaceId, input.projectId, runId);
  }

  private async required(workspaceId: string, projectId: string, runId: string) {
    const run = await this.prisma.keywordResearchRun.findFirst({
      where: { id: runId, workspaceId, projectId },
      include: { rows: { orderBy: { ordinal: "asc" }, take: 500 } }
    });
    if (!run) throw new NotFoundException("Keyword research run not found");
    return run;
  }
}

function requestHash(input: InternalCreateKeywordResearchRunInput): string {
  return createHash("sha256")
    .update("seo-platform:keyword-research:create:v2\0", "utf8")
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        input: researchInputSnapshot(input)
      }),
      "utf8"
    )
    .digest("hex");
}

function researchInputSnapshot(
  input: InternalCreateKeywordResearchRunInput
): Prisma.InputJsonValue {
  return (input.source === "KEYS_SO"
    ? {
        source: input.source,
        domain: input.domain,
        database: input.database,
        maxKeywords: input.maxKeywords
      }
    : {
        source: input.source,
        queries: input.queries,
        regionCode: input.regionCode,
        device: input.device,
        minusWords: input.minusWords,
        clearMinusPhrases: input.clearMinusPhrases,
        includeRightColumn: input.includeRightColumn,
        clearPlus: input.clearPlus,
        maxKeywords: input.maxKeywords
      }) as unknown as Prisma.InputJsonValue;
}

function replay(
  job: {
    readonly requestHash: Uint8Array | null;
    readonly keywordResearchRun: ({
      readonly rows: readonly import("../generated/prisma/client.js").KeywordResearchRow[];
    } & import("../generated/prisma/client.js").KeywordResearchRun) | null;
  },
  hash: string
): KeywordResearchRunSummary {
  if (
    !job.requestHash ||
    Buffer.from(job.requestHash).toString("hex") !== hash ||
    !job.keywordResearchRun
  ) {
    throw new ConflictException("Idempotency key was already used");
  }
  return keywordResearchSummary(job.keywordResearchRun, job.keywordResearchRun.rows);
}

function unique(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) throw versionConflict(actual, expected);
}

function versionConflict(actual?: number, expected?: number): HttpException {
  return new HttpException(
    {
      code: "VERSION_CONFLICT",
      message: "Keyword research run version is stale",
      ...(actual === undefined
        ? {}
        : { details: { expectedVersion: expected, actualVersion: actual } })
    },
    HttpStatus.CONFLICT
  );
}
