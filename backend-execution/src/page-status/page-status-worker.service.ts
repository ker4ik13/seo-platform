import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { pageStatusRecord, pageStatusIds, parsePageStatusInput } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { PAGE_STATUS_JOB_TYPE } from "./page-status.service.js";
@Injectable()
export class PageStatusWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly owner = `page-status-${randomUUID()}`;
  private readonly logger = new Logger(PageStatusWorkerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | undefined;
  private stopped = false;
  public constructor(private readonly prisma: PrismaService, private readonly seo: SeoDataClient) {}
  public onModuleInit(): void { this.timer = setInterval(() => this.schedule(), 1000); this.timer.unref(); this.schedule(); }
  public async onModuleDestroy(): Promise<void> { this.stopped = true; if (this.timer) clearInterval(this.timer); await this.running; }
  private schedule(): void {
    if (this.running || this.stopped) return;
    this.running = this.tick().catch(() => { this.logger.error("Page status dispatcher unavailable"); }).finally(() => { this.running = undefined; });
  }
  public async tick(): Promise<void> {
    const now = new Date();
    const job = await this.prisma.job.findFirst({ where: { type: PAGE_STATUS_JOB_TYPE, OR: [{ status: { in: ["QUEUED", "CANCEL_REQUESTED"] }, leaseOwner: null, OR: [{ retryAt: null }, { retryAt: { lte: now } }] }, { status: { in: ["RUNNING", "CANCEL_REQUESTED"] }, leaseExpiresAt: { lte: now } }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!job) return;
    const claimed = await this.prisma.job.updateMany({ where: { id: job.id, version: job.version }, data: { status: job.status === "CANCEL_REQUESTED" ? "CANCEL_REQUESTED" : "RUNNING", stage: "pages", startedAt: job.startedAt ?? now, leaseOwner: this.owner, leaseExpiresAt: new Date(Date.now() + 60000), attempt: { increment: 1 }, version: { increment: 1 } } });
    if (!claimed.count) return;
    try {
      if (!job.projectId || !job.actorId) throw new TypeError();
      const scope = { workspaceId: job.workspaceId, projectId: job.projectId, actorId: job.actorId };
      const snapshot = pageStatusRecord(job.inputSnapshot, ["operation", "pageIds", "pathPrefix", "plannedIds"]);
      const input = parsePageStatusInput({ operation: snapshot.operation, ...(snapshot.pageIds ? { pageIds: snapshot.pageIds } : { pathPrefix: snapshot.pathPrefix }) });
      const ids = snapshot.plannedIds === undefined ? await this.seo.preparePageStatus({ ...scope, input }) : pageStatusIds(snapshot.plannedIds);
      await this.update(job.id, { inputSnapshot: { ...snapshot, plannedIds: [...ids] }, progressTotal: BigInt(ids.length) });
      let offset = Number(job.progressCurrent), result = pageStatusRecord(job.resultSummary ?? {}, ["changed", "blocked"]), changed = Number(result.changed ?? 0), blocked = Number(result.blocked ?? 0);
      while (offset < ids.length && !this.stopped) {
        const current = await this.prisma.job.findUniqueOrThrow({ where: { id: job.id }, select: { status: true, leaseOwner: true } });
        if (current.leaseOwner !== this.owner) throw new Error("Lease lost");
        if (current.status === "CANCEL_REQUESTED") break;
        const chunk = ids.slice(offset, offset + 200);
        const applied = await this.seo.applyPageStatus({ ...scope, input: { operation: input.operation, pageIds: chunk } });
        offset += chunk.length; changed += applied.changed; blocked += applied.blocked;
        await this.update(job.id, { progressCurrent: BigInt(offset), resultSummary: { changed, blocked }, leaseExpiresAt: new Date(Date.now() + 60000) });
      }
      const current = await this.prisma.job.findUniqueOrThrow({ where: { id: job.id }, select: { status: true } });
      if (this.stopped && current.status !== "CANCEL_REQUESTED") { await this.update(job.id, { status: "QUEUED", leaseOwner: null, leaseExpiresAt: null }); return; }
      const status = current.status === "CANCEL_REQUESTED" ? "CANCELLED" : blocked > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED";
      await this.update(job.id, { status, stage: "finished", errorSummary: Prisma.DbNull, resultSummary: { changed, blocked }, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null });
    } catch {
      const failed = job.attempt + 1 >= job.maxAttempts;
      await this.update(job.id, { status: failed ? "FAILED_FINAL" : "QUEUED", stage: failed ? "failed" : "retry", errorSummary: { code: "PAGE_STATUS_FAILED" }, retryAt: failed ? null : new Date(Date.now() + 5000), ...(failed ? { finishedAt: new Date() } : {}), leaseOwner: null, leaseExpiresAt: null });
    }
  }
  private async update(id: string, data: Parameters<PrismaService["job"]["updateMany"]>[0]["data"]): Promise<void> {
    const result = await this.prisma.job.updateMany({ where: { id, leaseOwner: this.owner, status: { in: ["RUNNING", "CANCEL_REQUESTED"] } }, data: { ...data, version: { increment: 1 } } });
    if (result.count !== 1) throw new Error("Page status lease lost");
  }
}
