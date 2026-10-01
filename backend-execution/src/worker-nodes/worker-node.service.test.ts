import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { WorkerNodeService } from "./worker-node.service.js";

const id = "01900000-0000-7000-8000-000000000001";

test("each worker gets a one-time secret and only its hash is persisted", async () => {
  let saved: Record<string, unknown> | undefined;
  const prisma = {
    executionWorkerNode: {
      async create({ data }: { data: Record<string, unknown> }) {
        saved = data;
        return row(data);
      },
      async findUnique() { return saved ? row(saved) : null; },
      async updateMany() { return { count: 1 }; }
    }
  } as unknown as PrismaService;
  const service = new WorkerNodeService(prisma);
  const created = await service.create({
    name: "office-one", capabilities: ["RANK"],
    maxHttpSlots: 32, maxCpuSlots: 2
  });
  assert.match(created.token, /^wn_[A-Za-z0-9_-]{43}$/u);
  assert.equal(created.node.enabled, false);
  assert.equal(JSON.stringify(created.node).includes(created.token), false);
  assert.ok(saved);
  assert.equal(saved.token, undefined);
  assert.equal((saved.tokenHash as Uint8Array).length, 32);
  const heartbeat = await service.heartbeat(id, created.token, {
    protocolVersion: 1,
    httpSlots: 8,
    rankSlots: 4,
    cpuSlots: 1,
    memoryBytes: 16_000_000_000n,
    activeWorkItems: 0
  });
  assert.equal(heartbeat.id, id);
  await assert.rejects(() => service.heartbeat(id, `wn_${"a".repeat(43)}`, {
    protocolVersion: 1,
    httpSlots: 1,
    rankSlots: 1,
    cpuSlots: 1,
    memoryBytes: 0n,
    activeWorkItems: 0
  }), UnauthorizedException);
});

test("admin list shows only safe active Job assignments", async () => {
  const prisma = {
    executionWorkerNode: {
      async findMany() { return [row({ tokenHash: new Uint8Array(32) })]; }
    },
    async $queryRaw(query: TemplateStringsArray) {
      if (query.join("").includes("list_remote_work_assignments")) return [];
      return [{
        nodeId: id,
        jobId: "01900000-0000-7000-8000-000000000002",
        searchEngine: "YANDEX",
        activeTasks: 2n
      }];
    }
  } as unknown as PrismaService;
  const nodes = await new WorkerNodeService(prisma).list();
  assert.equal(nodes[0]?.activeAssignments?.[0]?.activeTasks, 2);
  assert.equal(JSON.stringify(nodes).includes("tokenHash"), false);
});

function row(data: Record<string, unknown>) {
  return {
    id,
    name: data.name ?? "office-one",
    tokenHash: data.tokenHash,
    enabled: data.enabled ?? false,
    draining: false,
    capabilities: data.capabilities ?? ["RANK"],
    maxHttpSlots: data.maxHttpSlots ?? 32,
    maxCpuSlots: data.maxCpuSlots ?? 2,
    reportedHttpSlots: 0,
    reportedRankSlots: 0,
    reportedCpuSlots: 0,
    reportedMemoryBytes: 0n,
    activeWorkItems: 0,
    lastHeartbeatAt: null,
    lastProtocolVersion: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

test("deletion hides the node, revokes its token, replays safely and cannot be reversed by configuration", async () => {
  let saved: Record<string, unknown> | undefined;
  const prisma = {
    executionWorkerNode: {
      create: async ({data}: {data: Record<string,unknown>}) => { saved = { ...row(data), deletedAt: null }; return saved; },
      findUnique: async () => saved,
      findMany: async ({where}: {where: {deletedAt: null}}) => { assert.equal(where.deletedAt, null); return saved?.deletedAt ? [] : [saved]; },
      updateMany: async ({where,data}: {where: {id: string;deletedAt?: null};data: Record<string,unknown>}) => {
        if (!saved || (where.deletedAt === null && saved.deletedAt)) return { count: 0 };
        Object.assign(saved, data); return { count: 1 };
      }
    },
    $queryRaw: async () => []
  } as unknown as PrismaService;
  const service = new WorkerNodeService(prisma), configuration = { name: "fixture", capabilities: ["RANK" as const], maxHttpSlots: 16, maxCpuSlots: 2 };
  const created = await service.create(configuration), removed = await service.remove(id);
  assert.deepEqual(await service.remove(id), removed);
  assert.equal(saved?.enabled, false); assert.equal(saved?.draining, true);
  assert.deepEqual(await service.list(), []);
  await assert.rejects(service.authenticateForCompletion(id, created.token), UnauthorizedException);
  await assert.rejects(service.setEnabled(id, true), NotFoundException);
  await assert.rejects(service.setDraining(id, false), NotFoundException);
  await assert.rejects(service.configure(id, configuration), NotFoundException);
});
