import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { KeywordGroupService } from "./keyword-group.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const unlimitedEntitlement = {
  planCode: "MAX",
  planVersion: 1,
  storedKeywords: 0,
  keywordsPerProject: 0,
  foldersPerProject: 0,
  trackedContextPairs: 0
} as const;

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

test("creates a regular root group after regular siblings, not after system groups", async () => {
  const groupId = "01900000-0000-7000-8000-000000000030";
  const ungroupedId = "01900000-0000-7000-8000-000000000020";
  const trashId = "01900000-0000-7000-8000-000000000021";
  let siblingWhere: unknown;
  let createdData: Readonly<Record<string, unknown>> | undefined;
  const systemGroup = (id: string, kind: "UNGROUPED" | "TRASH") => ({
    id,
    workspaceId,
    projectId,
    parentId: null,
    name: kind === "UNGROUPED" ? "Без группы" : "Корзина",
    path: `__system__/${kind.toLowerCase()}`,
    pathHash: "a".repeat(64),
    color: "#6758ef",
    position: kind === "UNGROUPED" ? 1_998 : 1_999,
    systemKind: kind,
    status: "ACTIVE" as const,
    version: 1,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: new Date("2026-08-01T10:00:00Z"),
    _count: { memberships: 0 }
  });
  const createdGroup = {
    ...systemGroup(groupId, "UNGROUPED"),
    name: "Живые елки",
    path: "Живые елки",
    position: 2,
    systemKind: null
  };
  const transaction = {
    $executeRaw: async () => 1,
    keywordGroup: {
      findFirst: async ({ where }: { where: Readonly<Record<string, unknown>> }) => {
        if (where.systemKind === "UNGROUPED") return { id: ungroupedId };
        if (where.systemKind === "TRASH") return { id: trashId };
        if (where.id === ungroupedId) return systemGroup(ungroupedId, "UNGROUPED");
        if (where.id === trashId) return systemGroup(trashId, "TRASH");
        if (where.id === groupId) return createdGroup;
        return null;
      },
      findMany: async ({ where }: { where: unknown }) => {
        siblingWhere = where;
        return [
          { id: "01900000-0000-7000-8000-000000000031", position: 0 },
          { id: "01900000-0000-7000-8000-000000000032", position: 1 }
        ];
      },
      create: async ({ data }: { data: Readonly<Record<string, unknown>> }) => {
        createdData = data;
        return { id: groupId };
      },
      update: async () => createdGroup
    }
  };
  const service = new KeywordGroupService({
    $transaction: async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction)
  } as unknown as PrismaService);

  const result = await service.create({
    workspaceId,
    projectId,
    actorId,
    entitlement: unlimitedEntitlement,
    name: "Живые елки"
  });

  assert.deepEqual(siblingWhere, {
    workspaceId,
    projectId,
    parentId: null,
    status: "ACTIVE",
    systemKind: null
  });
  assert.equal(createdData?.position, 2);
  assert.equal(result.position, 2);
});

