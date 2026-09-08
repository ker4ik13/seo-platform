import assert from "node:assert/strict";
import test from "node:test";
import { OperationBillingService } from "./operation-billing.service.js";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";

test("provider account clustering capacity is checked before a quote or reservation; BYOK keeps its own contract", async () => {
  let byok = false;
  const service = new OperationBillingService({ $transaction: () => { throw new Error("Money must not be read or reserved for an oversized provider task"); } } as never, {} as never, { operationRoute: async () => ({ provider: "ARSENKIN", credentialMode: byok ? "BYOK_API_KEY" : "PLATFORM_PAID" }) } as never, {} as never, { semanticCapacity: async () => ({}) } as never, { billing: { providerUsage: { ARSENKIN: { enabled: true, clusteringKeywordLimit: 30_000 } } } } as never);
  const command = { kind: "CLUSTERING_RUN", command: { items: Array.from({ length: 50_000 }, (_, i) => ({ id: String(i), version: 1 })) } };
  const context = { tenant: { workspaceId: "workspace", projectId: "project" } };
  await assert.rejects(() => service.estimate(context as never, command as never), error => error instanceof DomainError && error.code === "PROVIDER_SCOPE_LIMIT_EXCEEDED");
  byok = true;
  assert.equal((await service.estimate(context as never, command as never)).maximumChargeMinor, 0);
  const base = { NODE_ENV: "test", DATABASE_URL: "postgresql://test" };
  assert.equal(loadAppConfig({ ...base, PLATFORM_ARSENKIN_CLUSTERING_KEYWORD_LIMIT: "70000" }).billing.providerUsage.ARSENKIN.clusteringKeywordLimit, 70_000);
  for (const value of ["0", "-1", "300001", "70k"]) assert.throws(() => loadAppConfig({ ...base, PLATFORM_ARSENKIN_CLUSTERING_KEYWORD_LIMIT: value }));
});
