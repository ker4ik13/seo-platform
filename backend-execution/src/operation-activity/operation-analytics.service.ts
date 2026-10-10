import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  parseAnalyticsOperations,
  type AnalyticsOperations,
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class OperationAnalyticsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly cache = new Map<
    string,
    { until: number; value: AnalyticsOperations }
  >();
  private readonly pending = new Map<string, Promise<AnalyticsOperations>>();
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  public constructor(private readonly prisma: PrismaService) {}
  public onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.purge(), 3_600_000);
    this.timer.unref();
  }
  public onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
  private async purge(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.prisma
        .$executeRaw`DELETE FROM operation_analytics_facts WHERE id IN (SELECT id FROM operation_analytics_facts WHERE created_at<now()-interval '400 days' ORDER BY created_at LIMIT 10000)`;
    } catch {
      new Logger(OperationAnalyticsService.name).warn(
        "Operation analytics retention sweep unavailable",
      );
    } finally {
      this.sweeping = false;
    }
  }
  public async report(
    days: 7 | 30 | 90,
    excludeWorkspaceIds: readonly string[],
  ): Promise<AnalyticsOperations> {
    const key = createHash("sha256")
      .update(JSON.stringify([days, [...excludeWorkspaceIds].sort()]))
      .digest("hex");
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const read = this.read(days, excludeWorkspaceIds);
    this.pending.set(key, read);
    try {
      const value = await read;
      if (this.cache.size >= 12)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { until: Date.now() + 300_000, value });
      return value;
    } finally {
      this.pending.delete(key);
    }
  }
  private async read(
    days: 7 | 30 | 90,
    excluded: readonly string[],
  ): Promise<AnalyticsOperations> {
    return this.prisma.$transaction(
      async (database) => {
        await database.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        return this.readSnapshot(database, days, excluded);
      },
      { timeout: 15_000, maxWait: 2000, isolationLevel: "RepeatableRead" },
    );
  }
  private async readSnapshot(
    database: Pick<PrismaService, "$queryRaw">,
    days: 7 | 30 | 90,
    excluded: readonly string[],
  ): Promise<AnalyticsOperations> {
    const now = new Date(),
      before = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      ),
      from = new Date(before.getTime() - days * 86_400_000);
    const [groups, errors, coverage] = await Promise.all([
      database.$queryRaw<Record<string, unknown>[]>`
        WITH facts AS MATERIALIZED (
          SELECT *,CASE WHEN finished_at IS NOT NULL AND started_at IS NOT NULL THEN greatest(0,extract(epoch FROM finished_at-started_at)*1000) END duration,
            CASE WHEN started_at IS NOT NULL THEN greatest(0,extract(epoch FROM started_at-coalesce(queued_at,created_at))*1000) END queue,
            CASE WHEN first_result_at IS NOT NULL THEN greatest(0,extract(epoch FROM first_result_at-created_at)*1000) END first_result
          FROM operation_analytics_facts WHERE created_at>=${from} AND created_at<${before} AND NOT(workspace_id=ANY(${[...excluded]}::uuid[]))
        ), dimensions AS (
          SELECT f.*,d.family,d.key FROM facts f CROSS JOIN LATERAL(VALUES
            ('daily',to_char(f.created_at AT TIME ZONE 'UTC','YYYY-MM-DD')),('types',f.type),('providers',f.provider),('origins',f.origin)
          ) d(family,key)
        )
        SELECT family,key,count(*) total,count(*) FILTER(WHERE status='COMPLETED') completed,
          count(*) FILTER(WHERE status='PARTIALLY_COMPLETED') partial,count(*) FILTER(WHERE status IN ('FAILED_FINAL','EXPIRED','ACTION_REQUIRED')) failed,
          count(*) FILTER(WHERE status='CANCELLED') cancelled,coalesce(sum(processed) FILTER(WHERE finished_at IS NOT NULL),0) processed,
          round((percentile_cont(0.5) WITHIN GROUP(ORDER BY duration))::numeric)::bigint "durationP50Ms",
          round((percentile_cont(0.95) WITHIN GROUP(ORDER BY duration))::numeric)::bigint "durationP95Ms",
          round(avg(queue))::bigint "queueAverageMs",round(avg(first_result))::bigint "firstResultAverageMs",
          coalesce(sum(provider_cost_micro),0)::text "providerCostMicro" FROM dimensions GROUP BY family,key ORDER BY family,key`,
      database.$queryRaw<
        { code: string; count: bigint }[]
      >`SELECT error_code code,count(*) count FROM operation_analytics_facts WHERE created_at>=${from} AND created_at<${before} AND error_code IS NOT NULL AND NOT(workspace_id=ANY(${[...excluded]}::uuid[])) GROUP BY error_code ORDER BY count(*) DESC LIMIT 50`,
      database.$queryRaw<
        { since: Date | null }[]
      >`SELECT min(created_at) since FROM operation_analytics_facts`,
    ]);
    const numbers = [
      "total",
      "completed",
      "partial",
      "failed",
      "cancelled",
      "processed",
      "durationP50Ms",
      "durationP95Ms",
      "queueAverageMs",
      "firstResultAverageMs",
    ];
    const rows = (family: string) =>
      groups
        .filter((row) => row.family === family)
        .map((row) =>
          Object.fromEntries([
            ["key", row.key],
            ["providerCostMicro", row.providerCostMicro],
            ...numbers.map((key) => [
              key,
              row[key] === null ? null : Number(row[key]),
            ]),
          ]),
        );
    return parseAnalyticsOperations({
      since: coverage[0]?.since?.toISOString() ?? null,
      daily: rows("daily"),
      types: rows("types"),
      providers: rows("providers"),
      origins: rows("origins"),
      errors: errors.map((row) => ({
        code: row.code,
        count: Number(row.count),
      })),
    });
  }
}
