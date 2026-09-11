import { createHash } from "node:crypto";
import { paidOperationJobFields } from "../paid-operations/paid-operation-admission.js";
import {
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  AiAnswerCollectionSummary,
  InternalAiAnswerOperationScope,
  InternalAiAnswerOperationScopeItem,
  InternalCancelAiAnswerCollectionInput,
  InternalCreateAiAnswerCollectionInput
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { assertJobCapacity } from "../jobs/job-capacity.js";
import { WorkspaceConnectorRoutingService } from "../integrations/workspace-connector-routing.service.js";
import { aiAnswerCollectionSummary } from "./ai-answer-collection-record.js";

const CREATE_SCOPE = "ai-answer-collection:create";
const MAX_ATTEMPTS = 720;
const ITEM_CREATE_BATCH_LIMIT = 2_000;
const CANCELLABLE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_RATE_LIMIT",
  "RETRY_SCHEDULED",
  "FAILED_RETRYABLE"
] as const;

@Injectable()
export class AiAnswerCollectionService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly routing: WorkspaceConnectorRoutingService
  ) {}

  public async create(
    input: InternalCreateAiAnswerCollectionInput
  ): Promise<AiAnswerCollectionSummary> {
    const hash = requestHash(input);
    const existing = await this.existing(input.workspaceId, input.idempotencyKey);
    if (existing) return replay(existing, hash);
    const route = await this.routing.resolve(
      input.workspaceId,
      input.projectId,
      "SERP_COLLECTION",
      input.actorId,
      "ARSENKIN",
      input.billing?.credentialId
    );
    if (route.provider !== "ARSENKIN") {
      throw new Error("AI answers require an Arsenkin route");
    }
    try {
      const created = await this.prisma.$transaction(
        async (transaction) => {
          await assertJobCapacity(transaction, input.workspaceId, input.jobCapacity);
          const job = await transaction.job.create({
            data: {
              ...paidOperationJobFields("AI_ANSWER_COLLECTION", input, route),
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              type: "AI_ANSWER_COLLECTION",
              status: "QUEUED",
              stage: "collecting",
              actorId: input.actorId,
              idempotencyScope: CREATE_SCOPE,
              idempotencyKey: input.idempotencyKey,
              requestHash: Buffer.from(hash, "hex"),
              inputSnapshot: {
                ...(input.purpose === "COMPETITOR_SERP"
                  ? {
                      purpose: "COMPETITOR_SERP" as const,
                      saveProjectPosition:
                        input.saveProjectPosition ?? false
                    }
                  : {}),
                searchEngine: input.searchEngine,
                regionCode: input.regionCode,
                device: input.device,
                host: input.host,
                excludeSubdomains: input.excludeSubdomains,
                brands: [...input.brands]
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
              provider: "ARSENKIN",
              correlationId: input.correlationId,
              queuedAt: new Date(),
              maxAttempts: MAX_ATTEMPTS
            }
          });
          const itemRows = input.items.map((item, sequence) => ({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            jobId: job.id,
            sequence,
            status: "PENDING" as const,
            inputReference: { keywordId: item.id, version: item.version }
          }));
          for (const items of chunked(itemRows, ITEM_CREATE_BATCH_LIMIT)) {
            await transaction.jobItem.createMany({
              data: items
            });
          }
          return job;
        },
        { maxWait: 5_000, timeout: 30_000 }
      );
      return aiAnswerCollectionSummary(created);
    } catch (error) {
      if (!unique(error)) throw error;
      const winner = await this.existing(input.workspaceId, input.idempotencyKey);
      if (winner) return replay(winner, hash);
      throw new ConflictException("AI answer collection command conflicted");
    }
  }

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly AiAnswerCollectionSummary[]> {
    const jobs = await this.prisma.job.findMany({
      where: {
        workspaceId,
        projectId,
        type: "AI_ANSWER_COLLECTION",
        dismissedAt: null
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25
    });
    return jobs.map(aiAnswerCollectionSummary);
  }

  public async get(
    workspaceId: string,
    projectId: string,
    jobId: string
  ): Promise<AiAnswerCollectionSummary> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, workspaceId, projectId, type: "AI_ANSWER_COLLECTION" }
    });
    if (!job) throw new NotFoundException("AI answer collection not found");
    return aiAnswerCollectionSummary(job);
  }

  public async resultScope(
    workspaceId: string,
    projectId: string,
    jobId: string,
    limit: number,
    cursor?: number
  ): Promise<InternalAiAnswerOperationScope> {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        workspaceId,
        projectId,
        type: "AI_ANSWER_COLLECTION"
      },
      select: {
        items: {
          ...(cursor === undefined
            ? {}
            : { where: { sequence: { gt: cursor } } }),
          orderBy: { sequence: "asc" },
          take: limit + 1,
          select: {
            sequence: true,
            status: true,
            inputReference: true,
            providerRequestId: true,
            error: true,
            attempt: true,
            updatedAt: true
          }
        }
      }
    });
    if (!job) throw new NotFoundException("AI answer collection not found");
    const items = job.items.slice(0, limit);
    const hasNext = job.items.length > limit;
    const last = items.at(-1);
    return {
      workspaceId,
      projectId,
      jobId,
      items: items.map(aiAnswerResultScopeItem),
      page: {
        hasNext,
        ...(hasNext && last ? { nextCursor: String(last.sequence) } : {})
      }
    };
  }

  public async cancel(
    jobId: string,
    input: InternalCancelAiAnswerCollectionInput
  ): Promise<AiAnswerCollectionSummary> {
    await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.job.findFirst({
        where: {
          id: jobId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          type: "AI_ANSWER_COLLECTION"
        }
      });
      if (!job) throw new NotFoundException("AI answer collection not found");
      const updated = await transaction.job.updateMany({
        where: { id: job.id, status: { in: [...CANCELLABLE_STATUSES] } },
        data: {
          status: "CANCELLED",
          stage: "cancelled",
          cancelRequestedAt: new Date(),
          finishedAt: new Date(),
          retryAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: { increment: 1 }
        }
      });
      if (updated.count === 0) return;
      await transaction.jobItem.updateMany({
        where: {
          jobId: job.id,
          status: { in: ["PENDING", "QUEUED", "RUNNING", "FAILED_RETRYABLE"] }
        },
        data: { status: "CANCELLED", retryAt: null }
      });
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
      }
    });
  }
}

