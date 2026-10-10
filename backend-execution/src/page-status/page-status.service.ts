import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
import { parsePageStatusInput, parsePageStatusJobSummary, pageStatusRecord, type PageStatusInput, type PageStatusJobSummary, type JobCapacityEntitlement } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import type { Job } from "../generated/prisma/client.js";
import { assertJobCapacity } from "../jobs/job-capacity.js";
export const PAGE_STATUS_JOB_TYPE = "PAGE_STATUS_CHANGE";
export function pageStatusSummary(job: Job): PageStatusJobSummary {
  const result = pageStatusRecord(job.resultSummary ?? {}, ["changed", "blocked"]);
  const error = job.errorSummary as { code?: string } | null;
  return parsePageStatusJobSummary({ id: job.id, workspaceId: job.workspaceId, projectId: job.projectId, status: job.status, processed: Number(job.progressCurrent), total: job.progressTotal === null ? null : Number(job.progressTotal), changed: Number(result.changed ?? 0), blocked: Number(result.blocked ?? 0), ...(error?.code ? { errorCode: error.code } : {}) });
}
@Injectable()
export class PageStatusService {
  public constructor(private readonly prisma: PrismaService) {}
  public async create(scope: { workspaceId: string; projectId: string; actorId: string; idempotencyKey: string; correlationId: string; jobCapacity: JobCapacityEntitlement }, input: PageStatusInput): Promise<PageStatusJobSummary> {
    const parsed = parsePageStatusInput(input), idempotencyScope = `page-status:${scope.projectId}:${scope.actorId}`, hash = canonicalJsonSha256("page-status@1", parsed);
    const where = { workspaceId: scope.workspaceId, idempotencyScope, idempotencyKey: scope.idempotencyKey };
    const replay = async () => {
      const job = await this.prisma.job.findFirst({ where });
      if (!job) return undefined;
      if (Buffer.from(job.requestHash ?? []).toString("hex") !== hash) throw new ConflictException("Idempotency key already used");
      return pageStatusSummary(job);
    };
    const existing = await replay(); if (existing) return existing;
    try {
      const job = await this.prisma.$transaction(async tx => {
        await assertJobCapacity(tx, scope.workspaceId, scope.jobCapacity);
        return tx.job.create({ data: { workspaceId: scope.workspaceId, projectId: scope.projectId, actorId: scope.actorId, type: PAGE_STATUS_JOB_TYPE, status: "QUEUED", stage: "queued", idempotencyScope, idempotencyKey: scope.idempotencyKey, requestHash: Buffer.from(hash, "hex"), inputSnapshot: { ...parsed, ...(parsed.pageIds ? { pageIds: [...parsed.pageIds] } : {}) }, scopeSnapshot: { workspaceId: scope.workspaceId, projectId: scope.projectId }, credentialMode: "PLATFORM_INCLUDED", correlationId: scope.correlationId, progressUnit: "pages", queuedAt: new Date() } });
      });
      return pageStatusSummary(job);
    } catch (error) { if ((error as { code?: string }).code !== "P2002") throw error; const winner = await replay(); if (!winner) throw error; return winner; }
  }
  public async get(workspaceId: string, projectId: string, id: string): Promise<PageStatusJobSummary> {
    const job = await this.prisma.job.findFirst({ where: { id, workspaceId, projectId, type: PAGE_STATUS_JOB_TYPE } });
    if (!job) throw new NotFoundException(); return pageStatusSummary(job);
  }
  public async cancel(id: string): Promise<void> {
    await this.prisma.job.updateMany({ where: { id, type: PAGE_STATUS_JOB_TYPE, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCEL_REQUESTED", cancelRequestedAt: new Date(), version: { increment: 1 } } });
  }
}
