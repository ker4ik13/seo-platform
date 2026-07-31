import { createHash } from "node:crypto";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional
} from "@nestjs/common";
import type {
  InternalCancelTechnicalCrawlInput,
  InternalCreateTechnicalCrawlInput,
  TechnicalCrawlCollection,
  TechnicalCrawlSummary
} from "@seo-platform/contracts";
import { Prisma, type TechnicalCrawl } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import {
  crawlCheckpointJson,
  type CrawlCheckpoint,
  storedCrawlCheckpoint
} from "./crawl-checkpoint.js";
import {
  storedCrawlConfig,
  technicalCrawlSummary
} from "./crawl-record.js";

const ACTIVE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "CANCEL_REQUESTED"
] as const;

@Injectable()
export class CrawlService {
  private readonly logger = new Logger(CrawlService.name);

  public constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly queue?: QueueService
  ) {}

  public async create(
    input: InternalCreateTechnicalCrawlInput
  ): Promise<TechnicalCrawlSummary> {
    const hash = requestHash(input);
    const scope = idempotencyScope(input);
    const existing = await this.prisma.job.findUnique({
      where: {
        workspaceId_idempotencyScope_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyScope: scope,
          idempotencyKey: input.idempotencyKey
        }
      },
      include: { technicalCrawl: true }
    });
    if (existing) return replay(existing, hash);

    let crawl: TechnicalCrawl;
    try {
      crawl = await this.prisma.$transaction(async (transaction) => {
        const job = await transaction.job.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            type: "TECHNICAL_CRAWL",
            status: "QUEUED",
            stage: "queued",
            actorId: input.actorId,
            idempotencyScope: scope,
            idempotencyKey: input.idempotencyKey,
            requestHash: Buffer.from(hash, "hex"),
            inputSnapshot: configJson(input),
            scopeSnapshot: {
              workspaceId: input.workspaceId,
              projectId: input.projectId
            },
            progressTotal: BigInt(input.maxUrls),
            progressUnit: "urls",
            credentialMode: "PLATFORM_INCLUDED",
            correlationId: input.correlationId,
            queuedAt: new Date()
          }
        });
        return transaction.technicalCrawl.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            jobId: job.id,
            actorId: input.actorId,
            host: new URL(input.startUrls[0]!).hostname,
            config: configJson(input),
            discoveredUrls: input.startUrls.length
          }
        });
      });
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const winner = await this.prisma.job.findUnique({
        where: {
          workspaceId_idempotencyScope_idempotencyKey: {
            workspaceId: input.workspaceId,
            idempotencyScope: scope,
            idempotencyKey: input.idempotencyKey
          }
        },
        include: { technicalCrawl: true }
      });
      if (winner) return replay(winner, hash);
      throw new ConflictException(
        "An active crawl already exists for this host"
      );
    }
    await this.enqueueAfterCommit(crawl.id);
    return technicalCrawlSummary(crawl);
  }

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<TechnicalCrawlCollection> {
    const rows = await this.prisma.technicalCrawl.findMany({
      where: { workspaceId, projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50
    });
    return { crawls: rows.map(technicalCrawlSummary) };
  }

  public async get(
    workspaceId: string,
    projectId: string,
    crawlId: string
  ): Promise<TechnicalCrawlSummary> {
    return technicalCrawlSummary(
      await this.required(workspaceId, projectId, crawlId)
    );
  }

  public async cancel(
    crawlId: string,
    input: InternalCancelTechnicalCrawlInput
  ): Promise<TechnicalCrawlSummary> {
    const crawl = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.technicalCrawl.findFirst({
        where: {
          id: crawlId,
          workspaceId: input.workspaceId,
          projectId: input.projectId
        }
      });
      if (!current) throw new NotFoundException("Technical crawl not found");
      if (current.version !== input.version) {
        throw new HttpException(
          {
            code: "VERSION_CONFLICT",
            message: "Technical crawl version is stale",
            details: {
              expectedVersion: input.version,
              actualVersion: current.version
            }
          },
          HttpStatus.CONFLICT
        );
      }
      if (!ACTIVE_STATUSES.includes(
        current.status as (typeof ACTIVE_STATUSES)[number]
      )) return current;
      const queued = current.status === "QUEUED";
      const updated = await transaction.technicalCrawl.update({
        where: { id: current.id },
        data: {
          status: queued ? "CANCELLED" : "CANCEL_REQUESTED",
          cancelRequestedAt: new Date(),
          ...(queued ? { finishedAt: new Date() } : {}),
          ...(queued
            ? { backoffCode: null, backoffUntil: null }
            : {}),
          version: { increment: 1 }
        }
      });
      await transaction.job.update({
        where: { id: current.jobId },
        data: {
          status: queued ? "CANCELLED" : "CANCEL_REQUESTED",
          cancelRequestedAt: new Date(),
          ...(queued ? { finishedAt: new Date() } : {}),
          ...(queued ? { retryAt: null } : {}),
          version: { increment: 1 }
        }
      });
      return updated;
    });
    return technicalCrawlSummary(crawl);
  }

  public async pendingIds(): Promise<readonly string[]> {
    const now = new Date();
    const rows = await this.prisma.technicalCrawl.findMany({
      where: {
        OR: [
          {
            status: "QUEUED",
            OR: [
              { backoffUntil: null },
              { backoffUntil: { lte: now } }
            ]
          },
          {
            status: { in: ["RUNNING", "CANCEL_REQUESTED"] },
            job: {
              OR: [
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lte: now } }
              ]
            }
          }
        ]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
      select: { id: true }
    });
    return rows.map(({ id }) => id);
  }

  public async claim(
    crawlId: string,
    leaseOwner: string,
    leaseSeconds: number
  ): Promise<TechnicalCrawl | undefined> {
    assertLease(leaseOwner, leaseSeconds);
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000);
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.technicalCrawl.findUnique({
        where: { id: crawlId },
        include: { job: true }
      });
      if (!current || !ACTIVE_STATUSES.includes(
        current.status as (typeof ACTIVE_STATUSES)[number]
      )) return undefined;
      const queued = current.status === "QUEUED";
      if (
        queued &&
        current.backoffUntil &&
        current.backoffUntil > now
      ) {
        return undefined;
      }
      const expectedJobStatus = queued
        ? "QUEUED"
        : current.status === "CANCEL_REQUESTED"
          ? "CANCEL_REQUESTED"
          : "RUNNING";
      if (
        current.job.status !== expectedJobStatus ||
        (!queued &&
          current.job.leaseExpiresAt &&
          current.job.leaseExpiresAt > now)
      ) {
        return undefined;
      }
      const crawlClaim = await transaction.technicalCrawl.updateMany({
        where: {
          id: current.id,
          status: current.status,
          version: current.version
        },
        data: {
          ...(queued
            ? {
                status: "RUNNING",
                startedAt: current.startedAt ?? now,
                backoffCode: null,
                backoffUntil: null
              }
            : {}),
          version: { increment: 1 }
        }
      });
      if (crawlClaim.count !== 1) return undefined;
      const jobClaim = await transaction.job.updateMany({
        where: {
          id: current.jobId,
          status: expectedJobStatus,
          version: current.job.version
        },
        data: {
          ...(queued
            ? {
                status: "RUNNING",
                stage: "crawling",
                startedAt: current.job.startedAt ?? now,
                retryAt: null
              }
            : {}),
          leaseOwner,
          leaseExpiresAt,
          version: { increment: 1 }
        }
      });
      if (jobClaim.count !== 1) {
        throw new Error("Technical crawl claim changed concurrently");
      }
      return transaction.technicalCrawl.findUniqueOrThrow({
        where: { id: current.id }
      });
    });
  }

  public async isCancellationRequested(crawlId: string): Promise<boolean> {
    const crawl = await this.prisma.technicalCrawl.findUnique({
      where: { id: crawlId },
      select: { status: true }
    });
    return crawl?.status === "CANCEL_REQUESTED";
  }

  public async recordPage(
    crawlId: string,
    leaseOwner: string,
    leaseSeconds: number,
    result: { readonly success: boolean; readonly issueCount: number },
    checkpoint: CrawlCheckpoint
  ): Promise<void> {
    assertLease(leaseOwner, leaseSeconds);
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.technicalCrawl.updateMany({
        where: {
          id: crawlId,
          status: { in: ["RUNNING", "CANCEL_REQUESTED"] }
        },
        data: {
          checkpoint: crawlCheckpointJson(checkpoint),
          discoveredUrls: checkpoint.seen.length,
          processedUrls: { increment: 1 },
          ...(result.success
            ? { successfulUrls: { increment: 1 } }
            : { failedUrls: { increment: 1 } }),
          issueCount: { increment: result.issueCount },
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw new Error("Technical crawl lease was lost");
      const crawl = await transaction.technicalCrawl.findUniqueOrThrow({
        where: { id: crawlId },
        select: { jobId: true }
      });
      const heartbeat = await transaction.job.updateMany({
        where: {
          id: crawl.jobId,
          status: { in: ["RUNNING", "CANCEL_REQUESTED"] },
          leaseOwner,
          leaseExpiresAt: { gt: now }
        },
        data: {
          progressCurrent: { increment: BigInt(1) },
          leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1_000),
          version: { increment: 1 }
        }
      });
      if (heartbeat.count !== 1) {
        throw new Error("Technical crawl lease was lost");
      }
    });
  }

  public async saveCheckpoint(
    crawlId: string,
    leaseOwner: string,
    leaseSeconds: number,
    checkpoint: CrawlCheckpoint
  ): Promise<void> {
    assertLease(leaseOwner, leaseSeconds);
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const crawl = await transaction.technicalCrawl.findFirst({
        where: {
          id: crawlId,
          status: { in: ["RUNNING", "CANCEL_REQUESTED"] }
        },
        select: { id: true, jobId: true }
      });
      if (!crawl) throw new Error("Technical crawl lease was lost");
      const checkpointSaved = await transaction.technicalCrawl.updateMany({
        where: {
          id: crawl.id,
          status: { in: ["RUNNING", "CANCEL_REQUESTED"] }
        },
        data: {
          checkpoint: crawlCheckpointJson(checkpoint),
          discoveredUrls: checkpoint.seen.length,
          version: { increment: 1 }
        }
      });
      if (checkpointSaved.count !== 1) {
        throw new Error("Technical crawl lease was lost");
      }
      const heartbeat = await transaction.job.updateMany({
        where: {
          id: crawl.jobId,
          status: { in: ["RUNNING", "CANCEL_REQUESTED"] },
          leaseOwner,
          leaseExpiresAt: { gt: now }
        },
        data: {
          leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1_000),
          version: { increment: 1 }
        }
      });
      if (heartbeat.count !== 1) {
        throw new Error("Technical crawl lease was lost");
      }
    });
  }

  public async finish(
    crawlId: string,
    leaseOwner: string,
    status: "COMPLETED" | "PARTIALLY_COMPLETED" | "CANCELLED",
    failureCode?: string,
    additionalIssueCount = 0
  ): Promise<TechnicalCrawl> {
    if (
      !Number.isSafeInteger(additionalIssueCount) ||
      additionalIssueCount < 0 ||
      additionalIssueCount > 5_000
    ) {
      throw new TypeError("Invalid additional crawl issue count");
    }
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.technicalCrawl.findFirst({
        where: {
          id: crawlId,
          status:
            status === "CANCELLED"
              ? { in: ["RUNNING", "CANCEL_REQUESTED"] }
              : "RUNNING"
        },
        select: { id: true, jobId: true }
      });
      if (!current) throw new Error("Technical crawl lease was lost");
      const jobStatus = await transaction.job.findFirst({
        where: {
          id: current.jobId,
          leaseOwner,
          leaseExpiresAt: { gt: new Date() },
          status: { in: ["RUNNING", "CANCEL_REQUESTED"] }
        },
        select: { id: true }
      });
      if (!jobStatus) throw new Error("Technical crawl lease was lost");
      const crawl = await transaction.technicalCrawl.update({
        where: { id: current.id },
        data: {
          status,
          finishedAt: new Date(),
          failureCode: failureCode?.slice(0, 64) ?? null,
          backoffCode: null,
          backoffUntil: null,
          issueCount: { increment: additionalIssueCount },
          version: { increment: 1 }
        }
      });
      await transaction.job.update({
        where: { id: current.jobId },
        data: {
          status:
            status === "COMPLETED"
              ? "COMPLETED"
              : status === "CANCELLED"
                ? "CANCELLED"
                : "PARTIALLY_COMPLETED",
          stage: "finished",
          finishedAt: new Date(),
          resultSummary: {
            processedUrls: crawl.processedUrls,
            successfulUrls: crawl.successfulUrls,
            failedUrls: crawl.failedUrls,
            issueCount: crawl.issueCount
          },
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          version: { increment: 1 }
        }
      });
      return crawl;
    });
  }

  public async releaseForRetry(
    crawlId: string,
    leaseOwner: string
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const crawl = await transaction.technicalCrawl.findFirst({
        where: {
          id: crawlId,
          status: { in: ["RUNNING", "CANCEL_REQUESTED"] }
        },
        select: { id: true, jobId: true, status: true }
      });
      if (!crawl) return;
      const released = await transaction.technicalCrawl.updateMany({
        where: { id: crawl.id, status: crawl.status },
        data: {
          ...(crawl.status === "RUNNING" ? { status: "QUEUED" } : {}),
          backoffCode: null,
          backoffUntil: null,
          version: { increment: 1 }
        }
      });
      if (released.count !== 1) return;
      const jobReleased = await transaction.job.updateMany({
        where: {
          id: crawl.jobId,
          status: { in: ["RUNNING", "CANCEL_REQUESTED"] },
          leaseOwner
        },
        data: {
          ...(crawl.status === "RUNNING"
            ? { status: "QUEUED", stage: "retrying" }
            : {}),
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          attempt: { increment: 1 },
          version: { increment: 1 }
        }
      });
      if (jobReleased.count !== 1) {
        throw new Error("Technical crawl lease was lost");
      }
    });
  }

  public async releaseForHostBackoff(
    crawlId: string,
    leaseOwner: string,
    backoffUntil: Date,
    backoffCode: NonNullable<TechnicalCrawlSummary["backoffCode"]>
  ): Promise<void> {
    if (
      Number.isNaN(backoffUntil.getTime()) ||
      backoffUntil <= new Date()
    ) {
      throw new TypeError("Invalid technical crawl backoff deadline");
    }
    await this.prisma.$transaction(async (transaction) => {
      const crawl = await transaction.technicalCrawl.findFirst({
        where: { id: crawlId, status: "RUNNING" },
        select: { id: true, jobId: true }
      });
      if (!crawl) return;
      const released = await transaction.technicalCrawl.updateMany({
        where: { id: crawl.id, status: "RUNNING" },
        data: {
          status: "QUEUED",
          backoffCode,
          backoffUntil,
          version: { increment: 1 }
        }
      });
      if (released.count !== 1) return;
      const jobReleased = await transaction.job.updateMany({
        where: {
          id: crawl.jobId,
          status: "RUNNING",
          leaseOwner
        },
        data: {
          status: "QUEUED",
          stage: "backing_off",
          retryAt: backoffUntil,
          leaseOwner: null,
          leaseExpiresAt: null,
          version: { increment: 1 }
        }
      });
      if (jobReleased.count !== 1) {
        throw new Error("Technical crawl lease was lost");
      }
    });
  }

  public async fail(
    crawlId: string,
    code: string,
    leaseOwner: string
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const crawl = await transaction.technicalCrawl.findUnique({
        where: { id: crawlId }
      });
      if (!crawl || !ACTIVE_STATUSES.includes(
        crawl.status as (typeof ACTIVE_STATUSES)[number]
      )) return;
      const job = await transaction.job.findFirst({
        where: {
          id: crawl.jobId,
          leaseOwner,
          leaseExpiresAt: { gt: new Date() },
          status: { in: ["RUNNING", "CANCEL_REQUESTED"] }
        },
        select: { id: true }
      });
      if (!job) return;
      await transaction.technicalCrawl.update({
        where: { id: crawl.id },
        data: {
          status: "FAILED",
          failureCode: code.slice(0, 64),
          backoffCode: null,
          backoffUntil: null,
          finishedAt: new Date(),
          version: { increment: 1 }
        }
      });
      await transaction.job.update({
        where: { id: crawl.jobId },
        data: {
          status: "FAILED_FINAL",
          stage: "failed",
          errorSummary: { code: code.slice(0, 64) },
          finishedAt: new Date(),
          attempt: { increment: 1 },
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          version: { increment: 1 }
        }
      });
    });
  }

  public config(crawl: TechnicalCrawl) {
    return storedCrawlConfig(crawl.config);
  }

  public checkpoint(crawl: TechnicalCrawl): CrawlCheckpoint {
    const config = this.config(crawl);
    return storedCrawlCheckpoint(crawl.checkpoint, config);
  }

  private async required(
    workspaceId: string,
    projectId: string,
    crawlId: string
  ): Promise<TechnicalCrawl> {
    const crawl = await this.prisma.technicalCrawl.findFirst({
      where: { id: crawlId, workspaceId, projectId }
    });
    if (!crawl) throw new NotFoundException("Technical crawl not found");
    return crawl;
  }

  private async enqueueAfterCommit(crawlId: string): Promise<void> {
    try {
      await this.queue?.enqueueCrawl(crawlId);
    } catch {
      this.logger.warn("Crawl enqueue deferred to worker reconciliation");
    }
  }
}

