import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import { BillingReconciliationService } from "./billing-reconciliation.service.js";
import type { BillingService } from "./billing.service.js";
import type { BillingUsageService } from "./billing-usage.service.js";

test("schedules expired-reservation cleanup even when providers are disabled", () => {
  const service = reconciliationFixture().service;
  const delays: number[] = [];
  (service as unknown as { schedule(delayMs: number): void }).schedule =
    (delayMs) => delays.push(delayMs);

  service.onApplicationBootstrap();

  assert.deepEqual(delays, [10_000]);
});

test("releases expired usage without running disabled payment reconciliation", async () => {
  const calls: string[] = [];
  const fixture = reconciliationFixture({
    billing: {
      reconcilePending: async () => calls.push("payments"),
      reconcileSubscriptions: async () => calls.push("subscriptions")
    },
    usage: {
      releaseExpired: async (_transaction, batchSize) => {
        calls.push(`release:${batchSize}`);
        return 1;
      }
    },
    prisma: {
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>
      ) => callback({})
    } as unknown as PrismaService
  });
  (fixture.service as unknown as { schedule(delayMs: number): void })
    .schedule = () => undefined;

  await (fixture.service as unknown as { run(): Promise<void> }).run();

  assert.deepEqual(calls, ["release:25"]);
});

function reconciliationFixture(
  overrides: {
    readonly billing?: Partial<BillingService>;
    readonly usage?: Partial<BillingUsageService>;
    readonly prisma?: Partial<PrismaService>;
  } = {}
): { readonly service: BillingReconciliationService } {
  const config = {
    billing: {
      reconciliation: {
        enabled: false,
        intervalMs: 60_000,
        batchSize: 25
      },
      providerUsage: {
        XMLSTOCK: { enabled: false },
        ARSENKIN: { enabled: false }
      }
    }
  } as AppConfig;
  return {
    service: new BillingReconciliationService(
      overrides.billing as BillingService,
      overrides.usage as BillingUsageService,
      overrides.prisma as PrismaService,
      config
    )
  };
}
