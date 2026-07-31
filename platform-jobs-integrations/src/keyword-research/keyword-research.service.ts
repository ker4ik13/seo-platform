import { createHash } from "node:crypto";
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
  KeywordResearchRunSummary
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  entitlementJson,
  keywordResearchSummary
} from "./keyword-research-record.js";

const CREATE_SCOPE = "keyword-research:create";
const CANCELLABLE = [
  "QUEUED",
  "RUNNING",
  "RETRY_SCHEDULED",
  "READY_TO_IMPORT"
] as const;

@Injectable()
export class KeywordResearchService {
  public constructor(private readonly prisma: PrismaService) {}

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

    const binding = await this.prisma.projectConnectorBinding.findUnique({
      where: {
        workspaceId_projectId_capability: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          capability: "COMPETITOR_RESEARCH"
        }
      },
      include: {
        routes: {
          orderBy: { position: "asc" },
          include: { credential: true }
        }
      }
    });
    const route = binding?.routes[0];
    if (
      !binding?.enabled ||
      binding.routes.length !== 1 ||
      !route ||
      route.position !== 0 ||
      route.credential.provider !== "KEYS_SO" ||
      route.credential.mode !== "BYOK_API_KEY" ||
      route.credential.status !== "ACTIVE" ||
      route.credential.deletedAt !== null ||
      !capabilities(route.credential.capabilities).includes(
        "COMPETITOR_RESEARCH"
      )
    ) {
      throw new HttpException(
        {
          code: "CONNECTOR_NOT_READY",
          message:
            "Configure and verify an active Keys.so competitor research credential"
        },
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }

    try {
      const run = await this.prisma.$transaction(async (transaction) => {
        const job = await transaction.job.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            type: "KEYWORD_RESEARCH",
            status: "QUEUED",
            stage: "collecting",
            actorId: input.actorId,
            idempotencyScope: CREATE_SCOPE,
            idempotencyKey: input.idempotencyKey,
            requestHash: Buffer.from(hash, "hex"),
            inputSnapshot: {
              domain: input.domain,
              database: input.database,
              maxKeywords: input.maxKeywords
            },
            scopeSnapshot: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              bindingId: binding.id,
              routeId: route.id,
              credentialId: route.credentialId
            },
            progressTotal: BigInt(input.maxKeywords),
            progressUnit: "keywords",
            credentialMode: "BYOK_API_KEY",
            provider: "KEYS_SO",
            correlationId: input.correlationId,
            queuedAt: new Date(),
            maxAttempts: 8
          }
        });
        return transaction.keywordResearchRun.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            jobId: job.id,
            actorId: input.actorId,
            bindingId: binding.id,
            routeId: route.id,
            credentialId: route.credentialId,
            provider: "KEYS_SO",
            domain: input.domain,
            database: input.database,
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
      const selected = await transaction.keywordResearchRow.count({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          runId,
          id: { in: [...input.selectedRowIds] }
        }
      });
      if (selected !== input.selectedRowIds.length) {
        throw new ConflictException("Selected keyword research rows are stale");
      }
      await transaction.keywordResearchRow.updateMany({
        where: { runId },
        data: { selected: false }
      });
      await transaction.keywordResearchRow.updateMany({
        where: { runId, id: { in: [...input.selectedRowIds] } },
        data: { selected: true }
      });
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
    .update("seo-platform:keyword-research:create:v1\0", "utf8")
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        domain: input.domain,
        database: input.database,
        maxKeywords: input.maxKeywords
      }),
      "utf8"
    )
    .digest("hex");
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

function capabilities(value: Prisma.JsonValue): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
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
