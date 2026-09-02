import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { SemanticGroupColorLegendService } from "./semantic-group-color-legend.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const legendId = "01900000-0000-7000-8000-000000000004";

test("returns an unread project legend when the actor has no receipt", async () => {
  const service = new SemanticGroupColorLegendService({
    semanticGroupColorLegend: { findFirst: async () => row() },
    semanticGroupColorLegendRead: { findUnique: async () => null }
  } as unknown as PrismaService);

  const result = await service.get(workspaceId, projectId, actorId);

  assert.equal(result.unread, true);
  assert.equal(result.version, 2);
  assert.equal(result.entries[0]?.note, "Ждёт сбора позиций");
});

test("returns a virtual empty legend before the first project update", async () => {
  const service = new SemanticGroupColorLegendService({
    semanticGroupColorLegend: { findFirst: async () => null }
  } as unknown as PrismaService);

  assert.deepEqual(await service.get(workspaceId, projectId, actorId), {
    entries: [],
    version: 0,
    unread: false
  });
});

test("rejects legend updates without SEO lead authority", async () => {
  const service = new SemanticGroupColorLegendService({} as PrismaService);
  await assert.rejects(
    () => service.update({
      workspaceId,
      projectId,
      actorId,
      canManage: false,
      version: 0,
      entries: []
    }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === HttpStatus.FORBIDDEN
  );
});

test("creates the first legend and marks its editor as having seen it", async () => {
  let receipt: unknown;
  const transaction = {
    $queryRaw: async () => [{ lockResult: true }],
    semanticGroupColorLegend: {
      findFirst: async () => null,
      create: async () => ({
        ...row(),
        version: 1,
        entries: [{ color: "#0f766e", note: "Пересобрать семантику" }]
      })
    },
    semanticGroupColorLegendRead: {
      upsert: async (input: unknown) => {
        receipt = input;
        return {};
      }
    }
  };
  const service = new SemanticGroupColorLegendService({
    $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
      callback(transaction)
  } as unknown as PrismaService);

  const result = await service.update({
    workspaceId,
    projectId,
    actorId,
    canManage: true,
    version: 0,
    entries: [{ color: "#0f766e", note: "Пересобрать семантику" }]
  });

  assert.equal(result.version, 1);
  assert.equal(result.unread, false);
  assert.deepEqual(
    (receipt as { readonly create: unknown }).create,
    { legendId, userId: actorId, seenVersion: 1 }
  );
});

test("rejects a stale legend update with the current version", async () => {
  const transaction = {
    $queryRaw: async () => [{ lockResult: true }],
    semanticGroupColorLegend: { findFirst: async () => row() }
  };
  const service = new SemanticGroupColorLegendService({
    $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
      callback(transaction)
  } as unknown as PrismaService);

  await assert.rejects(
    () => service.update({
      workspaceId,
      projectId,
      actorId,
      canManage: true,
      version: 1,
      entries: []
    }),
    (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.PRECONDITION_FAILED &&
      (error.getResponse() as { readonly currentVersion?: number })
        .currentVersion === 2
  );
});

test("keeps seen receipts monotonic when an older tab reports a view", async () => {
  let writes = 0;
  const transaction = {
    $queryRaw: async () => [{ lockResult: true }],
    semanticGroupColorLegend: { findFirst: async () => row() },
    semanticGroupColorLegendRead: {
      findUnique: async () => ({ seenVersion: 2 })
    },
    $executeRaw: async () => {
      writes += 1;
      return 1;
    }
  };
  const service = new SemanticGroupColorLegendService({
    $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
      callback(transaction)
  } as unknown as PrismaService);

  const result = await service.markSeen({
    workspaceId,
    projectId,
    actorId,
    version: 1
  });

  assert.equal(writes, 1);
  assert.equal(result.version, 2);
  assert.equal(result.unread, false);
});

test("rejects a seen version newer than the project legend", async () => {
  const transaction = {
    $queryRaw: async () => [{ lockResult: true }],
    semanticGroupColorLegend: { findFirst: async () => row() }
  };
  const service = new SemanticGroupColorLegendService({
    $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
      callback(transaction)
  } as unknown as PrismaService);

  await assert.rejects(
    () => service.markSeen({
      workspaceId,
      projectId,
      actorId,
      version: 3
    }),
    (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.PRECONDITION_FAILED
  );
});

function row() {
  return {
    id: legendId,
    workspaceId,
    projectId,
    entries: [{ color: "#ff0000", note: "Ждёт сбора позиций" }],
    version: 2,
    updatedByUserId: actorId,
    createdAt: new Date("2026-09-02T09:00:00.000Z"),
    updatedAt: new Date("2026-09-02T10:00:00.000Z")
  };
}
