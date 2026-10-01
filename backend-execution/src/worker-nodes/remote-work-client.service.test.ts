import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import { RemoteWorkClientService, RemoteWorkFailedError } from "./remote-work-client.service.js";

test("fenced non-paid work falls back locally after worker loss; paid HTTP does not repeat", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const id = randomUUID(), token = randomUUID();
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id, state: "FAILED", errorCode: "WORKER_OUTCOME_UNKNOWN" }] }), { headers: { "content-type": "application/json" } });
  const prisma = { $queryRaw: async (query: TemplateStringsArray) => {
    const sql = query.join("");
    if (sql.includes("remote_work_available")) return [{ available: true }];
    if (sql.includes("enqueue_remote_work_batch")) return [{ ordinal: 1, id, readToken: token, nodeId: randomUUID(), blocked: false, errorCode: null }];
    if (sql.includes("abandon_remote_work")) return [{ state: "FAILED" }];
    assert.fail("unexpected persistence query");
  } } as unknown as PrismaService;
  const client = new RemoteWorkClientService(prisma, { remoteWorkEnabled: true, remoteWorkControlUrl: "http://127.0.0.1:4002" } as AppConfig);
  t.after(() => client.onModuleDestroy());
  const scope = { origin: "JOB" as const, operationId: randomUUID(), workspaceId: randomUUID() };
  let localRuns = 0;
  assert.equal(await client.execute(scope, "EXPORT", "EXPORT_FILE", {}, { resource: "CPU", timeoutMs: 1000 }, () => { assert.fail("no successful remote receipt"); }, async () => { localRuns++; return "persisted"; }), "persisted");
  assert.equal(localRuns, 1);
  await assert.rejects(client.execute(scope, "WORDSTAT", "PROVIDER_HTTP", {}, { resource: "HTTP", timeoutMs: 1000 }, () => "remote", async () => { localRuns++; return "paid"; }), (error: unknown) => error instanceof RemoteWorkFailedError && error.code === "WORKER_OUTCOME_UNKNOWN");
  assert.equal(localRuns, 1);
});
