import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  FrequencyCollectionSummary,
  InternalCancelFrequencyCollectionInput,
  InternalCreateFrequencyCollectionInput,
  InternalFrequencyOperationScope,
  InternalFrequencyOperationScopeItem,
  InternalRetryFrequencyCollectionInput
} from "@seo-platform/contracts";
import {
  arsenkinWordstatKeywordLimit,
  xmlStockWordstatKeywordLimit
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { assertJobCapacity } from "../jobs/job-capacity.js";
import { WorkspaceConnectorRoutingService } from "../integrations/workspace-connector-routing.service.js";
import {
  frequencyCollectionSummary,
  type FrequencyJob
} from "./frequency-collection-record.js";

const CREATE_SCOPE = "frequency-collection:create";
const ARSENKIN_WORDSTAT_MAX_ATTEMPTS = 720;
const FREQUENCY_JOB_ITEM_CREATE_BATCH_LIMIT = 2_000;
const FREQUENCY_CREATE_TRANSACTION_MAX_WAIT_MS = 5_000;
const FREQUENCY_CREATE_TRANSACTION_TIMEOUT_MS = 30_000;
const CANCELLABLE = new Set([
  "QUEUED",
  "RUNNING",
  "WAITING_RATE_LIMIT",
  "RETRY_SCHEDULED",
  "FAILED_RETRYABLE"
]);

@Injectable()
export class FrequencyCollectionService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly routing: WorkspaceConnectorRoutingService
  ) {}

  public async create(
    input: InternalCreateFrequencyCollectionInput
  ): Promise<FrequencyCollectionSummary> {
    const hash = requestHash(input);
    const existing = await this.existing(input.workspaceId, input.idempotencyKey);
    if (existing) return replay(existing, hash);

    const route = await this.routing.resolve(
      input.workspaceId,
      input.projectId,
      "WORDSTAT",
      input.actorId
    );
    if (route.provider !== "XMLSTOCK" && route.provider !== "ARSENKIN") {
      throw new Error("Resolved Wordstat provider is unsupported");
    }
    const providerKeywordLimit =
      route.provider === "ARSENKIN"
        ? arsenkinWordstatKeywordLimit
        : xmlStockWordstatKeywordLimit;
    if (input.items.length > providerKeywordLimit) {
      throw new BadRequestException(
        `Wordstat provider accepts at most ${providerKeywordLimit} keywords per collection`
      );
    }

    try {
      const job = await this.prisma.$transaction(
        async (transaction) => {
          await assertJobCapacity(
            transaction,
            input.workspaceId,
            input.jobCapacity
          );
          const created = await transaction.job.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              type: "FREQUENCY_COLLECTION",
              status: "QUEUED",
              stage: "collecting",
              actorId: input.actorId,
              idempotencyScope: CREATE_SCOPE,
              idempotencyKey: input.idempotencyKey,
              requestHash: Buffer.from(hash, "hex"),
              inputSnapshot: {
                types: [...input.types],
                regionCode: input.regionCode,
                device: input.device
              },
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
              progressTotal: BigInt(input.items.length),
              progressUnit: "keywords",
              credentialMode: route.credentialMode,
              provider: route.provider,
              correlationId: input.correlationId,
              queuedAt: new Date(),
              maxAttempts:
                route.provider === "ARSENKIN"
                  ? ARSENKIN_WORDSTAT_MAX_ATTEMPTS
                  : 8
            }
          });
          const itemRows = frequencyJobItems(input).map((item) => ({
            ...item,
            workspaceId: input.workspaceId,
            jobId: created.id
          }));
          for (const batch of chunked(
            itemRows,
            FREQUENCY_JOB_ITEM_CREATE_BATCH_LIMIT
          )) {
            await transaction.jobItem.createMany({ data: batch });
          }
          return created;
        },
        {
          maxWait: FREQUENCY_CREATE_TRANSACTION_MAX_WAIT_MS,
          timeout: FREQUENCY_CREATE_TRANSACTION_TIMEOUT_MS
        }
      );
      return frequencyCollectionSummary(job);
    } catch (error) {
      if (!unique(error)) throw error;
      const winner = await this.existing(input.workspaceId, input.idempotencyKey);
      if (winner) return replay(winner, hash);
      throw new ConflictException("Frequency collection command conflicted");
    }
  }

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly FrequencyCollectionSummary[]> {
    const jobs = await this.prisma.job.findMany({
      where: { workspaceId, projectId, type: "FREQUENCY_COLLECTION" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25
    });
    return jobs.map(frequencyCollectionSummary);
  }

  public async get(
    workspaceId: string,
    projectId: string,
    jobId: string
  ): Promise<FrequencyCollectionSummary> {
    return frequencyCollectionSummary(
      await this.required(workspaceId, projectId, jobId)
    );
  }

  public async resultScope(
    workspaceId: string,
    projectId: string,
    jobId: string
  ): Promise<InternalFrequencyOperationScope> {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        workspaceId,
        projectId,
        type: "FREQUENCY_COLLECTION"
      },
      select: {
        items: {
          orderBy: { sequence: "asc" },
          take: arsenkinWordstatKeywordLimit + 1,
          select: {
            sequence: true,
            status: true,
            inputReference: true,
            error: true
          }
        }
      }
    });
    if (!job) throw new NotFoundException("Frequency collection not found");
    if (job.items.length > arsenkinWordstatKeywordLimit) {
      throw new Error("Frequency collection scope exceeds its contract");
    }
    return {
      workspaceId,
      projectId,
      jobId,
      items: job.items.map(frequencyResultScopeItem)
    };
  }

  public async cancel(
    jobId: string,
    input: InternalCancelFrequencyCollectionInput
  ): Promise<FrequencyCollectionSummary> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.job.findFirst({
        where: {
          id: jobId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          type: "FREQUENCY_COLLECTION"
        }
      });
      if (!current) throw new NotFoundException("Frequency collection not found");
      if (current.version !== input.version) versionConflict();
      if (!CANCELLABLE.has(current.status)) return;
      const updated = await transaction.job.updateMany({
        where: { id: jobId, status: current.status, version: input.version },
        data: {
          status: "CANCELLED",
          cancelRequestedAt: new Date(),
          finishedAt: new Date(),
          retryAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) versionConflict();
      await transaction.jobItem.updateMany({
        where: {
          jobId,
          status: { in: ["PENDING", "QUEUED", "RUNNING", "FAILED_RETRYABLE"] }
        },
        data: { status: "CANCELLED", retryAt: null }
      });
    });
    return this.get(input.workspaceId, input.projectId, jobId);
  }

  public async retryFailed(
    jobId: string,
    input: InternalRetryFrequencyCollectionInput
  ): Promise<FrequencyCollectionSummary> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.job.findFirst({
        where: {
          id: jobId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          type: "FREQUENCY_COLLECTION"
        }
      });
      if (!current) throw new NotFoundException("Frequency collection not found");
      if (current.version !== input.version) versionConflict();
      if (current.status === "ACTION_REQUIRED") {
        throw new ConflictException(
          "Frequency collection requires manual provider reconciliation"
        );
      }
      if (
        current.status !== "FAILED_FINAL" &&
        current.status !== "PARTIALLY_COMPLETED"
      ) {
        throw new ConflictException("Frequency collection has no retryable failed items");
      }
      const failed = await transaction.jobItem.updateMany({
        where: { jobId, status: "FAILED_FINAL" },
        data: {
          status: "PENDING",
          attempt: 0,
          retryAt: null,
          error: Prisma.DbNull,
          outputReference: Prisma.DbNull
        }
      });
      if (failed.count === 0) {
        throw new ConflictException("Frequency collection has no failed items");
      }
      const completed = await transaction.jobItem.count({
        where: { jobId, status: "COMPLETED" }
      });
      const updated = await transaction.job.updateMany({
        where: { id: jobId, status: current.status, version: input.version },
        data: {
          status: "QUEUED",
          stage: "collecting",
          progressCurrent: BigInt(completed),
          retryAt: null,
          finishedAt: null,
          errorSummary: Prisma.DbNull,
          resultSummary: Prisma.DbNull,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) versionConflict();
    });
    return this.get(input.workspaceId, input.projectId, jobId);
  }

  private existing(workspaceId: string, idempotencyKey: string) {
    return this.prisma.job.findUnique({
      where: {
        workspaceId_idempotencyScope_idempotencyKey: {
          workspaceId,
          idempotencyScope: CREATE_SCOPE,
          idempotencyKey
        }
      },
    });
  }

  private async required(workspaceId: string, projectId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, workspaceId, projectId, type: "FREQUENCY_COLLECTION" },
    });
    if (!job) throw new NotFoundException("Frequency collection not found");
    return job;
  }
}