test("creates a sibling at an explicit tree position and shifts following groups", async () => {
  const groupId = "01900000-0000-7000-8000-000000000033";
  const firstId = "01900000-0000-7000-8000-000000000031";
  const secondId = "01900000-0000-7000-8000-000000000032";
  const ungroupedId = "01900000-0000-7000-8000-000000000020";
  const trashId = "01900000-0000-7000-8000-000000000021";
  const updates: Array<Readonly<{ id: string; data: unknown }>> = [];
  const now = new Date("2026-08-21T10:00:00Z");
  const regular = {
    id: groupId,
    workspaceId,
    projectId,
    parentId: null,
    name: "Новая",
    path: "Новая",
    pathHash: "a".repeat(64),
    color: "#6758ef",
    position: 1,
    systemKind: null,
    status: "ACTIVE" as const,
    version: 1,
    createdAt: now,
    updatedAt: now,
    _count: { memberships: 0 }
  };
  const systemGroup = (id: string, kind: "UNGROUPED" | "TRASH") => ({
    ...regular,
    id,
    name: kind === "UNGROUPED" ? "Без группы" : "Корзина",
    path: `__system__/${kind.toLowerCase()}`,
    position: kind === "UNGROUPED" ? 1_998 : 1_999,
    systemKind: kind
  });
  const transaction = {
    $executeRaw: async () => 1,
    keywordGroup: {
      findFirst: async ({ where }: { where: Readonly<Record<string, unknown>> }) => {
        if (where.systemKind === "UNGROUPED") return { id: ungroupedId };
        if (where.systemKind === "TRASH") return { id: trashId };
        if (where.id === ungroupedId) return systemGroup(ungroupedId, "UNGROUPED");
        if (where.id === trashId) return systemGroup(trashId, "TRASH");
        if (where.id === groupId) return regular;
        return null;
      },
      findMany: async () => [
        { id: firstId, position: 0 },
        { id: secondId, position: 1 }
      ],
      create: async () => ({ id: groupId }),
      update: async ({ where, data }: { where: { id: string }; data: unknown }) => {
        updates.push({ id: where.id, data });
        return regular;
      }
    }
  };
  const service = new KeywordGroupService({
    $transaction: async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction)
  } as unknown as PrismaService);

  const result = await service.create({
    workspaceId,
    projectId,
    actorId,
    entitlement: unlimitedEntitlement,
    name: "Новая",
    position: 1
  });

  assert.equal(result.position, 1);
  assert.deepEqual(updates, [
    {
      id: secondId,
      data: { position: 2, version: { increment: 1 } }
    }
  ]);
});

test("reorders siblings by explicit project position without changing parent", async () => {
  const groupId = "01900000-0000-7000-8000-000000000012";
  const firstId = "01900000-0000-7000-8000-000000000011";
  const lastId = "01900000-0000-7000-8000-000000000013";
  const updates: Array<Readonly<{ id: string; data: unknown }>> = [];
  let siblingWhere: unknown;
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
      findMany: async ({
        select,
        where
      }: {
        select?: Readonly<Record<string, unknown>>;
        where?: unknown;
      }) => {
        siblingWhere = where;
        return select?.position
          ? [
              { id: firstId, position: 0 },
              { id: lastId, position: 2 }
            ]
          : [];
      },
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
    actorId,
    version: 1,
    name: "Вторая",
    parentId: null,
    color: "#6758ef",
    position: 0
  });

  assert.equal(result.position, 0);
  assert.deepEqual(siblingWhere, {
    workspaceId,
    projectId,
    parentId: null,
    status: "ACTIVE",
    systemKind: null,
    id: { not: groupId }
  });
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

test("normalizes a legacy out-of-range position while changing only color", async () => {
  const groupId = "01900000-0000-7000-8000-000000000012";
  const firstId = "01900000-0000-7000-8000-000000000011";
  const updates: Array<Readonly<{ id: string; data: unknown }>> = [];
  let groupReads = 0;
  const current = {
    id: groupId,
    workspaceId,
    projectId,
    parentId: null,
    name: "Живые елки",
    path: "Живые елки",
    pathHash: "b".repeat(64),
    color: "#6758ef",
    position: 2_000,
    systemKind: null,
    status: "ACTIVE" as const,
    version: 1,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: new Date("2026-08-01T10:00:00Z"),
    _count: { memberships: 120 }
  };
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: groupId }],
    keywordGroup: {
      findFirst: async () => {
        groupReads += 1;
        return groupReads > 1
          ? { ...current, color: "#ff0000", position: 1, version: 2 }
          : current;
      },
      findMany: async () => [{ id: firstId, position: 0 }],
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
    actorId,
    version: 1,
    name: "Живые елки",
    parentId: null,
    color: "#ff0000"
  });

  assert.equal(result.color, "#ff0000");
  assert.equal(result.position, 1);
  assert.deepEqual(updates[0], {
    id: groupId,
    data: {
      name: "Живые елки",
      parentId: null,
      color: "#ff0000",
      position: 1,
      path: "Живые елки",
      pathHash: "e58342d5f2b44b4b9f0a8c9bed0a9ddd5df9effa7dd30452cf20ade63f9781cc",
      version: { increment: 1 }
    }
  });
});