function requestHash(input: InternalCreateAiAnswerCollectionInput): string {
  return createHash("sha256")
    .update(JSON.stringify({
      projectId: input.projectId,
      items: input.items,
      ...(input.purpose === "COMPETITOR_SERP"
        ? {
            purpose: "COMPETITOR_SERP" as const,
            saveProjectPosition: input.saveProjectPosition ?? false
          }
        : {}),
      searchEngine: input.searchEngine,
      regionCode: input.regionCode,
      device: input.device,
      host: input.host,
      excludeSubdomains: input.excludeSubdomains,
      brands: input.brands
    }), "utf8")
    .digest("hex");
}

function replay(
  job: Parameters<typeof aiAnswerCollectionSummary>[0],
  hash: string
): AiAnswerCollectionSummary {
  if (!job.requestHash || !Buffer.from(job.requestHash).equals(Buffer.from(hash, "hex"))) {
    throw new ConflictException("Idempotency key was already used");
  }
  return aiAnswerCollectionSummary(job);
}

function unique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function chunked<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function aiAnswerResultScopeItem(
  item: Readonly<{
    sequence: number;
    status: string;
    inputReference: unknown;
    providerRequestId: string | null;
    error: unknown;
    attempt: number;
    updatedAt: Date;
  }>
): InternalAiAnswerOperationScopeItem {
  const input = object(item.inputReference);
  const keywordId = input?.keywordId;
  if (
    !Number.isSafeInteger(item.sequence) ||
    item.sequence < 0 ||
    typeof keywordId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(keywordId) ||
    !["PENDING", "QUEUED", "RUNNING", "COMPLETED", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED"].includes(item.status) ||
    !Number.isSafeInteger(item.attempt) ||
    item.attempt < 0
  ) {
    throw new Error("Invalid stored AI answer result scope");
  }
  const errorCode = object(item.error)?.code;
  return {
    sequence: item.sequence,
    keywordId,
    status: item.status as InternalAiAnswerOperationScopeItem["status"],
    attempt: item.attempt,
    providerSubmitted: item.providerRequestId !== null,
    ...(typeof errorCode === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(errorCode)
      ? { errorCode }
      : {}),
    updatedAt: item.updatedAt.toISOString()
  };
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}
