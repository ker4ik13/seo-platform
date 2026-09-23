import { createHash } from "node:crypto";
import { paidOperationJobFields } from "../paid-operations/paid-operation-admission.js";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ClusteringRunSummary,
  InternalCancelClusteringRunInput,
  InternalCreateClusteringRunInput
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { WorkspaceConnectorRoutingService } from "../integrations/workspace-connector-routing.service.js";
import { assertJobCapacity } from "../jobs/job-capacity.js";
import { clusteringRunSummary } from "./clustering-run-record.js";

const CREATE_SCOPE = "clustering-run:create";
const MAX_ATTEMPTS = 720;
const ITEM_CREATE_BATCH_LIMIT = 2_000;
const CREATE_TRANSACTION_TIMEOUT_MS = 90_000;
const CANCELLABLE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_RATE_LIMIT",
  "RETRY_SCHEDULED",
  "FAILED_RETRYABLE"
] as const;

@Injectable()
export class ClusteringRunService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly routing: WorkspaceConnectorRoutingService
  ) {}

  public async create(input: InternalCreateClusteringRunInput): Promise<ClusteringRunSummary> {
    const hash = requestHash(input);
    const existing = await this.existing(input.workspaceId, input.idempotencyKey);
    if (existing) return replay(existing, hash);
    const route = await this.routing.resolve(
      input.workspaceId,
      input.projectId,
      "CLUSTERING",
      input.actorId,
      "ARSENKIN",
      input.billing?.credentialId ?? input.credentialId
    );
    if (route.provider !== "ARSENKIN") throw new Error("Clustering requires an Arsenkin route");
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        await assertJobCapacity(transaction, input.workspaceId, input.jobCapacity);
        const job = await transaction.job.create({
          data: {
            ...paidOperationJobFields("CLUSTERING_RUN", input, route),
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            type: "CLUSTERING_RUN",
            status: "QUEUED",
            stage: "clustering",
            actorId: input.actorId,
            idempotencyScope: CREATE_SCOPE,
            idempotencyKey: input.idempotencyKey,
            requestHash: Buffer.from(hash, "hex"),
            inputSnapshot: {
              searchEngine: input.searchEngine,
              regionCode: input.regionCode,
              method: input.method,
              overlapCount: input.overlapCount,
              depth: input.depth,
              excludeMainPages: input.excludeMainPages,
              stopDomains: [...input.stopDomains],
              frequencyTypes: [...input.frequencyTypes],
              replaceExistingClusters: input.replaceExistingClusters
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
        const rows = input.items.map((item, sequence) => ({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          jobId: job.id,
          sequence,
          status: "PENDING" as const,
          inputReference: { keywordId: item.id, version: item.version }
        }));
        for (const batch of chunked(rows, ITEM_CREATE_BATCH_LIMIT)) {
          await transaction.jobItem.createMany({ data: batch });
        }
        return job;
      }, { maxWait: 10_000, timeout: CREATE_TRANSACTION_TIMEOUT_MS });
      return clusteringRunSummary(created);
    } catch (error) {
      if (!unique(error)) throw error;
      const winner = await this.existing(input.workspaceId, input.idempotencyKey);
      if (winner) return replay(winner, hash);
      throw new ConflictException("Clustering run command conflicted");
    }
  }

  public async list(workspaceId: string, projectId: string): Promise<readonly ClusteringRunSummary[]> {
    const jobs = await this.prisma.job.findMany({
      where: {
        workspaceId,
        projectId,
        type: "CLUSTERING_RUN",
        dismissedAt: null
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25
    });
    return jobs.map(clusteringRunSummary);
  }

  public async get(workspaceId: string, projectId: string, jobId: string): Promise<ClusteringRunSummary> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, workspaceId, projectId, type: "CLUSTERING_RUN" }
    });
    if (!job) throw new NotFoundException("Clustering run not found");
    return clusteringRunSummary(job);
  }

  public async cancel(jobId: string, input: InternalCancelClusteringRunInput): Promise<ClusteringRunSummary> {
    await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.job.findFirst({
        where: {
          id: jobId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          type: "CLUSTERING_RUN"
        }
      });
      if (!job) throw new NotFoundException("Clustering run not found");
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

function requestHash(input: InternalCreateClusteringRunInput): string {
  return createHash("sha256").update(JSON.stringify({
    projectId: input.projectId,
    items: input.items,
    credentialId: input.credentialId ?? null,
    searchEngine: input.searchEngine,
    regionCode: input.regionCode,
    method: input.method,
    overlapCount: input.overlapCount,
    depth: input.depth,
    excludeMainPages: input.excludeMainPages,
    stopDomains: input.stopDomains,
    frequencyTypes: input.frequencyTypes,
    replaceExistingClusters: input.replaceExistingClusters
  }), "utf8").digest("hex");
}

function replay(
  job: Parameters<typeof clusteringRunSummary>[0],
  hash: string
): ClusteringRunSummary {
  if (!job.requestHash || !Buffer.from(job.requestHash).equals(Buffer.from(hash, "hex"))) {
    throw new ConflictException("Idempotency key was already used");
  }
  return clusteringRunSummary(job);
}

function unique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function chunked<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