test("duplicates a group subtree with memberships and preserves child order", async () => {
  const sourceId = "01900000-0000-7000-8000-000000000040";
  const sourceChildId = "01900000-0000-7000-8000-000000000041";
  const duplicateId = "01900000-0000-7000-8000-000000000050";
  const duplicateChildId = "01900000-0000-7000-8000-000000000051";
  const ungroupedId = "01900000-0000-7000-8000-000000000020";
  const trashId = "01900000-0000-7000-8000-000000000021";
  const now = new Date("2026-08-21T10:00:00Z");
  const baseGroup = {
    workspaceId,
    projectId,
    pathHash: "a".repeat(64),
    color: "#6758ef",
    systemKind: null,
    status: "ACTIVE" as const,
    version: 3,
    createdAt: now,
    updatedAt: now,
    _count: { memberships: 2 }
  };
  const source = {
    ...baseGroup,
    id: sourceId,
    parentId: null,
    name: "Каталог",
    path: "Каталог",
    position: 1
  };
  const sourceChild = {
    ...baseGroup,
    id: sourceChildId,
    parentId: sourceId,
    name: "Холодильники",
    path: "Каталог / Холодильники",
    position: 2
  };
  const duplicated = {
    ...baseGroup,
    id: duplicateId,
    parentId: null,
    name: "Каталог — копия",
    path: "Каталог — копия",
    position: 4,
    version: 1
  };
  const systemGroup = (id: string, kind: "UNGROUPED" | "TRASH") => ({
    ...baseGroup,
    id,
    parentId: null,
    name: kind === "UNGROUPED" ? "Без группы" : "Корзина",
    path: `__system__/${kind.toLowerCase()}`,
    position: kind === "UNGROUPED" ? 1_998 : 1_999,
    systemKind: kind,
    version: 1,
    _count: { memberships: 0 }
  });
  const createdData: Readonly<Record<string, unknown>>[] = [];
  let createIndex = 0;
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: sourceId }],
    keywordGroup: {
      findFirst: async ({ where }: { where: Readonly<Record<string, unknown>> }) => {
        if (where.systemKind === "UNGROUPED") return { id: ungroupedId };
        if (where.systemKind === "TRASH") return { id: trashId };
        if (where.id === ungroupedId) return systemGroup(ungroupedId, "UNGROUPED");
        if (where.id === trashId) return systemGroup(trashId, "TRASH");
        if (where.id === sourceId) return source;
        if (where.id === duplicateId) return duplicated;
        if (where.systemKind === null) return { position: 3 };
        return null;
      },
      findMany: async () => [source, sourceChild],
      create: async ({ data }: { data: Readonly<Record<string, unknown>> }) => {
        createdData.push(data);
        const id = createIndex === 0 ? duplicateId : duplicateChildId;
        createIndex += 1;
        return { id };
      }
    }
  };
  const service = new KeywordGroupService({
    $transaction: async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction)
  } as unknown as PrismaService);

  const result = await service.duplicate(sourceId, {
    workspaceId,
    projectId,
    actorId,
    version: 3,
    name: "Каталог — копия",
    color: "#ff0000",
    includeDescendants: true,
    includeKeywords: true
  });

  assert.equal(result.id, duplicateId);
  assert.deepEqual(createdData[0], {
    workspaceId,
    projectId,
    name: "Каталог — копия",
    path: "Каталог — копия",
    pathHash: "f321d438fc561f47f15924343a038af4a9377bca51c00719690034cf03ca5fb2",
    color: "#ff0000",
    position: 4
  });
  assert.deepEqual(createdData[1], {
    workspaceId,
    projectId,
    parentId: duplicateId,
    name: "Холодильники",
    path: "Каталог — копия / Холодильники",
    pathHash: "ce9c272d9f76aa8bee59a751ba91ad7d86d402231dc7889e073315ebd6653a61",
    color: "#6758ef",
    position: 2
  });
});

