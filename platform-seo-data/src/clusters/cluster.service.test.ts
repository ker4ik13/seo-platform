import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { ClusterService } from "./cluster.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const clusterId = "01900000-0000-7000-8000-000000000004";

const row = {
  id: clusterId,
  workspaceId,
  projectId,
  name: "SEO аудит",
  method: "MANUAL",
  evidence: null,
  status: "ACTIVE" as const,
  version: 2,
  createdAt: new Date("2026-07-30T10:00:00Z"),
  updatedAt: new Date("2026-07-30T11:00:00Z")
};

test("lists tenant-scoped active clusters with active keyword counts", async () => {
  const observed: unknown[] = [];
  const service = new ClusterService({
    cluster: {
      findMany: async ({ where }: { where: unknown }) => {
        observed.push(where);
        return [row];
      }
    },
    keyword: {
      groupBy: async ({ where }: { where: unknown }) => {
        observed.push(where);
        return [{ clusterId, _count: { _all: 7 } }];
      }
    }
  } as unknown as PrismaService);

  const result = await service.list(workspaceId, projectId);

  assert.deepEqual(observed[0], { workspaceId, projectId, status: "ACTIVE" });
  assert.deepEqual(observed[1], {
    workspaceId,
    projectId,
    status: "ACTIVE",
    clusterId: { not: null }
  });
  assert.equal(result[0]?.keywordCount, 7);
  assert.equal(result[0]?.method, "MANUAL");
});

test("refuses to delete a cluster that still owns active keywords", async () => {
  let updated = false;
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    cluster: {
      findFirst: async () => row,
      update: async () => {
        updated = true;
        return row;
      }
    },
    keyword: { count: async () => 2 }
  };
  const service = new ClusterService({
    $transaction: async (callback: (tx: typeof transaction) => Promise<void>) =>
      callback(transaction)
  } as unknown as PrismaService);

  await assert.rejects(
    () =>
      service.delete(clusterId, {
        workspaceId,
        projectId,
        actorId,
        version: 2
      }),
    (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.CONFLICT
  );
  assert.equal(updated, false);
});
