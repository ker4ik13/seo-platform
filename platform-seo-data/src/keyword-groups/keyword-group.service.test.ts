import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { KeywordGroupService } from "./keyword-group.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";

test("lists only tenant-scoped active groups with keyword counts", async () => {
  let observedWhere: unknown;
  const regular = {
    id: "01900000-0000-7000-8000-000000000010",
    workspaceId,
    projectId,
    parentId: null,
    name: "Услуги",
    path: "Услуги",
    pathHash: "a".repeat(64),
    color: "#6758ef",
    position: 0,
    systemKind: null,
    status: "ACTIVE" as const,
    version: 2,
    createdAt: new Date("2026-07-30T10:00:00Z"),
    updatedAt: new Date("2026-07-30T11:00:00Z"),
    _count: { memberships: 12 }
  };
  const systemRows = {
    UNGROUPED: { ...regular, id: "01900000-0000-7000-8000-000000000020", name: "Без группы", path: "__system__/ungrouped", systemKind: "UNGROUPED" as const, position: 1_998, _count: { memberships: 0 } },
    TRASH: { ...regular, id: "01900000-0000-7000-8000-000000000021", name: "Корзина", path: "__system__/trash", systemKind: "TRASH" as const, position: 1_999, _count: { memberships: 0 } }
  };
  const transaction = {
    $executeRaw: async () => 1,
    keywordGroup: {
      findFirst: async ({ where }: { where: { id?: string; systemKind?: "UNGROUPED" | "TRASH" } }) => {
        if (where.systemKind) return { id: systemRows[where.systemKind].id };
        if (where.id === systemRows.UNGROUPED.id) return systemRows.UNGROUPED;
        if (where.id === systemRows.TRASH.id) return systemRows.TRASH;
        return null;
      },
      findMany: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return [regular, systemRows.UNGROUPED, systemRows.TRASH];
      }
    }
  };
  const service = new KeywordGroupService({
    $transaction: async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction)
  } as unknown as PrismaService);

  const result = await service.list(workspaceId, projectId);

  assert.deepEqual(observedWhere, {
    workspaceId,
    projectId,
    status: "ACTIVE"
  });
  assert.equal(result[0]?.path, "Услуги");
  assert.equal(result[0]?.keywordCount, 12);
  assert.equal(result[0]?.version, 2);
  assert.equal(result[1]?.systemKind, "UNGROUPED");
  assert.equal(result[2]?.systemKind, "TRASH");
});

test("reorders siblings by explicit project position without changing parent", async () => {
  const groupId = "01900000-0000-7000-8000-000000000012";
  const firstId = "01900000-0000-7000-8000-000000000011";
  const lastId = "01900000-0000-7000-8000-000000000013";
  const updates: Array<Readonly<{ id: string; data: unknown }>> = [];
  let groupReads = 0;
  const current = {
    id: groupId,
    workspaceId,
    projectId,
    parentId: null,
    name: "Вторая",
    path: "Вторая",
    pathHash: "b".repeat(64),
    color: "#6758ef",
    position: 1,
    status: "ACTIVE" as const,
    version: 1,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: new Date("2026-08-01T10:00:00Z"),
    _count: { memberships: 0 }
  };
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: groupId }],
    keywordGroup: {
      findFirst: async () => {
        groupReads += 1;
        return groupReads > 1
          ? { ...current, position: 0, version: 2 }
          : current;
      },
      findMany: async ({ select }: { select?: Readonly<Record<string, unknown>> }) =>
        select?.position
          ? [
              { id: firstId, position: 0 },
              { id: lastId, position: 2 }
            ]
          : [],
      update: async ({ where, data }: { where: { id: string }; data: unknown }) => {
        updates.push({ id: where.id, data });
        return current;
      }
    }
  };
  const service = new KeywordGroupService({
    $transaction: async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction)
  } as unknown as PrismaService);

  const result = await service.update(groupId, {
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    version: 1,
    name: "Вторая",
    parentId: null,
    color: "#6758ef",
    position: 0
  });

  assert.equal(result.position, 0);
  assert.deepEqual(updates[0], {
    id: groupId,
    data: {
      name: "Вторая",
      parentId: null,
      color: "#6758ef",
      position: 0,
      path: "Вторая",
      pathHash: "8ba170962c1a922ec9e17bb0a57b2f0b1aa86b751077277186928f69578a60cc",
      version: { increment: 1 }
    }
  });
  assert.deepEqual(updates[1], {
    id: firstId,
    data: { position: 1, version: { increment: 1 } }
  });
});
