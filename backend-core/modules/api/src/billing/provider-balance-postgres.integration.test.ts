import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { ProviderBalanceService } from "./provider-balance.service.js";

const databaseUrl = process.env.PLATFORM_API_BILLING_TEST_DATABASE_URL;
test("PostgreSQL low-balance alerts survive delivery failures, deduplicate and rearm after recovery", { skip: !databaseUrl, timeout: 20_000 }, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432");
  const prisma = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl }));
  const envKeys = ["TELEGRAM_ALERTS_ENABLED", "OPERATIONAL_ALERTS_INTERNAL_URL", "OPERATIONAL_ALERT_TOKEN"] as const;
  const saved = new Map(envKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let remaining = "499.99", success = false, calls = 0;
  const accountId = randomUUID();
  globalThis.fetch = (async (target, init) => { assert.equal(String(target), "http://127.0.0.1:1/internal/alerts/confirmed"); assert.ok(String(init?.body).includes("XMLSTOCK_LOW_BALANCE_1")); calls++; return new Response(null, { status: success ? 200 : 503 }); }) as typeof fetch;
  Object.assign(process.env, { TELEGRAM_ALERTS_ENABLED: "true", OPERATIONAL_ALERTS_INTERNAL_URL: "http://127.0.0.1:1", OPERATIONAL_ALERT_TOKEN: "isolated-test-alert-token-000000000000" });
  try {
    const email = `balance-${randomUUID()}@example.invalid`;
    const user = await prisma.user.create({ data: { emailNormalized: email, emailDisplay: email, emailVerifiedAt: new Date(), displayName: "Balance monitor", status: "ACTIVE" } });
    await prisma.platformStaffRoleAssignment.create({ data: { userId: user.id, roleCode: "SUPER_ADMIN", reason: "Isolated monitoring test" } });
    const service = new ProviderBalanceService(prisma, { platformProviderAccounts: async () => [{ id: accountId, provider: "XMLSTOCK", slot: 1, enabled: true, checking: false, remaining, unit: "RUB", checkedAt: new Date().toISOString(), errorCode: null }] } as never);
    await Promise.all([service.poll(), service.poll()]);
    assert.equal(calls, 1);
    const stored = () => prisma.providerBalanceNotification.findUniqueOrThrow({ where: { accountId } });
    assert.equal((await stored()).pending, true, "Failure never acknowledges delivery");
    success = true;
    await prisma.providerBalanceNotification.update({ where: { accountId }, data: { nextAttemptAt: new Date(0) } });
    await Promise.all([service.poll(), service.poll()]);
    assert.equal(calls, 2); assert.equal((await stored()).pending, false);
    await service.poll(); assert.equal(calls, 2);
    remaining = "600.00"; await service.poll(); assert.equal((await stored()).low, false);
    remaining = "400.00"; await service.poll(); assert.equal(calls, 3); assert.equal((await stored()).generation, 2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await prisma.$disconnect();
  }
});
