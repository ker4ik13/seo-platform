import assert from "node:assert/strict";
import test from "node:test";
import type { SemanticDuplicateRules } from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import type { SemanticVersionService } from "../semantic-versions/semantic-version.service.js";
import {
  implicitDuplicateSignature,
  SemanticDuplicateService
} from "./semantic-duplicate.service.js";

const exactRules: SemanticDuplicateRules = {
  analysisMode: "EXACT",
  caseSensitive: false,
  ignorePunctuation: true,
  ignoredWords: []
};

test("finds order-independent duplicates and preserves token multiplicity", () => {
  assert.equal(
    implicitDuplicateSignature("цветная капуста", exactRules),
    implicitDuplicateSignature("Капуста цветная", exactRules)
  );
  assert.notEqual(
    implicitDuplicateSignature("цветная цветная капуста", exactRules),
    implicitDuplicateSignature("капуста цветная", exactRules)
  );
  assert.notEqual(
    implicitDuplicateSignature("цветная капуста свежая", exactRules),
    implicitDuplicateSignature("капуста цветная", exactRules)
  );
});

test("supports precise Russian word forms and ignored words", () => {
  const rules: SemanticDuplicateRules = {
    ...exactRules,
    analysisMode: "WORD_FORM_PRECISE",
    ignoredWords: ["в"]
  };
  assert.equal(
    implicitDuplicateSignature("красная машина в Москве", rules),
    implicitDuplicateSignature("машины красные Москва", rules)
  );
});

test("can keep punctuation significant", () => {
  const rules: SemanticDuplicateRules = {
    ...exactRules,
    ignorePunctuation: false
  };
  assert.notEqual(
    implicitDuplicateSignature("купить, дом", rules),
    implicitDuplicateSignature("дом купить", rules)
  );
});

test("previews keeper selection and moves only reviewed duplicates to trash", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const actorId = "33333333-3333-4333-8333-333333333333";
  const keeperId = "44444444-4444-4444-8444-444444444444";
  const duplicateId = "55555555-5555-4555-8555-555555555555";
  const groupId = "66666666-6666-4666-8666-666666666666";
  const trashId = "77777777-7777-4777-8777-777777777777";
  const ungroupedId = "88888888-8888-4888-8888-888888888888";
  const createdAt = new Date("2026-08-12T10:00:00.000Z");
  const previewRows = [
    previewRow({
      id: keeperId,
      textOriginal: "цветная капуста",
      priority: 10,
      createdAt,
      groupId
    }),
    previewRow({
      id: duplicateId,
      textOriginal: "капуста цветная",
      priority: 5,
      createdAt: new Date(createdAt.getTime() + 1_000),
      groupId
    })
  ];
  const versionRows = previewRows.map((row) => ({
    ...row,
    memberships: [{ group: { id: groupId } }],
    tags: []
  }));
  const membershipCreates: unknown[] = [];
  const versionWrites: unknown[] = [];
  const transaction = {
    $executeRaw: async () => 1,
    keyword: {
      findMany: async () => versionRows,
      updateMany: async () => ({ count: 1 })
    },
    keywordGroup: {
      findFirst: async ({ where }: { readonly where: { readonly systemKind: string } }) => ({
        id: where.systemKind === "TRASH" ? trashId : ungroupedId
      })
    },
    keywordGroupMembership: {
      deleteMany: async () => ({ count: 1 }),
      createMany: async (input: unknown) => {
        membershipCreates.push(input);
        return { count: 1 };
      }
    }
  };
  const prisma = {
    keyword: { findMany: async () => previewRows },
    frequencySnapshot: {
      findMany: async () => [
        { keywordId: keeperId, type: "BASE", value: 2_000n },
        { keywordId: keeperId, type: "EXACT", value: 800n },
        { keywordId: keeperId, type: "FIXED", value: 120n },
        { keywordId: duplicateId, type: "BASE", value: 500n }
      ]
    },
    $transaction: async (operation: (client: unknown) => Promise<unknown>) =>
      operation(transaction)
  } as unknown as PrismaService;
  const semanticVersions = {
    createWithChanges: async (...input: unknown[]) => {
      versionWrites.push(input);
    }
  } as unknown as SemanticVersionService;
  const service = new SemanticDuplicateService(prisma, semanticVersions);
  const command = {
    workspaceId,
    projectId,
    actorId,
    rules: exactRules,
    scope: { kind: "PROJECT" as const },
    keeperStrategy: "HIGHEST_FREQUENCY" as const
  };

  const preview = await service.preview({
    ...command,
    page: 1,
    pageSize: 100
  });
  assert.equal(preview.duplicateGroupCount, 1);
  assert.equal(preview.deletionCount, 1);
  assert.equal(preview.groups[0]?.keeperKeywordId, keeperId);
  assert.deepEqual(preview.batchItems, [{ id: duplicateId, version: 1 }]);
  const keeperPreview = preview.groups[0]?.items.find(
    ({ keywordId }) => keywordId === keeperId
  );
  assert.equal(keeperPreview?.baseFrequency, "2000");
  assert.equal(keeperPreview?.exactFrequency, "800");
  assert.equal(keeperPreview?.fixedFrequency, "120");

  const result = await service.apply({
    ...command,
    previewHash: preview.previewHash,
    decisions: [{
      groupId: preview.groups[0]!.id,
      keeper: { id: duplicateId, version: 1 },
      deletions: [{ id: keeperId, version: 1 }]
    }]
  });
  assert.deepEqual(result, {
    deletedCount: 1,
    deletedKeywordIds: [keeperId],
    hasMore: false
  });
  assert.equal(membershipCreates.length, 1);
  assert.deepEqual(membershipCreates[0], {
    data: [{ projectId, keywordId: keeperId, groupId: trashId }]
  });
  assert.equal(versionWrites.length, 1);
  const [, versionInput, changes] = versionWrites[0] as readonly unknown[];
  assert.equal(
    (versionInput as { readonly reason: string }).reason,
    "IMPLICIT_DUPLICATES"
  );
  assert.equal((changes as readonly unknown[]).length, 1);
});

