import assert from "node:assert/strict";
import test from "node:test";
import type { OperationEstimateCommand } from "@seo-platform/contracts";
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

test("Wordstat expansion pricing resolves the exact credential selected in the dialog", async () => {
  const credentialId = "01900000-0000-7000-8000-000000000001";
  const result = await resolveByokRoute(
    {
      kind: "KEYWORD_RESEARCH",
      command: {
        source: "XMLSTOCK_WORDSTAT",
        credentialId,
        queries: ["пример"],
        regionCode: "225",
        device: "ALL",
        minusWords: [],
        clearMinusPhrases: false,
        includeRightColumn: true,
        clearPlus: false,
        maxKeywords: 100
      }
    },
    "XMLSTOCK"
  );

  assert.equal(result.credentialId, credentialId);
  assert.equal(result.xmlStockRequestCount, 1);
  assert.equal(result.credentialMode, "BYOK_API_KEY");
});

test("Keys.so pricing resolves the exact credential selected in the launch form", async () => {
  const credentialId = "01900000-0000-7000-8000-000000000011";
  const result = await resolveByokRoute({
    kind: "KEYWORD_RESEARCH",
    command: {
      source: "KEYS_SO",
      credentialId,
      domain: "example.com",
      database: "msk",
      maxKeywords: 100
    }
  }, "KEYS_SO");

  assert.equal(result.credentialId, credentialId);
  assert.equal(result.xmlStockRequestCount, undefined);
});

async function resolveByokRoute(
  command: OperationEstimateCommand,
  provider: "ARSENKIN" | "XMLSTOCK" | "KEYS_SO"
): Promise<{
  readonly credentialId: string | undefined;
  readonly credentialMode: string;
  readonly xmlStockRequestCount: number | undefined;
}> {
  let credentialId: string | undefined;
  let xmlStockRequestCount: number | undefined;
  const service = new OperationBillingService(
    {} as never,
    {} as never,
    {
      operationRoute: async (
        _context: unknown,
        _kind: unknown,
        _source: unknown,
        _provider: unknown,
        selectedCredentialId: string | undefined,
        requestedXmlStockCount: number | undefined
      ) => {
        credentialId = selectedCredentialId;
        xmlStockRequestCount = requestedXmlStockCount;
        return { provider, credentialMode: "BYOK_API_KEY" };
      }
    } as never,
    {} as never,
    { semanticCapacity: async () => ({}) } as never,
    { billing: { providerUsage: {} } } as never
  );

  const quote = await service.estimate(
    {
      tenant: {
        workspaceId: "01900000-0000-7000-8000-000000000021",
        projectId: "01900000-0000-7000-8000-000000000022"
      }
    } as never,
    command
  );
  return {
    credentialId,
    credentialMode: quote.credentialMode,
    xmlStockRequestCount
  };
}