function frequencyResultScopeItem(
  item: Readonly<{
    sequence: number;
    status: string;
    inputReference: unknown;
    error: unknown;
  }>
): InternalFrequencyOperationScopeItem {
  const input = record(item.inputReference);
  const keywordId = input?.keywordId;
  if (
    !Number.isSafeInteger(item.sequence) ||
    item.sequence < 0 ||
    typeof keywordId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      keywordId
    ) ||
    ![
      "PENDING",
      "QUEUED",
      "RUNNING",
      "COMPLETED",
      "FAILED_RETRYABLE",
      "FAILED_FINAL",
      "CANCELLED"
    ].includes(item.status)
  ) {
    throw new Error("Invalid stored frequency result scope");
  }
  const errorCode = record(item.error)?.code;
  return {
    sequence: item.sequence,
    keywordId,
    status: item.status as InternalFrequencyOperationScopeItem["status"],
    ...(typeof errorCode === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(errorCode)
      ? { errorCode }
      : {})
  };
}

function record(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function frequencyJobItems(
  input: Pick<InternalCreateFrequencyCollectionInput, "items" | "projectId">
) {
  return input.items.map((item, sequence) => ({
    projectId: input.projectId,
    sequence,
    status: "PENDING" as const,
    inputReference: { keywordId: item.id, version: item.version }
  }));
}

function chunked<T>(values: readonly T[], size: number): readonly T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function requestHash(input: InternalCreateFrequencyCollectionInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        projectId: input.projectId,
        items: input.items,
        types: input.types,
        regionCode: input.regionCode,
        device: input.device
      }),
      "utf8"
    )
    .digest("hex");
}

function replay(job: FrequencyJob, hash: string): FrequencyCollectionSummary {
  if (
    !job.requestHash ||
    !Buffer.from(job.requestHash).equals(Buffer.from(hash, "hex"))
  ) {
    throw new ConflictException("Idempotency key was already used");
  }
  return frequencyCollectionSummary(job);
}

function unique(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function versionConflict(): never {
  throw new HttpException(
    { code: "VERSION_CONFLICT", message: "Frequency collection changed" },
    HttpStatus.CONFLICT
  );
}