test("deletes only the selected group and promotes its direct children", async () => {
  const rootParentId = "01900000-0000-7000-8000-000000000060";
  const currentId = "01900000-0000-7000-8000-000000000061";
  const childId = "01900000-0000-7000-8000-000000000062";
  const grandchildId = "01900000-0000-7000-8000-000000000063";
  const beforeId = "01900000-0000-7000-8000-000000000064";
  const afterId = "01900000-0000-7000-8000-000000000065";
  const ungroupedId = "01900000-0000-7000-8000-000000000020";
  const trashId = "01900000-0000-7000-8000-000000000021";
  const now = new Date("2026-08-21T10:00:00Z");
  const base = {
    workspaceId,
    projectId,
    pathHash: "a".repeat(64),
    color: "#6758ef",
    systemKind: null,
    status: "ACTIVE" as const,
    version: 2,
    createdAt: now,
    updatedAt: now,
    _count: { memberships: 0 }
  };
  const parent = {
    ...base,
    id: rootParentId,
    parentId: null,
    name: "Каталог",
    path: "Каталог",
    position: 0
  };
  const current = {
    ...base,
    id: currentId,
    parentId: rootParentId,
    name: "Холодильники",
    path: "Каталог / Холодильники",
    position: 1
  };
  const child = {
    id: childId,
    parentId: currentId,
    name: "Лари",
    path: "Каталог / Холодильники / Лари",
    position: 0
  };
  const grandchild = {
    id: grandchildId,
    parentId: childId,
    name: "Москва",
    path: "Каталог / Холодильники / Лари / Москва",
    position: 0
  };
  const systemGroup = (id: string, kind: "UNGROUPED" | "TRASH") => ({
    ...base,
    id,
    parentId: null,
    name: kind === "UNGROUPED" ? "Без группы" : "Корзина",
    path: `__system__/${kind.toLowerCase()}`,
    position: kind === "UNGROUPED" ? 1_998 : 1_999,
    systemKind: kind
  });
  const updates: Array<Readonly<{ id: string; data: unknown }>> = [];
  let deletedWhere: unknown;
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: currentId }],
    keywordGroup: {
      findFirst: async ({ where }: { where: Readonly<Record<string, unknown>> }) => {
        if (where.systemKind === "UNGROUPED") return { id: ungroupedId };
        if (where.systemKind === "TRASH") return { id: trashId };
        if (where.id === ungroupedId) return systemGroup(ungroupedId, "UNGROUPED");
        if (where.id === trashId) return systemGroup(trashId, "TRASH");
        if (where.id === currentId) return current;
        if (where.id === rootParentId) return parent;
        return null;
      },
      findMany: async ({ where }: { where: Readonly<Record<string, unknown>> }) =>
        where.OR
          ? [
              {
                id: current.id,
                parentId: current.parentId,
                name: current.name,
                path: current.path,
                position: current.position
              },
              child,
              grandchild
            ]
          : [
              { id: beforeId, position: 0 },
              { id: afterId, position: 2 }
            ],
      update: async ({ where, data }: { where: { id: string }; data: unknown }) => {
        updates.push({ id: where.id, data });
        return current;
      },
      updateMany: async ({ where }: { where: unknown }) => {
        deletedWhere = where;
        return { count: 1 };
      }
    },
    keywordGroupMembership: {
      findMany: async () => []
    }
  };
  const service = new KeywordGroupService({
    $transaction: async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction)
  } as unknown as PrismaService);

  await service.delete(currentId, {
    workspaceId,
    projectId,
    actorId,
    version: 2,
    deleteKeywords: false,
    promoteChildren: true
  });

  assert.deepEqual(deletedWhere, { id: { in: [currentId] } });
  assert.deepEqual(updates[0], {
    id: childId,
    data: {
      parentId: rootParentId,
      position: 1,
      path: "Каталог / Лари",
      pathHash: "0949e09b8d1f9906b650437320ee64059df0213e38f95b78eadedebe2e9ea34d",
      version: { increment: 1 }
    }
  });
  assert.deepEqual(updates[1], {
    id: grandchildId,
    data: {
      path: "Каталог / Лари / Москва",
      pathHash: "ad4d03faca89b652dfb7a74dffc94e4ceb1d7a79cdac3840e1402f7c483abdd0",
      version: { increment: 1 }
    }
  });
});
