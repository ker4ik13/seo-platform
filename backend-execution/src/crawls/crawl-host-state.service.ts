import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";

const MAX_BACKOFF_MS = 60 * 60 * 1_000;
const MAX_FAILURES = 30;
const SITE_PAUSE_AFTER_FAILURES = 6;
const SITE_PAUSE_MS = 24 * 60 * 60 * 1_000;

export interface CrawlHostFailure {
  readonly code: CrawlHostFailureCode;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
}

export type CrawlBackoffCode =
  | "HOST_RATE_LIMIT"
  | "HOST_UNAVAILABLE"
  | "HOST_NETWORK_ERROR"
  | "LATENCY_SPIKE"
  | "SITE_PAUSED";

export type CrawlHostFailureCode = Exclude<
  CrawlBackoffCode,
  "SITE_PAUSED"
>;

export interface CrawlHostBackoff {
  readonly code: CrawlBackoffCode;
  readonly until: Date;
}

@Injectable()
export class CrawlHostStateService {
  public constructor(private readonly prisma: PrismaService) {}

  public async currentBackoff(
    host: string
  ): Promise<CrawlHostBackoff | undefined> {
    const normalized = crawlHost(host);
    const [now, state] = await Promise.all([
      databaseNow(this.prisma),
      this.prisma.crawlHostState.findUnique({
        where: { host: normalized },
        select: { backoffUntil: true, lastFailureCode: true }
      })
    ]);
    if (!state?.backoffUntil || state.backoffUntil <= now) {
      return undefined;
    }
    return {
      code: backoffCode(state.lastFailureCode),
      until: state.backoffUntil
    };
  }

  public async recordFailure(
    host: string,
    input: CrawlHostFailure
  ): Promise<Date> {
    const normalized = crawlHost(host);
    const code = input.code;
    const statusCode = optionalStatusCode(input.statusCode);
    return this.prisma.$transaction(async (transaction) => {
      await lockHost(transaction, normalized);
      const now = await databaseNow(transaction);
      const current = await transaction.crawlHostState.findUnique({
        where: { host: normalized }
      });
      const consecutiveFailures = Math.min(
        (current?.consecutiveFailures ?? 0) + 1,
        MAX_FAILURES
      );
      const decision = crawlHostBackoffDecision(
        code,
        consecutiveFailures,
        input.retryAfterMs
      );
      const candidate = new Date(
        now.getTime() + decision.delayMs
      );
      const backoffUntil =
        current?.backoffUntil && current.backoffUntil > candidate
          ? current.backoffUntil
          : candidate;
      await transaction.crawlHostState.upsert({
        where: { host: normalized },
        create: {
          host: normalized,
          consecutiveFailures,
          backoffUntil,
          lastFailureCode: decision.code,
          ...(statusCode ? { lastStatusCode: statusCode } : {}),
          lastFailureAt: now
        },
        update: {
          consecutiveFailures,
          backoffUntil,
          lastFailureCode: decision.code,
          lastStatusCode: statusCode ?? null,
          lastFailureAt: now
        }
      });
      return backoffUntil;
    });
  }

