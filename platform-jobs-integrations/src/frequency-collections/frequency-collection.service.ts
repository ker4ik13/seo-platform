import { createHash } from "node:crypto";
import {
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
  InternalRetryFrequencyCollectionInput
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  frequencyCollectionSummary,
  type FrequencyJob
} from "./frequency-collection-record.js";

const CREATE_SCOPE = "frequency-collection:create";
const CANCELLABLE = new Set([
  "QUEUED",
  "RUNNING",
  "WAITING_RATE_LIMIT",
  "RETRY_SCHEDULED",
  "FAILED_RETRYABLE"
]);

@Injectable()
export class FrequencyCollectionService {
  public constructor(private readonly prisma: PrismaService) {}

  public async create(
    input: InternalCreateFrequencyCollectionInput
  ): Promise<FrequencyCollectionSummary> {
    const hash = requestHash(input);
    const existing = await this.existing(input.workspaceId, input.idempotencyKey);
    if (existing) return replay(existing, hash);

    const binding = await this.prisma.projectConnectorBinding.findUnique({
      where: {
        workspaceId_projectId_capability: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          capability: "WORDSTAT"
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
      route.credential.provider !== "XMLSTOCK" ||
      route.credential.mode !== "BYOK_API_KEY" ||
      route.credential.status !== "ACTIVE" ||
      route.credential.deletedAt !== null ||
      !capabilities(route.credential.capabilities).includes("WORDSTAT")
    ) {
      throw new HttpException(
        {
          code: "CONNECTOR_NOT_READY",
          message: "Configure and verify an active XMLStock Wordstat credential"
        },
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }

    try {
      const job = await this.prisma.job.create({
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
            bindingId: binding.id,
            routeId: route.id,
            credentialId: route.credentialId
          },
          progressTotal: BigInt(input.items.length),
          progressUnit: "keywords",
          credentialMode: "BYOK_API_KEY",
          provider: "XMLSTOCK",
          correlationId: input.correlationId,
          queuedAt: new Date(),
          maxAttempts: 8,
          items: {
            create: input.items.map((item, sequence) => ({
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              sequence,
              status: "PENDING" as const,
              inputReference: { keywordId: item.id, version: item.version }
            }))
          }
        },
        include: { items: { orderBy: { sequence: "asc" } } }
      });
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
      include: { items: { orderBy: { sequence: "asc" }, take: 200 } },
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
      if (
        current.status !== "FAILED_FINAL" &&
        current.status !== "PARTIALLY_COMPLETED" &&
        current.status !== "ACTION_REQUIRED"
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
      if (failed.count === 0 && current.status !== "ACTION_REQUIRED") {
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
      include: { items: { orderBy: { sequence: "asc" }, take: 200 } }
    });
  }

  private async required(workspaceId: string, projectId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, workspaceId, projectId, type: "FREQUENCY_COLLECTION" },
      include: { items: { orderBy: { sequence: "asc" }, take: 200 } }
    });
    if (!job) throw new NotFoundException("Frequency collection not found");
    return job;
  }
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

function capabilities(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
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