test("preview exposes ninety complete duplicate groups with their folder paths", async () => {
  const createdAt = new Date("2026-08-12T10:00:00.000Z");
  const rows = Array.from({ length: 90 }, (_, index) => {
    const groupId = indexedId(index + 1_000);
    const first = previewRow({
      id: indexedId(index * 2),
      textOriginal: `товар ${index + 1} купить`,
      priority: 10,
      createdAt,
      groupId
    });
    const second = previewRow({
      id: indexedId(index * 2 + 1),
      textOriginal: `купить товар ${index + 1}`,
      priority: 5,
      createdAt: new Date(createdAt.getTime() + 1_000),
      groupId
    });
    return [
      index === 0
        ? {
            ...first,
            memberships: [
              { group: { path: "Каталог / Товары", id: groupId } },
              { group: { path: "Продажи", id: indexedId(2_000) } }
            ]
          }
        : first,
      second
    ];
  }).flat();
  const service = new SemanticDuplicateService({
    keyword: { findMany: async () => rows },
    frequencySnapshot: { findMany: async () => [] }
  } as unknown as PrismaService, {} as SemanticVersionService);

  const preview = await service.preview({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    actorId: "33333333-3333-4333-8333-333333333333",
    rules: exactRules,
    scope: { kind: "PROJECT" },
    keeperStrategy: "HIGHEST_PRIORITY",
    page: 1,
    pageSize: 100
  });

  assert.equal(preview.duplicateGroupCount, 90);
  assert.equal(preview.groups.length, 90);
  assert.equal(preview.deletionCount, 90);
  assert.equal(preview.groupsTruncated, false);
  assert.ok(preview.groups.every(({ items }) =>
    items.length === 2 && items.every(({ text }) => text.length > 0)
  ));
  assert.deepEqual(
    preview.groups.flatMap(({ items }) => items)
      .find(({ keywordId }) => keywordId === indexedId(0))?.groupPaths,
    ["Каталог / Товары", "Продажи"]
  );
});

test("paginates every duplicate group by one hundred with a stable preview hash", async () => {
  const createdAt = new Date("2026-08-12T10:00:00.000Z");
  const rows = Array.from({ length: 205 }, (_, index) => {
    const groupId = indexedId(index + 3_000);
    return [
      previewRow({
        id: indexedId(index * 2 + 5_000),
        textOriginal: `товар ${index + 1} купить`,
        priority: 10,
        createdAt,
        groupId
      }),
      previewRow({
        id: indexedId(index * 2 + 5_001),
        textOriginal: `купить товар ${index + 1}`,
        priority: 5,
        createdAt: new Date(createdAt.getTime() + 1_000),
        groupId
      })
    ];
  }).flat();
  const service = new SemanticDuplicateService({
    keyword: { findMany: async () => rows },
    frequencySnapshot: { findMany: async () => [] }
  } as unknown as PrismaService, {} as SemanticVersionService);
  const command = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    actorId: "33333333-3333-4333-8333-333333333333",
    rules: exactRules,
    scope: { kind: "PROJECT" as const },
    keeperStrategy: "HIGHEST_PRIORITY" as const,
    pageSize: 100 as const
  };

  const [first, second, third] = await Promise.all([
    service.preview({ ...command, page: 1 }),
    service.preview({ ...command, page: 2 }),
    service.preview({ ...command, page: 3 })
  ]);

  assert.deepEqual(
    [first.groups.length, second.groups.length, third.groups.length],
    [100, 100, 5]
  );
  assert.equal(first.pageCount, 3);
  assert.equal(second.page, 2);
  assert.equal(third.groupsTruncated, true);
  assert.equal(first.previewHash, second.previewHash);
  assert.equal(second.previewHash, third.previewHash);
  assert.equal(
    new Set([...first.groups, ...second.groups, ...third.groups]
      .map(({ id }) => id)).size,
    205
  );
});

function indexedId(index: number): string {
  return `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`;
}

function previewRow({
  id,
  textOriginal,
  priority,
  createdAt,
  groupId
}: Readonly<{
  id: string;
  textOriginal: string;
  priority: number;
  createdAt: Date;
  groupId: string;
}>) {
  return {
    id,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    textOriginal,
    textNormalized: textOriginal.toLocaleLowerCase("ru-RU"),
    normalizedHash: "a".repeat(64),
    language: "ru",
    priority,
    isFavorite: false,
    intent: null,
    note: null,
    status: "ACTIVE" as const,
    clusterId: null,
    targetPageId: null,
    isTracked: false,
    customValues: {},
    sourceMode: "MANUAL" as const,
    sourceId: null,
    createdBy: null,
    updatedBy: null,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    memberships: [{ group: { path: "Каталог / Овощи", id: groupId } }]
  };
}