  public async recordResponse(
    host: string,
    responseTimeMs: number
  ): Promise<Date | undefined> {
    const normalized = crawlHost(host);
    const latency = boundedLatency(responseTimeMs);
    return this.prisma.$transaction(async (transaction) => {
      await lockHost(transaction, normalized);
      const now = await databaseNow(transaction);
      const current = await transaction.crawlHostState.findUnique({
        where: { host: normalized }
      });
      const previousEwma = current?.latencyEwmaMs;
      const latencySpike =
        previousEwma !== null &&
        previousEwma !== undefined &&
        latency >= 3_000 &&
        latency >= previousEwma * 3;
      const latencyEwmaMs =
        previousEwma === null || previousEwma === undefined
          ? latency
          : Math.round(previousEwma * 0.8 + latency * 0.2);
      if (latencySpike) {
        const consecutiveFailures = Math.min(
          (current?.consecutiveFailures ?? 0) + 1,
          MAX_FAILURES
        );
        const decision = crawlHostBackoffDecision(
          "LATENCY_SPIKE",
          consecutiveFailures
        );
        const candidate = new Date(
          now.getTime() + decision.delayMs
        );
        const backoffUntil =
          current?.backoffUntil && current.backoffUntil > candidate
            ? current.backoffUntil
            : candidate;
        await transaction.crawlHostState.upsert({
          where: { host: normalized },
          create: {
            host: normalized,
            consecutiveFailures,
            backoffUntil,
            lastFailureCode: decision.code,
            lastFailureAt: now,
            latencyEwmaMs
          },
          update: {
            consecutiveFailures,
            backoffUntil,
            lastFailureCode: decision.code,
            lastStatusCode: null,
            lastFailureAt: now,
            latencyEwmaMs
          }
        });
        return backoffUntil;
      }
      await transaction.crawlHostState.upsert({
        where: { host: normalized },
        create: {
          host: normalized,
          consecutiveFailures: 0,
          lastSuccessAt: now,
          latencyEwmaMs
        },
        update: {
          consecutiveFailures: 0,
          backoffUntil: null,
          lastSuccessAt: now,
          latencyEwmaMs
        }
      });
      return undefined;
    });
  }
}

export function crawlBackoffDelayMs(
  consecutiveFailures: number,
  retryAfterMs?: number
): number {
  if (
    !Number.isSafeInteger(consecutiveFailures) ||
    consecutiveFailures < 1
  ) {
    throw new TypeError("Invalid crawl host failure count");
  }
  const exponent = Math.min(consecutiveFailures - 1, 8);
  const exponential = Math.min(5_000 * 2 ** exponent, 15 * 60 * 1_000);
  const retryAfter =
    retryAfterMs === undefined || !Number.isFinite(retryAfterMs)
      ? 0
      : Math.min(Math.max(Math.ceil(retryAfterMs), 0), MAX_BACKOFF_MS);
  return Math.max(exponential, retryAfter);
}

export function crawlHostBackoffDecision(
  code: CrawlHostFailureCode,
  consecutiveFailures: number,
  retryAfterMs?: number
): {
  readonly code: CrawlBackoffCode;
  readonly delayMs: number;
} {
  const ordinaryDelay = crawlBackoffDelayMs(
    consecutiveFailures,
    retryAfterMs
  );
  return consecutiveFailures >= SITE_PAUSE_AFTER_FAILURES
    ? {
        code: "SITE_PAUSED",
        delayMs: Math.max(ordinaryDelay, SITE_PAUSE_MS)
      }
    : { code, delayMs: ordinaryDelay };
}

function crawlHost(value: string): string {
  const normalized = value.toLowerCase().replace(/\.$/u, "");
  if (
    normalized.length < 1 ||
    normalized.length > 253 ||
    normalized.includes("/") ||
    normalized.includes("@") ||
    normalized !== value
  ) {
    throw new TypeError("Invalid crawl host");
  }
  return normalized;
}

function backoffCode(value: string | null): CrawlBackoffCode {
  if (
    ![
      "HOST_RATE_LIMIT",
      "HOST_UNAVAILABLE",
      "HOST_NETWORK_ERROR",
      "LATENCY_SPIKE",
      "SITE_PAUSED"
    ].includes(value ?? "")
  ) {
    throw new TypeError("Invalid crawl host failure code");
  }
  return value as CrawlBackoffCode;
}

function optionalStatusCode(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 100 || value > 599) {
    throw new TypeError("Invalid crawl host status code");
  }
  return value;
}

function boundedLatency(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3_600_000) {
    throw new TypeError("Invalid crawl host latency");
  }
  return value;
}

async function lockHost(
  transaction: Prisma.TransactionClient,
  host: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`crawl-host-state:${host}`}, 0)
    )
  `;
}

async function databaseNow(
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">
): Promise<Date> {
  return databaseClock(
    transaction,
    "Unable to read crawl host database clock"
  );
}
