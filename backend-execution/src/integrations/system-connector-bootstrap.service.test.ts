import assert from "node:assert/strict";
import test from "node:test";
import { SystemConnectorBootstrapService } from "./system-connector-bootstrap.service.js";

test("disabled system providers perform no credential, queue or routing work", async () => {
  const service = new SystemConnectorBootstrapService({} as never, {} as never, {} as never, {} as never, { platformProviderCredentials: {} } as never);
  assert.deepEqual(await service.prepare("workspace", "project", "actor", "request"), { configured: false, pending: false, readyProviders: [] });
});

test("system bootstrap preserves configured project choices and creates only missing defaults", async () => {
  const caps = ["SERP_RANK_TRACKING", "WORDSTAT", "KEYWORD_RESEARCH"];
  const created: string[] = [];
  const resolved: string[] = [];
  const credential = { id: "system-key", provider: "XMLSTOCK", status: "ACTIVE", capabilities: caps };
  const tx = {
    $queryRaw: async () => [],
    projectConnectorBinding: { findUnique: async ({ where }: { where: { workspaceId_projectId_capability: { capability: string } } }) => where.workspaceId_projectId_capability.capability === "SERP_RANK_TRACKING" ? { id: "user-override" } : null },
    workspaceConnectorBinding: {
      findUnique: async () => null,
      create: async ({ data }: { data: { capability: string } }) => { created.push(data.capability); return { id: data.capability }; }
    },
    workspaceConnectorRoute: { createMany: async () => ({ count: 1 }) }
  };
  const prisma = {
    projectConnectorBinding: { findMany: async () => [{ capability: "SERP_RANK_TRACKING" }] },
    workspaceConnectorBinding: { findMany: async () => [] },
    integrationCredential: { findFirst: async () => credential },
    $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx)
  };
  const service = new SystemConnectorBootstrapService(prisma as never, { enablePlatform: async () => { throw new Error("must not replace the existing credential"); } } as never, {} as never, { resolve: async (_workspace: string, _project: string, capability: string) => { resolved.push(capability); } } as never, { platformProviderCredentials: { XMLSTOCK: [{ apiKey: "fixture", accountIdentifier: "fixture" }] } } as never);
  const result = await service.prepare("workspace", "project", "actor", "request");
  assert.equal(result.pending, false);
  assert.deepEqual(created, ["WORDSTAT", "KEYWORD_RESEARCH"]);
  assert.equal(created.includes("SERP_RANK_TRACKING"), false);
  assert.equal(resolved.length, 5);
});
