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
  let failureCode = "WORKER_OUTCOME_UNKNOWN";
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id, state: "FAILED", errorCode: failureCode }] }), { headers: { "content-type": "application/json" } });
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
  failureCode = "INVALID_XLSX";
  assert.equal(await client.execute(scope, "IMPORT", "IMPORT_ROWS", {}, { resource: "CPU", timeoutMs: 1000 }, () => { assert.fail("remote parser rejected the XLSX"); }, async () => { localRuns++; return "parsed"; }), "parsed");
  assert.equal(localRuns, 2);
  failureCode = "WORKER_ADMISSION_TIMEOUT";
  assert.equal(await client.execute(scope, "INSPECTION", "UPLOAD_INSPECTION", {}, { resource: "CPU", timeoutMs: 1000 }, () => { assert.fail("remote upload was never claimed"); }, async () => { localRuns++; return "scanned"; }), "scanned");
  assert.equal(localRuns, 3);
});

test("an unclaimed upload falls back locally without waiting for the full scan deadline", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const id = randomUUID(), token = randomUUID();
  let abandoned = 0;
  globalThis.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify({ data: [] }), { headers: { "content-type": "application/json" } });
  };
  const prisma = { $queryRaw: async (query: TemplateStringsArray) => {
    const sql = query.join("");
    if (sql.includes("remote_work_available")) return [{ available: true }];
    if (sql.includes("enqueue_remote_work_batch")) return [{ ordinal: 1, id, readToken: token, nodeId: randomUUID(), blocked: false, errorCode: null }];
    if (sql.includes("abandon_remote_work")) { abandoned++; return [{ state: "ABANDONED" }]; }
    assert.fail("unexpected persistence query");
  } } as unknown as PrismaService;
  const client = new RemoteWorkClientService(prisma, { remoteWorkEnabled: true, remoteWorkControlUrl: "http://127.0.0.1:4002" } as AppConfig);
  t.after(() => client.onModuleDestroy());
  let localRuns = 0;
  const result = await client.execute(
    { origin: "UPLOAD", operationId: randomUUID(), workspaceId: randomUUID() },
    "INSPECTION", "UPLOAD_INSPECTION", {}, { resource: "CPU", timeoutMs: 1_000 },
    () => { assert.fail("no remote completion"); },
    async () => { localRuns++; return "ready"; }
  );
  assert.equal(result, "ready");
  assert.equal(localRuns, 1);
  assert.ok(abandoned >= 1);
});

test("a claimed upload remains remote and is never scanned twice", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const id = randomUUID(), token = randomUUID();
  let claimChecks = 0;
  globalThis.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return new Response(JSON.stringify({ data: [{ id, state: "COMPLETED", result: { status: "CLEAN" } }] }), { headers: { "content-type": "application/json" } });
  };
  const prisma = { $queryRaw: async (query: TemplateStringsArray) => {
    const sql = query.join("");
    if (sql.includes("remote_work_available")) return [{ available: true }];
    if (sql.includes("enqueue_remote_work_batch")) return [{ ordinal: 1, id, readToken: token, nodeId: randomUUID(), blocked: false, errorCode: null }];
    if (sql.includes("abandon_remote_work")) { claimChecks++; return [{ state: "CLAIMED" }]; }
    assert.fail("unexpected persistence query");
  } } as unknown as PrismaService;
  const client = new RemoteWorkClientService(prisma, { remoteWorkEnabled: true, remoteWorkControlUrl: "http://127.0.0.1:4002" } as AppConfig);
  t.after(() => client.onModuleDestroy());
  let localRuns = 0;
  const result = await client.execute(
    { origin: "UPLOAD", operationId: randomUUID(), workspaceId: randomUUID() },
    "INSPECTION", "UPLOAD_INSPECTION", {}, { resource: "CPU", timeoutMs: 1_000 },
    (receipt) => String(receipt.status),
    async () => { localRuns++; return "local"; }
  );
  assert.equal(result, "CLEAN");
  assert.equal(localRuns, 0);
  assert.equal(claimChecks, 1);
});

test("provider work admits 64 independent items in one SQL batch and one receipt poll", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const values = new Map<string, number>();
  const batchSizes: number[] = [];
  let polls = 0;
  const prisma = { $queryRaw: async (query: TemplateStringsArray, serialized: string) => {
    assert.match(query.join(""), /enqueue_remote_work_batch/u);
    const entries = JSON.parse(serialized) as { payload: { index: number } }[];
    batchSizes.push(entries.length);
    return entries.map((entry, index) => {
      const id = randomUUID();
      values.set(id, entry.payload.index);
      return { ordinal: index + 1, id, readToken: randomUUID(), nodeId: randomUUID(), blocked: false, errorCode: null };
    });
  } } as unknown as PrismaService;
  globalThis.fetch = async (_url, init) => {
    polls++;
    await new Promise((resolve) => setTimeout(resolve, 1));
    const body = JSON.parse(String(init?.body)) as { entries: { id: string }[] };
    return new Response(JSON.stringify({ data: body.entries.map(({ id }) => ({
      id, state: "COMPLETED", result: { index: values.get(id) }
    })) }), { headers: { "content-type": "application/json" } });
  };
  const client = new RemoteWorkClientService(prisma, {
    remoteWorkEnabled: true, remoteWorkControlUrl: "http://127.0.0.1:4002"
  } as AppConfig);
  t.after(() => client.onModuleDestroy());
  const scope = { origin: "JOB" as const, operationId: randomUUID(), workspaceId: randomUUID() };
  const results = await Promise.all(Array.from({ length: 64 }, (_, index) => client.execute(
    scope, "WORDSTAT", "PROVIDER_HTTP", { index }, { resource: "HTTP", timeoutMs: 5_000 },
    (result) => Number(result.index), async () => -1
  )));
  assert.deepEqual(results, Array.from({ length: 64 }, (_, index) => index));
  assert.deepEqual(batchSizes, [64]);
  assert.equal(polls, 1);
});

test("concurrent crawl pages are admitted as batches instead of one SQL call per page", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const batchSizes: number[] = [];
  const prisma = { $queryRaw: async (query: TemplateStringsArray, serialized: string) => {
    if (query.join("").includes("remote_work_available")) return [{ available: true }];
    assert.match(query.join(""), /enqueue_remote_work_batch/u);
    const entries = JSON.parse(serialized) as unknown[];
    batchSizes.push(entries.length);
    return entries.map((_, index) => ({ ordinal: index + 1, id: randomUUID(), readToken: randomUUID(), nodeId: randomUUID(), blocked: false, errorCode: null }));
  } } as unknown as PrismaService;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { entries: { id: string }[] };
    return new Response(JSON.stringify({ data: body.entries.map(({ id }) => ({ id, state: "COMPLETED", result: { ready: true } })) }));
  };
  const client = new RemoteWorkClientService(prisma, { remoteWorkEnabled: true, remoteWorkControlUrl: "http://127.0.0.1:4002" } as AppConfig);
  t.after(() => client.onModuleDestroy());
  const scope = { origin: "JOB" as const, operationId: randomUUID(), workspaceId: randomUUID() };
  await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    return client.execute(scope, "CRAWL", "CRAWL_RESOURCE", { index }, { resource: "HTTP", timeoutMs: 5000 }, () => true, async () => false);
  }));
  assert.equal(batchSizes.reduce((sum, size) => sum + size, 0), 8);
  assert.ok(Math.max(...batchSizes) >= 3);
  assert.ok(batchSizes.length < 8);
});