function configJson(input: InternalCreateTechnicalCrawlInput): Prisma.InputJsonValue {
  return {
    startUrls: [...input.startUrls],
    sitemapUrls: [...input.sitemapUrls],
    includePatterns: [...input.includePatterns],
    excludePatterns: [...input.excludePatterns],
    queryPolicy: input.queryPolicy,
    maxUrls: input.maxUrls,
    maxDepth: input.maxDepth,
    maxRuntimeSeconds: input.maxRuntimeSeconds,
    requestsPerMinute: input.requestsPerMinute,
    obeyRobots: true
  };
}

function idempotencyScope(input: InternalCreateTechnicalCrawlInput): string {
  return `technical-crawl:${input.projectId}:${input.actorId}`;
}

function requestHash(input: InternalCreateTechnicalCrawlInput): string {
  return createHash("sha256")
    .update(JSON.stringify(configJson(input)), "utf8")
    .digest("hex");
}

function replay(
  job: {
    readonly requestHash: Uint8Array | null;
    readonly technicalCrawl: TechnicalCrawl | null;
  },
  expectedHash: string
): TechnicalCrawlSummary {
  if (
    !job.requestHash ||
    Buffer.from(job.requestHash).toString("hex") !== expectedHash ||
    !job.technicalCrawl
  ) {
    throw new ConflictException(
      "Idempotency key was already used for another crawl request"
    );
  }
  return technicalCrawlSummary(job.technicalCrawl);
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002";
}

function assertLease(leaseOwner: string, leaseSeconds: number): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/u.test(leaseOwner) ||
    !Number.isSafeInteger(leaseSeconds) ||
    leaseSeconds < 90 ||
    leaseSeconds > 600
  ) {
    throw new TypeError("Invalid technical crawl lease");
  }
}
