import { createHash, randomUUID } from "node:crypto";
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import type { AdminProviderAccount, PlatformProviderAccountSnapshot } from "@seo-platform/contracts";
import { sendConfirmedOperationalAlert } from "@seo-platform/operational-alerts";
import { PrismaService } from "../database/prisma.service.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { providerCostBook } from "./provider-pricing.js";

export const PROVIDER_LOW_BALANCE_MINOR = 50_000;
@Injectable()
export class ProviderBalanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ProviderBalanceService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private running = false;
  public constructor(private readonly prisma: PrismaService, private readonly jobs: JobsClient) {}
  public onApplicationBootstrap() { this.schedule(10_000); }
  public async onModuleDestroy() { this.stopping = true; clearTimeout(this.timer); while (this.running) await new Promise(resolve => setTimeout(resolve, 50)); }
  public async accounts(actorId: string, requestId: string): Promise<readonly AdminProviderAccount[]> {
    return (await this.jobs.platformProviderAccounts(actorId, requestId)).map(providerAccountPresentation);
  }
  private schedule(ms: number) { if (this.stopping) return; this.timer = setTimeout(() => void this.tick(), ms); this.timer.unref(); }
  private async tick() {
    if (this.stopping || this.running) return; this.running = true;
    try { await this.poll(); } catch { this.logger.warn("PROVIDER_BALANCE_MONITOR_UNAVAILABLE"); }
    finally { this.running = false; this.schedule(60_000); }
  }
  public async poll(): Promise<void> {
    if (process.env.TELEGRAM_ALERTS_ENABLED !== "true") return;
    const admin = await this.prisma.platformStaffRoleAssignment.findFirst({ where: { roleCode: "SUPER_ADMIN", revokedAt: null, user: { status: "ACTIVE", emailVerifiedAt: { not: null } } }, orderBy: { assignedAt: "asc" }, select: { userId: true } });
    if (!admin) return;
    const accounts = await this.accounts(admin.userId, `provider-balances-${randomUUID()}`);
    const eligible = new Set(accounts.filter(account => account.enabled && !account.stale && !account.errorCode && account.lowBalance).map(account => account.id));
    for (const account of accounts) {
      if (!account.enabled || account.stale || account.errorCode || account.estimatedBalanceMinor === null || !account.checkedAt) continue;
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended(${`provider-balance:${account.id}`}, 0))`;
        const current = await tx.providerBalanceNotification.findUnique({ where: { accountId: account.id } });
        const observedAt = new Date(account.checkedAt!);
        if (current && current.observedAt > observedAt) return;
        const low = account.estimatedBalanceMinor! < PROVIDER_LOW_BALANCE_MINOR;
        const newAlert = low && !current?.low;
        const generation = (current?.generation ?? 0) + (newAlert ? 1 : 0);
        await tx.providerBalanceNotification.upsert({ where: { accountId: account.id }, create: { accountId: account.id, provider: account.provider, slot: account.slot, balanceMinor: BigInt(account.estimatedBalanceMinor!), observedAt, low, pending: low, generation }, update: { provider: account.provider, slot: account.slot, balanceMinor: BigInt(account.estimatedBalanceMinor!), observedAt, low, generation, ...(newAlert ? { pending: true, nextAttemptAt: new Date(), leaseToken: null, leaseExpiresAt: null } : !low ? { pending: false } : {}) } });
      });
    }
    const pending = await this.prisma.providerBalanceNotification.findMany({ where: { pending: true, low: true, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: "asc" }, take: 10 });
    for (const row of pending) {
      if (!eligible.has(row.accountId)) continue;
      const token = randomUUID();
      const claimed = await this.prisma.providerBalanceNotification.updateMany({ where: { accountId: row.accountId, generation: row.generation, pending: true, low: true, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }] }, data: { leaseToken: token, leaseExpiresAt: new Date(Date.now() + 30_000), nextAttemptAt: new Date(Date.now() + 60_000) } });
      if (!claimed.count) continue;
      const delivered = await sendConfirmedOperationalAlert(process.env, "backend-core", { source: "provider-balance", code: `${row.provider}_LOW_BALANCE_${row.slot}`, severity: "ERROR", fingerprint: createHash("sha256").update(`${row.accountId}:${row.generation}`).digest("hex") });
      await this.prisma.providerBalanceNotification.updateMany({ where: { accountId: row.accountId, generation: row.generation, leaseToken: token, low: true }, data: { pending: !delivered, leaseToken: null, leaseExpiresAt: null } });
    }
  }
}
export function providerAccountPresentation(row: PlatformProviderAccountSnapshot): AdminProviderAccount {
  let estimatedBalanceMinor: number | null = null;
  if (row.remaining !== null) {
    const [whole, fraction = ""] = row.remaining.split(".");
    const micros = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
    const minor = row.provider === "XMLSTOCK" ? micros / 10_000n : micros * providerCostBook.unitCostMicro.ARSENKIN_LIMIT / 10_000_000_000n;
    if (minor <= BigInt(Number.MAX_SAFE_INTEGER)) estimatedBalanceMinor = Number(minor);
  }
  const stale = !row.checkedAt || Date.now() - Date.parse(row.checkedAt) > 15 * 60_000;
  return { ...row, estimatedBalanceMinor, stale, lowBalance: estimatedBalanceMinor !== null && estimatedBalanceMinor < PROVIDER_LOW_BALANCE_MINOR };
}
