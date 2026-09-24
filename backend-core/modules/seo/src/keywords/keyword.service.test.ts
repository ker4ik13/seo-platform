import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BadRequestException,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import type {
  InternalCreateSemanticKeywordInput,
  InternalSemanticKeywordMergeInput,
  InternalUpdateSemanticKeywordInput,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { SemanticVersionService } from "../semantic-versions/semantic-version.service.js";
import { KeywordService } from "./keyword.service.js";

const sha256ForTest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";

test("suggests the closest intact keyword without invoking extension functions", async () => {
  const brokenId = "01900000-0000-7000-8000-000000000006";
  const candidateId = "01900000-0000-7000-8000-000000000007";
  let calls = 0;
  const service = new KeywordService({
    keyword: {
      findMany: async () => {
        calls += 1;
        return calls === 1
          ? [{
              id: brokenId,
              version: 2,
              textOriginal: "гербицид г��ейдер купить",
              textNormalized: "гербицид г��ейдер купить",
              language: "ru"
            }]
          : [{
              id: candidateId,
              version: 4,
              textOriginal: "гербицид грейдер купить",
              textNormalized: "гербицид грейдер купить"
            }];
      }
    }
  } as unknown as PrismaService, {} as SemanticVersionService);

  const result = await service.mergeSuggestions(workspaceId, projectId);

  assert.equal(result[0]?.source.id, brokenId);
  assert.equal(result[0]?.candidate.id, candidateId);
  assert.ok((result[0]?.similarity ?? 0) > 0.8);
});

test("lists tag usage and deletes a tag from every linked keyword atomically", async () => {
  const tagId = "01900000-0000-7000-8000-000000000008";
  const actorId = "01900000-0000-7000-8000-000000000009";
  const writes: unknown[] = [];
  const transaction = {
    $executeRaw: async () => 1,
    tag: {
      findFirst: async () => ({ id: tagId, name: "Важный" }),
      update: async (value: unknown) => {
        writes.push(value);
        return { id: tagId };
      }
    },
    keywordTag: {
      count: async () => 3,
      deleteMany: async (value: unknown) => {
        writes.push(value);
        return { count: 3 };
      }
    },
    keyword: {
      updateMany: async (value: unknown) => {
        writes.push(value);
        return { count: 3 };
      }
    }
  };
  let versionCount = -1;
  const service = new KeywordService({
    tag: {
      findMany: async () => [{ id: tagId, name: "Важный" }]
    },
    keywordTag: {
      groupBy: async () => [{ tagId, _count: { _all: 3 } }]
    },
    $transaction: async (work: (client: typeof transaction) => unknown) =>
      work(transaction)
  } as unknown as PrismaService, {
    createIrreversibleVersion: async (
      _transaction: unknown,
      _input: unknown,
      count: number
    ) => {
      versionCount = count;
      return undefined;
    }
  } as unknown as SemanticVersionService);

  assert.deepEqual(await service.tagManagementOptions(workspaceId, projectId), [{
    id: tagId,
    name: "Важный",
    keywordCount: 3
  }]);
  assert.deepEqual(
    await service.deleteTag(workspaceId, projectId, actorId, tagId),
    { tagId, name: "Важный", detachedKeywordCount: 3 }
  );
  assert.equal(versionCount, 3);
  assert.deepEqual(writes[0], {
    where: {
      workspaceId,
      projectId,
      tags: { some: { projectId, tagId } }
    },
    data: { updatedBy: actorId, version: { increment: 1 } }
  });
});

test("merges mutable keyword data while keeping immutable history on aliases", async () => {
  const keeperId = "01900000-0000-7000-8000-000000000010";
  const sourceId = "01900000-0000-7000-8000-000000000011";
  const groupId = "01900000-0000-7000-8000-000000000012";
  const tagId = "01900000-0000-7000-8000-000000000013";
  const columnId = "01900000-0000-7000-8000-000000000014";
  const actorId = "01900000-0000-7000-8000-000000000015";
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, value: unknown) => {
    (calls[name] ??= []).push(value);
  };
  const keyword = (id: string, source: boolean) => ({
    id,
    workspaceId,
    projectId,
    textOriginal: source ? "гербицид г��ейдер купить" : "гербицид грейдер купить",
    textNormalized: source ? "гербицид г��ейдер купить" : "гербицид грейдер купить",
    normalizedHash: sha256ForTest(source ? "broken" : "correct"),
    language: "ru",
    priority: source ? 9 : 2,
    isFavorite: source,
    isTracked: true,
    showAiAnswerButton: false,
    intent: null,
    note: source ? "Историческая заметка" : null,
    status: "ACTIVE",
    clusterId: null,
    targetPageId: null,
    customValues: source ? { kc: "42" } : {},
    sourceMode: "IMPORT",
    sourceId: null,
    createdBy: actorId,
    updatedBy: actorId,
    version: source ? 5 : 3,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    deletedAt: null,
    memberships: source ? [{ group: { id: groupId, name: "Импорт", path: "Импорт", systemKind: null } }] : [],
    tags: source ? [{ tag: { id: tagId, name: "KC" } }] : [],
    typedCustomValues: source ? [{
      workspaceId,
      projectId,
      keywordId: id,
      columnId,
      textValue: "значение",
      integerValue: null,
      decimalValue: null,
      booleanValue: null,
      dateValue: null,
      datetimeValue: null,
      stringArrayValue: [],
      userId: null,
      version: 1,
      updatedBy: actorId,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      column: { type: "TEXT" }
    }] : [],
    _count: { memberships: source ? 1 : 0 }
  });
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    keyword: {
      findMany: async () => [keyword(keeperId, false), keyword(sourceId, true)],
      update: async ({ data }: { data: unknown }) => {
        record("keeperUpdate", data);
        return { ...keyword(keeperId, false), version: 4 };
      },
      updateMany: async (value: unknown) => {
        record("sourceUpdate", value);
        return { count: 1 };
      }
    },
    keywordMerge: {
      findMany: async () => [],
      updateMany: async (value: unknown) => {
        record("mergeReparent", value);
        return { count: 0 };
      },
      createMany: async (value: unknown) => {
        record("mergeCreate", value);
        return { count: 1 };
      }
    },
    keywordGroupMembership: {
      createMany: async (value: unknown) => { record("groupCreate", value); return { count: 1 }; },
      deleteMany: async (value: unknown) => { record("groupDelete", value); return { count: 1 }; }
    },
    keywordTag: {
      createMany: async (value: unknown) => { record("tagCreate", value); return { count: 1 }; },
      deleteMany: async (value: unknown) => { record("tagDelete", value); return { count: 1 }; }
    },
    semanticKeywordCustomValue: {
      createMany: async (value: unknown) => { record("customCreate", value); return { count: 1 }; },
      deleteMany: async (value: unknown) => { record("customDelete", value); return { count: 1 }; }
    },
    trackingContextKeywordAssignment: {
      findMany: async () => [],
      createMany: async (value: unknown) => { record("assignmentCreate", value); return { count: 0 }; },
      updateMany: async (value: unknown) => { record("assignmentUpdate", value); return { count: 0 }; }
    },
    outboxEvent: { create: async (value: unknown) => { record("outbox", value); return value; } }
  };
  const service = new KeywordService({
    $transaction: async (work: (client: typeof transaction) => unknown) => work(transaction)
  } as unknown as PrismaService, {} as SemanticVersionService);
  const input: InternalSemanticKeywordMergeInput = {
    workspaceId,
    projectId,
    actorId,
    keeper: { id: keeperId, version: 3 },
    sources: [{ id: sourceId, version: 5 }]
  };

  const result = await service.merge(input);

  assert.deepEqual(result.mergedKeywordIds, [sourceId]);
  assert.equal(result.keeperVersion, 4);
  const mergeCreate = calls.mergeCreate?.[0] as { data: unknown[] } | undefined;
  assert.ok(mergeCreate);
  assert.equal(mergeCreate.data.length, 1);
  assert.match(JSON.stringify(calls.keeperUpdate?.[0]), /Историческая заметка/u);
  assert.match(JSON.stringify(calls.sourceUpdate?.[0]), /DELETED/u);
  assert.equal("rankSnapshot" in transaction, false);
});

test("previews existing keyword memberships without mutating them", async () => {
  const targetGroupId = "01900000-0000-7000-8000-000000000020";
  const otherGroupId = "01900000-0000-7000-8000-000000000021";
  const trashGroupId = "01900000-0000-7000-8000-000000000022";
  const service = new KeywordService(
    {
      keyword: {
        findMany: async () => [
          {
            id: "01900000-0000-7000-8000-000000000030",
            language: "ru",
            normalizedHash: sha256ForTest("существующий запрос"),
            status: "ACTIVE",
            version: 3,
            memberships: [
              {
                group: {
                  id: otherGroupId,
                  name: "Другая",
                  path: "Каталог / Другая",
                  systemKind: null
                }
              }
            ]
          },
          {
            id: "01900000-0000-7000-8000-000000000031",
            language: "ru",
            normalizedHash: sha256ForTest("запрос в корзине"),
            status: "DELETED",
            version: 4,
            memberships: [
              {
                group: {
                  id: trashGroupId,
                  name: "Корзина",
                  path: "Корзина",
                  systemKind: "TRASH"
                }
              }
            ]
          }
        ]
      },
      keywordGroupMembership: {
        findMany: async () => [
          {
            keywordId: "01900000-0000-7000-8000-000000000030",
            group: {
              id: targetGroupId,
              name: "Текущая",
              path: "Текущая",
              systemKind: null
            }
          }
        ]
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.previewBulkCreate({
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    items: [
      {
        text: "Существующий запрос",
        language: "ru",
        groupId: targetGroupId
      },
      { text: "Новый запрос", language: "ru", groupId: targetGroupId },
      { text: "Запрос в корзине", language: "ru", groupId: targetGroupId }
    ]
  });

  assert.equal(result.selected, 3);
  assert.equal(result.newKeywords, 1);
  assert.equal(result.activeDuplicates, 1);
  assert.equal(result.trashedDuplicates, 1);
  assert.equal(result.rows[0]?.inTargetGroup, true);
  assert.deepEqual(
    result.rows[0]?.groups.map(({ path }) => path),
    ["Каталог / Другая", "Текущая"]
  );
  assert.equal(result.rows[1]?.state, "NEW");
  assert.equal(result.rows[2]?.state, "TRASHED_DUPLICATE");
});

test("averages the latest found position once per active keyword", async () => {
  let summaryQuery: Prisma.Sql | undefined;
  const service = new KeywordService(
    {
      $queryRaw: async (query: Prisma.Sql) => {
        summaryQuery = query;
        return [{ position: 10 }, { position: 20 }];
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  assert.deepEqual(await service.positionSummary(workspaceId, projectId), {
    positionedKeywordCount: 2,
    averagePosition: 15,
    top1KeywordCount: 0,
    top3KeywordCount: 0,
    top5KeywordCount: 0,
    top10KeywordCount: 1,
    top30KeywordCount: 2,
    top50KeywordCount: 2
  });
  assert.match(summaryQuery?.sql ?? "", /rank_dimension_history_deletions/u);
  assert.match(summaryQuery?.sql ?? "", /keyword\.is_tracked/u);
  assert.doesNotMatch(summaryQuery?.sql ?? "", /tracking_contexts|context\.status/u);
});

test("position summary stays inside one exact project rank dimension", async () => {
  let summaryQuery: Prisma.Sql | undefined;
  const service = new KeywordService(
    {
      rankDimensionMerge: { findMany: async () => [] },
      $queryRaw: async (query: Prisma.Sql) => {
        summaryQuery = query;
        return [{ position: 7 }];
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.positionSummary(workspaceId, projectId, {
    includeUntracked: true,
    rankDimensionKey: "YANDEX|RU|213|ru|DESKTOP"
  });

  assert.equal(result.averagePosition, 7);
  assert.match(summaryQuery?.sql ?? "", /configuration\.search_engine/u);
  assert.deepEqual(
    (summaryQuery?.values ?? []).filter((value) => ["YANDEX", "RU", "213", "ru", "DESKTOP"].includes(String(value))),
    ["YANDEX", "RU", "213", "ru", "DESKTOP"]
  );
});

test("carries every keyword's latest known position through later capture days", async () => {
  const queries: Prisma.Sql[] = [];
  const service = new KeywordService(
    {
      $queryRaw: async (query: Prisma.Sql) => {
        queries.push(query);
        return [
          {
            dayKey: "2026-09-01",
            observedAt: new Date("2026-09-01T18:00:00.000Z"),
            measuredKeywordCount: 4n,
            positionedKeywordCount: 3n,
            top1KeywordCount: 1n,
            top3KeywordCount: 1n,
            top5KeywordCount: 1n,
            top10KeywordCount: 3n,
            top30KeywordCount: 3n,
            top50KeywordCount: 3n
          },
          {
            dayKey: "2026-09-02",
            observedAt: new Date("2026-09-02T20:00:00.000Z"),
            measuredKeywordCount: 4n,
            positionedKeywordCount: 3n,
            top1KeywordCount: 0n,
            top3KeywordCount: 0n,
            top5KeywordCount: 2n,
            top10KeywordCount: 2n,
            top30KeywordCount: 3n,
            top50KeywordCount: 3n
          }
        ];
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  assert.deepEqual(await service.positionHistory(workspaceId, projectId), {
    points: [
      {
        id: "day:2026-09-01",
        date: "2026-09-01",
        observedAt: "2026-09-01T18:00:00.000Z",
        measuredKeywordCount: 4,
        positionedKeywordCount: 3,
        top1KeywordCount: 1,
        top3KeywordCount: 1,
        top5KeywordCount: 1,
        top10KeywordCount: 3,
        top30KeywordCount: 3,
        top50KeywordCount: 3
      },
      {
        id: "day:2026-09-02",
        date: "2026-09-02",
        observedAt: "2026-09-02T20:00:00.000Z",
        measuredKeywordCount: 4,
        positionedKeywordCount: 3,
        top1KeywordCount: 0,
        top3KeywordCount: 0,
        top5KeywordCount: 2,
        top10KeywordCount: 2,
        top30KeywordCount: 3,
        top50KeywordCount: 3
      }
    ],
    truncated: false
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? "", /ROW_NUMBER\(\) OVER/u);
  assert.match(queries[0]?.sql ?? "", /LAG\(found\) OVER/u);
  assert.match(queries[0]?.sql ?? "", /UNBOUNDED PRECEDING AND CURRENT ROW/u);
  assert.match(queries[0]?.sql ?? "", /snapshot\.keyword_id/u);
  assert.match(queries[0]?.sql ?? "", /keyword\.is_tracked = TRUE/u);
  assert.doesNotMatch(queries[0]?.sql ?? "", /tracking_contexts|context\.status/u);
  assert.equal(queries[0]?.values.includes(false), true);
});

test("can include active untracked keywords in project position history", async () => {
  let observedQuery: Prisma.Sql | undefined;
  const service = new KeywordService(
    {
      $queryRaw: async (query: Prisma.Sql) => {
        observedQuery = query;
        return [];
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  assert.deepEqual(
    await service.positionHistory(workspaceId, projectId, {
      includeUntracked: true
    }),
    { points: [], truncated: false }
  );
  assert.match(observedQuery?.sql ?? "", /position_tracking_enabled = TRUE/u);
  assert.equal(observedQuery?.values.includes(true), true);
});

test("reuses a persistent position-history projection until its source revision changes", async () => {
  let revision = 1n;
  let rawReads = 0;
  let projection: Readonly<{
    schemaVersion: string;
    sourceRevision: bigint;
    payload: unknown;
  }> | undefined;
  const service = new KeywordService({
    projectPositionHistoryRevision: {
      upsert: async () => ({ revision })
    },
    projectPositionHistoryProjection: {
      findUnique: async () => projection,
      upsert: async (input: {
        readonly create: {
          readonly schemaVersion: string;
          readonly sourceRevision: bigint;
          readonly payload: unknown;
        };
        readonly update: {
          readonly schemaVersion: string;
          readonly sourceRevision: bigint;
          readonly payload: unknown;
        };
      }) => {
        const stored = projection ? input.update : input.create;
        projection = {
          schemaVersion: stored.schemaVersion,
          sourceRevision: stored.sourceRevision,
          payload: stored.payload
        };
        return projection;
      }
    },
    $queryRaw: async () => {
      rawReads += 1;
      return [{
        dayKey: "2026-09-15",
        observedAt: new Date("2026-09-15T10:00:00.000Z"),
        measuredKeywordCount: BigInt(100 + rawReads),
        positionedKeywordCount: 80n,
        top1KeywordCount: 10n,
        top3KeywordCount: 20n,
        top5KeywordCount: 30n,
        top10KeywordCount: 40n,
        top30KeywordCount: 60n,
        top50KeywordCount: 80n
      }];
    }
  } as unknown as PrismaService, semanticVersions());

  const first = await service.positionHistory(workspaceId, projectId);
  const cached = await service.positionHistory(workspaceId, projectId);
  assert.equal(rawReads, 1);
  assert.deepEqual(cached, first);

  revision = 2n;
  const refreshed = await service.positionHistory(workspaceId, projectId);
  assert.equal(rawReads, 2);
  assert.equal(refreshed.points[0]?.measuredKeywordCount, 102);
  assert.equal(projection?.sourceRevision, 2n);
});

test("returns a scoped cursor page with groups, tags and target URLs", async () => {
  const snapshotId = "01900000-0000-7000-8000-000000000074";
  let observedWhere: unknown;
  let observedRankConfigurationWhere: unknown;
  const rows = [
    {
      ...keyword(
        "01900000-0000-7000-8000-000000000010",
        "2026-07-29T08:00:00Z"
      ),
      note: "Учитывать коммерческий интент в тексте страницы",
      _count: { memberships: 2 }
    },
    keyword("01900000-0000-7000-8000-000000000011", "2026-07-29T07:00:00Z")
  ];
  const service = new KeywordService({
    $queryRaw: async () => [{
      keywordId: "01900000-0000-7000-8000-000000000010",
      searchEngine: "YANDEX",
      observedAt: new Date("2026-08-01T10:00:00.000Z"),
      snapshotId,
      previousPosition: 8
    }],
    keyword: {
      findMany: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return rows;
      },
      count: async () => 2
    },
    page: {
      findMany: async () => [
        {
          id: "01900000-0000-7000-8000-000000000020",
          url: "https://example.com/seo"
        }
      ]
    },
    trackingContextKeywordAssignment: {
      findMany: async () => [
        {
          keywordId: "01900000-0000-7000-8000-000000000010"
        }
      ]
    },
    frequencySnapshot: {
      findMany: async () => [
        {
          keywordId: "01900000-0000-7000-8000-000000000010",
          type: "BASE",
          value: 12_890n,
          regionCode: "213",
          device: "ALL",
          provider: "XMLSTOCK",
          observedAt: new Date("2026-08-01T10:00:00.000Z")
        },
        {
          keywordId: "01900000-0000-7000-8000-000000000010",
          type: "EXACT",
          value: 5_123n,
          regionCode: "213",
          device: "ALL",
          provider: "ARSENKIN",
          observedAt: new Date("2026-08-01T10:00:00.000Z")
        },
        {
          keywordId: "01900000-0000-7000-8000-000000000010",
          type: "FIXED",
          value: 5_122n,
          regionCode: "213",
          device: "ALL",
          provider: "ARSENKIN",
          observedAt: new Date("2026-08-01T10:00:00.000Z")
        }
      ]
    },
    rankDimensionHistoryDeletion: { findMany: async () => [] },
    currentRank: {
      findMany: async () => [
        {
          keywordId: "01900000-0000-7000-8000-000000000010",
          trackingContextId: "01900000-0000-7000-8000-000000000070",
          configurationVersion: 1,
          found: true,
          position: 5,
          previousPosition: 8,
          rankingUrl: "https://example.com/seo",
          observedAt: new Date("2026-08-01T10:00:00.000Z"),
          snapshotId
        }
      ]
    },
    aiAnswerSnapshot: { findMany: async () => [] },
    rankSnapshot: {
      findMany: async () => [{
        id: snapshotId,
        manifest: { projectDomain: "example.com" },
        serpResults: [
          {
            position: 1,
            rankingUrl: "https://example.com/seo",
            normalizedRankingUrl: "https://example.com/seo",
            faviconUrl: "https://search-assets.example/project.png",
            title: "SEO аудит",
            snippet: "Главная страница услуги"
          },
          {
            position: 2,
            rankingUrl: "https://www.example.com/seo/second",
            normalizedRankingUrl: "https://www.example.com/seo/second",
            title: "Дополнительная страница",
            snippet: null
          },
          {
            position: 3,
            rankingUrl: "https://competitor.example/result",
            normalizedRankingUrl: "https://competitor.example/result"
          }
        ]
      }]
    },
    trackingContextVersion: {
      findMany: async ({ where }: { where: unknown }) => {
        observedRankConfigurationWhere = where;
        return [
          {
            contextId: "01900000-0000-7000-8000-000000000070",
            configurationVersion: 1,
            searchEngine: "YANDEX"
          }
        ];
      }
    }
  } as unknown as PrismaService, semanticVersions());

  const result = await service.list(
    workspaceId,
    projectId,
    { limit: 1, search: "SEO" },
    "request-1"
  );

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.groupPath, "Услуги / SEO");
  assert.equal(result.data[0]?.groupMembershipCount, 2);
  assert.equal(result.data[0]?.targetUrl, "https://example.com/seo");
  assert.deepEqual(result.data[0]?.tags, ["Приоритет"]);
  assert.equal(result.data[0]?.hasNote, true);
  assert.equal(result.data[0]?.note, undefined);
  assert.equal(result.data[0]?.isTracked, false);
  assert.equal(result.data[0]?.frequency?.value, "12890");
  assert.deepEqual(result.data[0]?.frequency, {
    value: "12890",
    regionCode: "213",
    device: "ALL",
    provider: "XMLSTOCK",
    observedAt: "2026-08-01T10:00:00.000Z"
  });
  assert.deepEqual(
    result.data[0]?.frequencies?.map(({ type, value }) => ({ type, value })),
    [
      { type: "BASE", value: "12890" },
      { type: "EXACT", value: "5123" },
      { type: "FIXED", value: "5122" }
    ]
  );
  assert.deepEqual(result.data[0]?.positions, [
    {
      searchEngine: "YANDEX",
      found: true,
      position: 5,
      previousPosition: 8,
      rankingUrl: "https://example.com/seo",
      siteResults: [
        {
          position: 1,
          rankingUrl: "https://example.com/seo",
          faviconUrl: "https://search-assets.example/project.png",
          title: "SEO аудит",
          snippet: "Главная страница услуги"
        },
        {
          position: 2,
          rankingUrl: "https://www.example.com/seo/second",
          title: "Дополнительная страница"
        }
      ],
      observedAt: "2026-08-01T10:00:00.000Z"
    }
  ]);
  assert.equal(
    (observedRankConfigurationWhere as { context?: unknown }).context,
    undefined
  );
  assert.equal(result.page.hasNext, true);
  assert.equal(result.page.totalApprox, 2);
  assert.ok(result.page.nextCursor);
  assert.ok(observedWhere);

  const resultWithNotes = await service.list(
    workspaceId,
    projectId,
    { limit: 1, search: "SEO", includeNotes: true },
    "request-with-notes"
  );
  assert.equal(
    resultWithNotes.data[0]?.note,
    "Учитывать коммерческий интент в тексте страницы"
  );

  await assert.rejects(
    () =>
      service.list(
        workspaceId,
        projectId,
        {
          limit: 1,
          cursor: result.page.nextCursor!,
          search: "another query"
        },
        "request-2"
      ),
    BadRequestException
  );
});

test("hydrates every selectable keyword page size in bounded Prisma batches", async () => {
  const rows = Array.from({ length: 1_001 }, (_, index) => ({
    ...keyword(
      `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
      "2026-07-29T08:00:00Z"
    ),
    targetPageId: null,
    typedCustomValues: [],
    _count: { memberships: 1 }
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [limit, expectedBatches] of [
    [100, [100]],
    [200, [200]],
    [500, [250, 250]],
    [1_000, [250, 250, 250, 250]]
  ] as const) {
    const hydrationBatchSizes: number[] = [];
    const service = new KeywordService({
      keyword: {
        findMany: async (input: {
          readonly select?: { readonly id?: boolean };
          readonly where?: { readonly id?: { readonly in?: readonly string[] } };
        }) => {
          if (input.select?.id) return rows.map(({ id }) => ({ id }));
          const ids = input.where?.id?.in ?? [];
          hydrationBatchSizes.push(ids.length);
          return ids.flatMap((id) => {
            const row = byId.get(id);
            return row ? [row] : [];
          });
        },
        count: async () => rows.length
      },
      keywordMerge: { findMany: async () => [] },
      page: { findMany: async () => [] },
      cluster: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] },
      keywordGroupMembership: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      trackingContextVersion: { findMany: async () => [] },
      rankSnapshot: { findMany: async () => [] }
    } as unknown as PrismaService, semanticVersions());

    const result = await service.list(
      workspaceId,
      projectId,
      { limit, sort: "CREATED_ASC" },
      `request-page-${limit}`
    );

    assert.equal(result.data.length, limit);
    assert.equal(result.page.hasNext, true);
    assert.deepEqual(hydrationBatchSizes, expectedBatches);
  }
});

test("returns a lightweight ten-thousand-keyword operation scope page", async () => {
  const rows = Array.from({ length: 10_001 }, (_, index) => ({
    id: `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
    version: index + 1,
    isTracked: index % 2 === 0
  }));
  const findManyInputs: unknown[] = [];
  const service = new KeywordService({
    keyword: {
      findMany: async (input: unknown) => {
        findManyInputs.push(input);
        return rows;
      },
      count: async () => 161_624
    }
  } as unknown as PrismaService, semanticVersions());

  const result = await service.operationScope(
    workspaceId,
    projectId,
    {},
    "request-operation-scope"
  );

  assert.equal(result.data.length, 10_000);
  assert.equal(result.page.hasNext, true);
  assert.equal(result.page.nextCursor, rows[9_999]!.id);
  assert.equal(result.page.totalApprox, 161_624);
  assert.equal(findManyInputs.length, 1);
  assert.deepEqual(
    (findManyInputs[0] as { readonly select: unknown }).select,
    { id: true, version: true, isTracked: true }
  );
});

test("keeps position deltas across tracking contexts", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000014";
  const latestContextId = "01900000-0000-7000-8000-000000000075";
  const previousContextId = "01900000-0000-7000-8000-000000000076";
  const latestSnapshotId = "01900000-0000-7000-8000-000000000077";
  const previousSnapshotId = "01900000-0000-7000-8000-000000000078";
  const rawQueries: Prisma.Sql[] = [];
  const service = new KeywordService(
    {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = Prisma.sql(strings, ...values);
        rawQueries.push(query);
        return [{
          keywordId,
          searchEngine: "YANDEX",
          observedAt: new Date("2026-08-18T10:00:00.000Z"),
          snapshotId: latestSnapshotId,
          previousPosition: 6
        }];
      },
      keyword: {
        findMany: async () => [{
          ...keyword(keywordId, "2026-08-18T10:00:00.000Z"),
          targetPageId: null,
          typedCustomValues: []
        }],
        count: async () => 1
      },
      trackingContextKeywordAssignment: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      currentRank: {
        findMany: async () => [
          {
            keywordId,
            trackingContextId: latestContextId,
            configurationVersion: 1,
            found: true,
            position: 2,
            previousPosition: null,
            rankingUrl: "https://example.com/latest",
            observedAt: new Date("2026-08-18T10:00:00.000Z"),
            snapshotId: latestSnapshotId
          },
          {
            keywordId,
            trackingContextId: previousContextId,
            configurationVersion: 1,
            found: true,
            position: 6,
            previousPosition: null,
            rankingUrl: "https://example.com/previous",
            observedAt: new Date("2026-08-17T10:00:00.000Z"),
            snapshotId: previousSnapshotId
          }
        ]
      },
      aiAnswerSnapshot: { findMany: async () => [] },
      rankSnapshot: { findMany: async () => [] },
      trackingContextVersion: {
        findMany: async () => [
          {
            contextId: latestContextId,
            configurationVersion: 1,
            searchEngine: "YANDEX"
          },
          {
            contextId: previousContextId,
            configurationVersion: 1,
            searchEngine: "YANDEX"
          }
        ]
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.list(
    workspaceId,
    projectId,
    { limit: 100 },
    "request-cross-context-delta"
  );

  assert.deepEqual(result.data[0]?.positions, [{
    searchEngine: "YANDEX",
    found: true,
    position: 2,
    previousPosition: 6,
    rankingUrl: "https://example.com/latest",
    observedAt: "2026-08-18T10:00:00.000Z"
  }]);
  assert.equal(rawQueries.length, 1);
  assert.match(rawQueries[0]?.sql ?? "", /FROM rank_snapshots snapshot/u);
  assert.match(
    rawQueries[0]?.sql ?? "",
    /configuration\.search_engine = current_configuration\.search_engine/u
  );
  assert.match(
    rawQueries[0]?.sql ?? "",
    /previous ON previous\.found = TRUE AND previous\.position IS NOT NULL/u
  );
  assert.match(
    rawQueries[0]?.sql ?? "",
    /\(snapshot\.observed_at, snapshot\.id\) </u
  );
});

test("projects AI position changes across collection contexts", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000018";
  const snapshotId = "01900000-0000-7000-8000-000000000019";
  const rawQueries: Prisma.Sql[] = [];
  let latestQueryWhere: Readonly<Record<string, unknown>> | undefined;
  const service = new KeywordService(
    {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = Prisma.sql(strings, ...values);
        rawQueries.push(query);
        return [{
          keywordId,
          searchEngine: "YANDEX",
          observedAt: new Date("2026-08-19T14:00:00.000Z"),
          snapshotId,
          previousPosition: 9
        }];
      },
      keyword: {
        findMany: async () => [{
          ...keyword(keywordId, "2026-08-19T14:00:00.000Z"),
          targetPageId: null,
          typedCustomValues: []
        }],
        count: async () => 1
      },
      trackingContextKeywordAssignment: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: {
        findMany: async ({ where }: {
          where: Readonly<Record<string, unknown>>;
        }) => {
          latestQueryWhere = where;
          return [{
            id: snapshotId,
            keywordId,
            searchEngine: "YANDEX",
            answerPresent: true,
            siteFound: true,
            position: 4,
            rankingUrl: "https://example.com/ai",
            brandFound: true,
            observedAt: new Date("2026-08-19T14:00:00.000Z")
          }];
        }
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.list(
    workspaceId,
    projectId,
    { limit: 100 },
    "request-ai-cross-context-delta"
  );

  assert.deepEqual(result.data[0]?.aiAnswers, [{
    searchEngine: "YANDEX",
    answerPresent: true,
    siteFound: true,
    position: 4,
    previousPosition: 9,
    rankingUrl: "https://example.com/ai",
    brandFound: true,
    observedAt: "2026-08-19T14:00:00.000Z"
  }]);
  assert.equal(rawQueries.length, 1);
  assert.match(rawQueries[0]?.sql ?? "", /FROM ai_answer_snapshots snapshot/u);
  assert.match(
    rawQueries[0]?.sql ?? "",
    /previous ON previous\.site_found = TRUE AND previous\.position IS NOT NULL/u
  );
  assert.equal(latestQueryWhere?.positionTrackingEnabled, true);
});

test("projects every SEO SERP slice and keeps competitor evidence out of position history", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000012";
  const contextId = "01900000-0000-7000-8000-000000000072";
  const mobileContextId = "01900000-0000-7000-8000-000000000074";
  const service = new KeywordService(
    {
      keyword: {
        findFirst: async () => ({
          id: keywordId,
          note: null,
          memberships: [
            {
              group: {
                id: "01900000-0000-7000-8000-000000000076",
                name: "Статьи",
                path: "Контент / Статьи",
                color: "#6758ef",
                systemKind: null
              }
            },
            {
              group: {
                id: "01900000-0000-7000-8000-000000000077",
                name: "Съем",
                path: "Съем",
                color: "#ff0000",
                systemKind: null
              }
            }
          ]
        })
      },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      frequencySeasonalityPoint: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] },
      rankSnapshot: {
        findMany: async () => [
          {
            id: "01900000-0000-7000-8000-000000000073",
            trackingContextId: contextId,
            configurationVersion: 2,
            provider: "XMLSTOCK",
            positionTrackingEnabled: false,
            found: false,
            position: null,
            observedAt: new Date("2026-08-06T11:45:00.000Z"),
            manifest: {
              projectDomain: "example.com",
              execution: {
                providerMappingVersion: "xmlstock-yandex-live@2"
              }
            }
          },
          {
            id: "01900000-0000-7000-8000-000000000075",
            trackingContextId: mobileContextId,
            configurationVersion: 1,
            provider: "XMLSTOCK",
            positionTrackingEnabled: false,
            found: false,
            position: null,
            observedAt: new Date("2026-08-05T11:45:00.000Z"),
            manifest: {
              projectDomain: "example.com",
              execution: {
                providerMappingVersion: "xmlstock-yandex-live@2"
              }
            }
          }
        ]
      },
      rankSerpResult: {
        findMany: async () => [
          {
            snapshotId: "01900000-0000-7000-8000-000000000073",
            position: 1,
            rankingUrl: "https://competitor.example/one",
            faviconUrl: "https://search-assets.example/competitor.png",
            title: "Конкурент",
            snippet: null
          },
          {
            snapshotId: "01900000-0000-7000-8000-000000000073",
            position: 2,
            rankingUrl: "https://example.com/result",
            title: null,
            snippet: null
          },
          {
            snapshotId: "01900000-0000-7000-8000-000000000075",
            position: 1,
            rankingUrl: "https://mobile-competitor.example/result",
            title: "Мобильный конкурент",
            snippet: "Санкт-Петербург"
          }
        ]
      },
      trackingContext: {
        findMany: async () => [
          { id: contextId, name: "Яндекс · Москва" },
          { id: mobileContextId, name: "Яндекс · Санкт-Петербург" }
        ]
      },
      trackingContextVersion: {
        findMany: async () => [
          {
            contextId,
            configurationVersion: 2,
            searchEngine: "YANDEX",
            device: "DESKTOP",
            regionCode: "213",
            regionLabel: "Москва",
            countryCode: "RU",
            language: "ru",
            depth: 50
          },
          {
            contextId: mobileContextId,
            configurationVersion: 1,
            searchEngine: "YANDEX",
            device: "MOBILE",
            regionCode: "2",
            regionLabel: "Санкт-Петербург",
            countryCode: "RU",
            language: "ru",
            depth: 50
          }
        ]
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.insights(workspaceId, projectId, keywordId);

  assert.deepEqual(result.groups, [
    {
      id: "01900000-0000-7000-8000-000000000076",
      name: "Статьи",
      path: "Контент / Статьи",
      color: "#6758ef"
    },
    {
      id: "01900000-0000-7000-8000-000000000077",
      name: "Съем",
      path: "Съем",
      color: "#ff0000"
    }
  ]);
  assert.deepEqual(result.positionHistory, []);
  assert.deepEqual(result.competitorSnapshots, [
    {
      snapshotId: "01900000-0000-7000-8000-000000000073",
      trackingContextId: contextId,
      contextName: "Яндекс · Москва",
      searchEngine: "YANDEX",
      countryCode: "RU",
      regionCode: "213",
      regionLabel: "Москва",
      language: "ru",
      device: "DESKTOP",
      dimensionKey: "YANDEX|RU|213|ru|DESKTOP",
      searchSource: "LIVE",
      provider: "XMLSTOCK",
      observedAt: "2026-08-06T11:45:00.000Z",
      results: [
        {
          position: 1,
          url: "https://competitor.example/one",
          faviconUrl: "https://search-assets.example/competitor.png",
          title: "Конкурент"
        },
        { position: 2, url: "https://example.com/result" }
      ]
    },
    {
      snapshotId: "01900000-0000-7000-8000-000000000075",
      trackingContextId: mobileContextId,
      contextName: "Яндекс · Санкт-Петербург",
      searchEngine: "YANDEX",
      countryCode: "RU",
      regionCode: "2",
      regionLabel: "Санкт-Петербург",
      language: "ru",
      device: "MOBILE",
      dimensionKey: "YANDEX|RU|2|ru|MOBILE",
      searchSource: "LIVE",
      provider: "XMLSTOCK",
      observedAt: "2026-08-05T11:45:00.000Z",
      results: [{
        position: 1,
        url: "https://mobile-competitor.example/result",
        title: "Мобильный конкурент",
        snippet: "Санкт-Петербург"
      }]
    }
  ]);
});

test("dimension insights keep project URLs below TOP-10", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000012";
  const mergedSourceId = "01900000-0000-7000-8000-000000000013";
  const contextId = "01900000-0000-7000-8000-000000000072";
  const snapshotId = "01900000-0000-7000-8000-000000000073";
  let serpWhere: Record<string, unknown> | undefined;
  let rankWhere: Record<string, unknown> | undefined;
  const service = new KeywordService(
    {
      keyword: {
        findFirst: async () => ({ id: keywordId, note: null, memberships: [] })
      },
      keywordMerge: {
        findMany: async () => [{ sourceKeywordId: mergedSourceId }]
      },
      rankDimensionMerge: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      frequencySeasonalityPoint: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] },
      rankSnapshot: {
        findMany: async (input: { where: Record<string, unknown> }) => {
          rankWhere = input.where;
          return [{
          id: snapshotId,
          keywordId: mergedSourceId,
          trackingContextId: contextId,
          configurationVersion: 1,
          provider: "XMLSTOCK",
          positionTrackingEnabled: true,
          found: true,
          position: 1,
          observedAt: new Date("2026-09-08T13:08:00.000Z"),
          manifest: {
            projectDomain: "example.com",
            execution: { providerMappingVersion: "xmlstock-google@1" }
          }
          }];
        }
      },
      rankSerpResult: {
        findMany: async (input: { where: Record<string, unknown> }) => {
          serpWhere = input.where;
          return [
            { snapshotId, position: 1, rankingUrl: "https://example.com/first", faviconUrl: null, title: "Первый URL", snippet: null },
            { snapshotId, position: 43, rankingUrl: "https://example.com/second", faviconUrl: null, title: "Второй URL", snippet: null }
          ];
        }
      },
      trackingContext: {
        findMany: async () => [{ id: contextId, name: "Google · Москва" }]
      },
      trackingContextVersion: {
        findMany: async () => [{
          contextId,
          configurationVersion: 1,
          searchEngine: "GOOGLE",
          device: "DESKTOP",
          regionCode: "213",
          regionLabel: "Москва",
          countryCode: "RU",
          language: "ru",
          depth: 50
        }]
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.insights(
    workspaceId,
    projectId,
    keywordId,
    "GOOGLE|RU|213|ru|DESKTOP",
    snapshotId
  );

  assert.equal(rankWhere?.id, snapshotId);
  assert.deepEqual(rankWhere?.keywordId, {
    in: [keywordId, mergedSourceId]
  });
  assert.equal(Object.hasOwn(serpWhere ?? {}, "position"), false);
  assert.deepEqual(
    (result.competitorSnapshots ?? [])[0]?.results.map(({ position }) => position),
    [1, 43]
  );
});

test("serializes a small seasonality share without exponent notation", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000074";
  const jobId = "01900000-0000-7000-8000-000000000075";
  const service = new KeywordService(
    {
      keyword: {
        findFirst: async () => ({ id: keywordId, note: null })
      },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      frequencySeasonalityPoint: {
        findMany: async () => [{
          id: "01900000-0000-7000-8000-000000000076",
          type: "BASE",
          granularity: "MONTH",
          periodStart: new Date("2026-08-01T00:00:00.000Z"),
          value: 3n,
          share: new Prisma.Decimal("0.000000257707063906"),
          regionCode: "213",
          device: "ALL",
          provider: "XMLSTOCK",
          sourceMode: "BYOK",
          jobId,
          observedAt: new Date("2026-09-09T19:18:16.790Z")
        }]
      },
      currentRank: { findMany: async () => [] },
      rankSnapshot: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.insights(workspaceId, projectId, keywordId);

  assert.deepEqual(result.seasonality, [{
    type: "BASE",
    granularity: "MONTH",
    periodStart: "2026-08-01",
    value: "3",
    share: "0.000000257707063906",
    regionCode: "213",
    device: "ALL",
    provider: "XMLSTOCK",
    sourceMode: "BYOK",
    jobId,
    observedAt: "2026-09-09T19:18:16.790Z"
  }]);
});

test("projects immutable AI history and latest source competitors into insights", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000021";
  const snapshotId = "01900000-0000-7000-8000-000000000022";
  const observedAt = new Date("2026-08-19T15:00:00.000Z");
  const historyRow = {
    id: snapshotId,
    keywordId,
    searchEngine: "YANDEX",
    regionCode: "213",
    device: "DESKTOP",
    answerPresent: true,
    siteFound: true,
    position: 2,
    rankingUrl: "https://example.com/answer",
    brandFound: true,
    sources: [],
    observedAt
  };
  const aiQueries: Readonly<Record<string, unknown>>[] = [];
  const aiTakes: Array<number | undefined> = [];
  const service = new KeywordService(
    {
      keyword: { findFirst: async () => ({ id: keywordId, note: null }) },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      frequencySeasonalityPoint: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      rankSnapshot: { findMany: async () => [] },
      aiAnswerSnapshot: {
        findMany: async ({
          where,
          take
        }: {
          where: Readonly<Record<string, unknown>>;
          take?: number;
        }) => {
          aiQueries.push(where);
          aiTakes.push(take);
          return !("positionTrackingEnabled" in where)
            ? [{
                id: snapshotId,
                searchEngine: "YANDEX",
                regionCode: "213",
                device: "DESKTOP",
                observedAt,
                sources: [{
                  position: 1,
                  url: "https://competitor.example/source",
                  title: "Источник",
                  description: "Описание"
                }]
              }]
            : [historyRow];
        }
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.insights(workspaceId, projectId, keywordId);

  assert.deepEqual(result.aiPositionHistory, [{
    snapshotId,
    keywordId,
    searchEngine: "YANDEX",
    regionCode: "213",
    device: "DESKTOP",
    answerPresent: true,
    siteFound: true,
    position: 2,
    rankingUrl: "https://example.com/answer",
    brandFound: true,
    provider: "ARSENKIN",
    results: [],
    observedAt: "2026-08-19T15:00:00.000Z"
  }]);
  assert.deepEqual(result.aiCompetitorSnapshots, [{
    snapshotId,
    searchEngine: "YANDEX",
    regionCode: "213",
    device: "DESKTOP",
    provider: "ARSENKIN",
    observedAt: "2026-08-19T15:00:00.000Z",
    results: [{
      position: 1,
      url: "https://competitor.example/source",
      title: "Источник",
      snippet: "Описание"
    }]
  }]);
  assert.equal(aiQueries[0]?.positionTrackingEnabled, true);
  assert.equal("positionTrackingEnabled" in (aiQueries[1] ?? {}), false);
  assert.deepEqual(aiTakes, [240, 240]);
});

test("deletes only one tenant-scoped keyword frequency context", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000089";
  let deletedWhere: unknown;
  const service = new KeywordService(
    {
      keyword: {
        findFirst: async () => ({ id: keywordId })
      },
      frequencySnapshot: {
        deleteMany: async ({ where }: { where: unknown }) => {
          deletedWhere = where;
          return { count: 3 };
        }
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  await service.deleteFrequencyContext(
    workspaceId,
    projectId,
    keywordId,
    "EXACT",
    "213",
    "MOBILE"
  );

  assert.deepEqual(deletedWhere, {
    workspaceId,
    projectId,
    keywordId,
    type: "EXACT",
    regionCode: "213",
    device: "MOBILE"
  });
});

test("does not delete frequency contexts for an unavailable keyword", async () => {
  let deleteCalls = 0;
  const service = new KeywordService(
    {
      keyword: { findFirst: async () => null },
      frequencySnapshot: {
        deleteMany: async () => {
          deleteCalls += 1;
          return { count: 0 };
        }
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  await assert.rejects(
    () => service.deleteFrequencyContext(
      workspaceId,
      projectId,
      "01900000-0000-7000-8000-000000000089",
      "BASE",
      "213",
      "ALL"
    ),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === HttpStatus.NOT_FOUND
  );
  assert.equal(deleteCalls, 0);
});

test("keeps every configured dimension of a reused context in keyword insights", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000015";
  const contextId = "01900000-0000-7000-8000-000000000079";
  const snapshotId = "01900000-0000-7000-8000-000000000080";
  const newerSnapshotId = "01900000-0000-7000-8000-000000000081";
  const rankSnapshotWheres: unknown[] = [];
  let contextWhere: unknown;
  const service = new KeywordService(
    {
      $queryRaw: async () => [{
        keywordId,
        searchEngine: "YANDEX",
        observedAt: new Date("2026-08-18T12:00:00.000Z"),
        snapshotId,
        previousPosition: 11
      }],
      keyword: {
        findFirst: async () => ({ id: keywordId, note: null })
      },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      frequencySeasonalityPoint: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: {
        findMany: async () => [
          {
            workspaceId,
            projectId,
            keywordId,
            trackingContextId: contextId,
            configurationVersion: 2,
            found: true,
            position: 12,
            previousPosition: null,
            rankingUrl: "https://example.com/spb",
            observedAt: new Date("2026-08-19T12:00:00.000Z"),
            snapshotId: newerSnapshotId
          },
          {
            workspaceId,
            projectId,
            keywordId,
            trackingContextId: contextId,
            configurationVersion: 1,
            found: true,
            position: 7,
            previousPosition: null,
            rankingUrl: "https://example.com/current",
            observedAt: new Date("2026-08-18T12:00:00.000Z"),
            snapshotId
          }
        ]
      },
      aiAnswerSnapshot: { findMany: async () => [] },
      rankSnapshot: {
        findMany: async ({ where }: { where: unknown }) => {
          rankSnapshotWheres.push(where);
          return [];
        }
      },
      trackingContext: {
        findMany: async ({ where }: { where: unknown }) => {
          contextWhere = where;
          return [{ id: contextId, name: "Новый профиль" }];
        }
      },
      trackingContextVersion: {
        findMany: async () => [
          {
            contextId,
            configurationVersion: 1,
            searchEngine: "YANDEX",
            device: "DESKTOP",
            regionCode: "213",
            regionLabel: "Москва",
            countryCode: "RU",
            language: "ru",
            depth: 50
          },
          {
            contextId,
            configurationVersion: 2,
            searchEngine: "YANDEX",
            device: "DESKTOP",
            regionCode: "2",
            regionLabel: "Санкт-Петербург",
            countryCode: "RU",
            language: "ru",
            depth: 50
          }
        ]
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.insights(workspaceId, projectId, keywordId);

  assert.deepEqual(result.positions, [
    {
      trackingContextId: contextId,
      contextName: "Новый профиль",
      searchEngine: "YANDEX",
      countryCode: "RU",
      device: "DESKTOP",
      regionCode: "2",
      regionLabel: "Санкт-Петербург",
      language: "ru",
      dimensionKey: "YANDEX|RU|2|ru|DESKTOP",
      found: true,
      position: 12,
      rankingUrl: "https://example.com/spb",
      observedAt: "2026-08-19T12:00:00.000Z"
    },
    {
      trackingContextId: contextId,
      contextName: "Новый профиль",
      searchEngine: "YANDEX",
      countryCode: "RU",
      device: "DESKTOP",
      regionCode: "213",
      regionLabel: "Москва",
      language: "ru",
      dimensionKey: "YANDEX|RU|213|ru|DESKTOP",
      found: true,
      position: 7,
      previousPosition: 11,
      rankingUrl: "https://example.com/current",
      observedAt: "2026-08-18T12:00:00.000Z"
    }
  ]);
  assert.equal((contextWhere as { status?: unknown }).status, undefined);
  assert.equal(
    rankSnapshotWheres.some((where) =>
      Boolean((where as { manifest?: { context?: unknown } }).manifest?.context)
    ),
    false
  );
});

test("filters a keyword page by the union of selected groups", async () => {
  const firstGroupId = "01900000-0000-7000-8000-000000000091";
  const secondGroupId = "01900000-0000-7000-8000-000000000092";
  let observedWhere: unknown;
  const service = new KeywordService(
    {
      keyword: {
        findMany: async ({ where }: { where: unknown }) => {
          observedWhere = where;
          return [];
        },
        count: async () => 0
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.list(
    workspaceId,
    projectId,
    { limit: 100, groupIds: [firstGroupId, secondGroupId] },
    "request-multi-group"
  );

  assert.deepEqual(
    (observedWhere as {
      memberships?: { some?: { groupId?: unknown } };
    }).memberships?.some?.groupId,
    { in: [firstGroupId, secondGroupId] }
  );
  assert.equal(result.data.length, 0);
  assert.equal(result.page.totalApprox, 0);
});

test("applies latest frequency, word count, URL and exact geographic rank filters before pagination", async () => {
  const queries: string[] = [];
  const service = new KeywordService({
    $queryRaw: async (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      const sql = taggedSqlText(strings, values);
      queries.push(sql);
      return /count\s*\(\s*\*\s*\)/iu.test(sql) ? [{ count: 0n }] : [];
    },
    keyword: { findMany: async () => { throw new Error("No IDs should be hydrated"); } }
  } as unknown as PrismaService, semanticVersions());
  const result = await service.list(workspaceId, projectId, {
    limit: 100,
    frequencyBaseMin: "100",
    frequencyExactMax: "1000",
    wordCountMin: 2,
    wordCountMax: 5,
    targetUrlState: "SET",
    rankDimensionKey: "GOOGLE|RU|1011969|ru|MOBILE",
    rankState: "FOUND",
    rankPositionMin: 1,
    rankPositionMax: 10,
    rankCheckedFrom: "2026-09-01T00:00:00.000Z",
    rankCheckedBefore: "2026-09-09T00:00:00.000Z"
  }, "advanced-filter");
  assert.equal(result.page.totalApprox, 0);
  assert.equal(queries.length, 2);
  for (const sql of queries) {
    assert.match(sql, /frequency_snapshots/u);
    assert.match(sql, /regexp_split_to_array/u);
    assert.match(sql, /target_page_id IS NOT NULL/u);
    assert.match(sql, /current_ranks/u);
    assert.match(sql, /tracking_context_versions/u);
  }
});

test("projects a shared canonical keyword through the currently opened group", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000093";
  const sourceGroupId = "01900000-0000-7000-8000-000000000094";
  const openedGroupId = "01900000-0000-7000-8000-000000000095";
  const row = {
    ...keyword(keywordId, "2026-08-08T10:00:00Z"),
    targetPageId: null,
    typedCustomValues: [],
    memberships: [
      {
        group: {
          id: sourceGroupId,
          path: "Первая папка",
          name: "Первая папка",
          systemKind: null
        }
      }
    ]
  };
  const service = new KeywordService(
    {
      keywordGroup: {
        findFirst: async () => ({ systemKind: null })
      },
      keyword: {
        findMany: async () => [row],
        count: async () => 1
      },
      trackingContextKeywordAssignment: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] },
      keywordGroupMembership: {
        findMany: async () => [
          {
            keywordId,
            group: {
              id: openedGroupId,
              path: "Вторая папка",
              name: "Вторая папка"
            }
          }
        ]
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.list(
    workspaceId,
    projectId,
    { limit: 100, groupId: openedGroupId },
    "request-shared-keyword"
  );

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.id, keywordId);
  assert.equal(result.data[0]?.groupId, openedGroupId);
  assert.equal(result.data[0]?.groupPath, "Вторая папка");
});

test("projects imported Key Collector positions without poisoning keyword insights", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000082";
  const contextId = "01900000-0000-7000-8000-000000000083";
  const service = new KeywordService(
    {
      keyword: {
        findFirst: async () => ({ id: keywordId, note: null })
      },
      rankDimensionMerge: {
        findMany: async () => [{
          sourceDimensionKey: "YANDEX|RU|global|ru|DESKTOP",
          targetDimensionKey: "YANDEX|RU|213|ru|DESKTOP",
          targetRegionLabel: "Москва"
        }]
      },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      frequencySeasonalityPoint: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] },
      rankSnapshot: {
        findMany: async () => [{
          id: "01900000-0000-7000-8000-000000000084",
          trackingContextId: contextId,
          configurationVersion: 1,
          provider: "KEY_COLLECTOR",
          positionTrackingEnabled: true,
          found: true,
          position: 34,
          observedAt: new Date("2026-08-07T14:00:00.000Z"),
          manifest: {
            execution: { source: "KC4", searchEngine: "YANDEX" }
          }
        }]
      },
      rankSerpResult: { findMany: async () => [] },
      trackingContext: {
        findMany: async () => [{
          id: contextId,
          name: "Импорт Key Collector · Яндекс"
        }]
      },
      trackingContextVersion: {
        findMany: async () => [{
          contextId,
          configurationVersion: 1,
          searchEngine: "YANDEX",
          device: "DESKTOP",
          regionCode: "global",
          regionLabel: "Импорт Key Collector",
          countryCode: "RU",
          language: "ru",
          depth: 100
        }]
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.insights(workspaceId, projectId, keywordId);

  assert.deepEqual(result.positionHistory, [{
    snapshotId: "01900000-0000-7000-8000-000000000084",
    trackingContextId: contextId,
    contextName: "Импорт Key Collector · Яндекс",
    searchEngine: "YANDEX",
    device: "DESKTOP",
    regionCode: "213",
    regionLabel: "Москва",
    countryCode: "RU",
    language: "ru",
    dimensionKey: "YANDEX|RU|213|ru|DESKTOP",
    depth: 100,
    provider: "KEY_COLLECTOR",
    found: true,
    position: 34,
    observedAt: "2026-08-07T14:00:00.000Z"
  }]);
});

function taggedSqlText(strings: TemplateStringsArray, values: readonly unknown[]): string {
  return strings.reduce((result, part, index) => `${result}${part}${sqlFragmentText(values[index])}`, "");
}

function sqlFragmentText(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "");
  if ("sql" in value && typeof value.sql === "string") return value.sql;
  return "";
}

test("orders source sorting on the server before cursor pagination", async () => {
  let observedOrderBy: unknown;
  const service = new KeywordService(
    {
      keyword: {
        findMany: async ({ orderBy }: { orderBy: unknown }) => {
          observedOrderBy = orderBy;
          return [];
        },
        count: async () => 0
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.list(
    workspaceId,
    projectId,
    { limit: 100, sort: "SOURCE_DESC" },
    "request-source-sort"
  );

  assert.deepEqual(observedOrderBy, [
    { sourceMode: "desc" },
    { id: "desc" }
  ]);
  assert.equal(result.page.hasNext, false);
  assert.equal(result.page.totalApprox, 0);
});

test("filters tags case-insensitively through their normalized names", async () => {
  let observedWhere: unknown;
  const service = new KeywordService(
    {
      keyword: {
        findMany: async ({ where }: { where: unknown }) => {
          observedWhere = where;
          return [];
        },
        count: async () => 0
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  await service.list(
    workspaceId,
    projectId,
    { limit: 100, tag: "  ПРОМО  " },
    "request-tag-filter"
  );

  assert.deepEqual(
    (observedWhere as {
      tags?: {
        some?: { tag?: { normalizedName?: unknown } };
      };
    }).tags?.some?.tag?.normalizedName,
    { contains: "промо" }
  );
});

test("returns project tag options using a normalized substring", async () => {
  let observedWhere: unknown;
  const service = new KeywordService(
    {
      tag: {
        findMany: async ({ where }: { where: unknown }) => {
          observedWhere = where;
          return [{ name: "Бренд" }, { name: "брендовый" }];
        }
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  assert.deepEqual(
    await service.tagOptions(workspaceId, projectId, "  БРЕНД  "),
    ["Бренд", "брендовый"]
  );
  assert.deepEqual(
    (observedWhere as { normalizedName?: unknown }).normalizedName,
    { contains: "бренд" }
  );
});

test("sorts tags by the first normalized active tag on the server", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000013";
  const rawQueries: Prisma.Sql[] = [];
  const service = new KeywordService(
    {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        rawQueries.push(Prisma.sql(strings, ...values));
        return [{ id: keywordId, sort_value: "бренд" }];
      },
      keyword: {
        findMany: async () => [{
          ...keyword(keywordId, "2026-08-01T09:00:00.000Z"),
          targetPageId: null,
          typedCustomValues: []
        }],
        count: async () => 1
      },
      trackingContextKeywordAssignment: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const result = await service.list(
    workspaceId,
    projectId,
    { limit: 100, sort: "TAGS_ASC", tag: "БРЕНД" },
    "request-tag-sort"
  );

  assert.equal(result.data[0]?.id, keywordId);
  assert.match(rawQueries[0]?.sql ?? "", /MIN\(t\.normalized_name\)/u);
  assert.match(
    rawQueries[0]?.sql ?? "",
    /strpos\(filter_tag\.normalized_name,/u
  );
  assert.match(
    rawQueries[0]?.sql ?? "",
    /ORDER BY ranked\.sort_value ASC, ranked\.id ASC/u
  );
  assert.ok(rawQueries[0]?.values.includes("бренд"));
});

test("sorts engine positions in four stable capture-state buckets", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000012";
  const latestContextId = "01900000-0000-7000-8000-000000000072";
  const previousContextId = "01900000-0000-7000-8000-000000000071";
  const latestSnapshotId = "01900000-0000-7000-8000-000000000074";
  const previousSnapshotId = "01900000-0000-7000-8000-000000000073";
  const rawQueries: Prisma.Sql[] = [];
  let observedRankOrderBy: unknown;
  const service = new KeywordService(
    {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = Prisma.sql(strings, ...values);
        rawQueries.push(query);
        if (query.sql.includes("jsonb_to_recordset")) {
          return [{
            keywordId,
            searchEngine: "YANDEX",
            observedAt: new Date("2026-08-05T10:00:00.000Z"),
            snapshotId: latestSnapshotId,
            previousPosition: 13
          }];
        }
        return [{ id: keywordId, sort_value: 9_223_372_036_854_775_807n }];
      },
      keyword: {
        findMany: async () => [
          {
            ...keyword(keywordId, "2026-08-01T09:00:00.000Z"),
            targetPageId: null,
            typedCustomValues: []
          }
        ],
        count: async () => 1
      },
      trackingContextKeywordAssignment: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      currentRank: {
        findMany: async ({ orderBy }: { orderBy: unknown }) => {
          observedRankOrderBy = orderBy;
          return [
            {
              keywordId,
              trackingContextId: latestContextId,
              configurationVersion: 1,
              found: false,
              position: null,
              previousPosition: null,
              rankingUrl: null,
              observedAt: new Date("2026-08-05T10:00:00.000Z"),
              snapshotId: latestSnapshotId
            },
            {
              keywordId,
              trackingContextId: previousContextId,
              configurationVersion: 1,
              found: true,
              position: 13,
              previousPosition: null,
              rankingUrl: "https://example.com/previous",
              observedAt: new Date("2026-08-04T10:00:00.000Z"),
              snapshotId: previousSnapshotId
            }
          ];
        }
      },
      aiAnswerSnapshot: { findMany: async () => [] },
      rankSnapshot: { findMany: async () => [] },
      trackingContextVersion: {
        findMany: async () => [
          {
            contextId: latestContextId,
            configurationVersion: 1,
            searchEngine: "YANDEX"
          },
          {
            contextId: previousContextId,
            configurationVersion: 1,
            searchEngine: "YANDEX"
          }
        ]
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const ascending = await service.list(
    workspaceId,
    projectId,
    { limit: 100, sort: "YANDEX_POSITION_ASC" },
    "request-position-sort-asc"
  );
  await service.list(
    workspaceId,
    projectId,
    { limit: 100, sort: "YANDEX_POSITION_DESC" },
    "request-position-sort-desc"
  );

  const metricQueries = rawQueries.filter(
    (query) => !query.sql.includes("jsonb_to_recordset")
  );
  const historyQueries = rawQueries.filter(
    (query) => query.sql.includes("jsonb_to_recordset")
  );
  assert.equal(metricQueries.length, 2);
  assert.equal(historyQueries.length, 2);
  for (const query of metricQueries) {
    assert.match(query.sql, /latest_rank\.found/u);
    assert.match(query.sql, /historical_position/u);
    assert.match(
      query.sql,
      /WHEN candidate\.found = TRUE AND candidate\.position IS NOT NULL/u
    );
    assert.match(
      query.sql,
      /WHEN cr\.found = TRUE AND cr\.position IS NOT NULL THEN NULL/u
    );
    assert.match(query.sql, /FROM rank_snapshots snapshot/u);
    assert.match(
      query.sql,
      /\(snapshot\.observed_at, snapshot\.id\) </u
    );
    assert.match(
      query.sql,
      /snapshot\.tracking_context_id = previous_tcv\.context_id/u
    );
  }
  for (const query of historyQueries) {
    assert.match(
      query.sql,
      /current_snapshot\.observed_at = anchors\.observed_at/u
    );
    assert.match(query.sql, /current_snapshot\.id = anchors\.snapshot_id/u);
  }
  assert.ok(metricQueries[0]?.values.includes(3_000_000n));
  assert.ok(metricQueries[1]?.values.includes(0n));
  assert.match(
    metricQueries[0]?.sql ?? "",
    /ORDER BY ranked\.sort_value ASC, ranked\.id ASC/u
  );
  assert.match(
    metricQueries[1]?.sql ?? "",
    /ORDER BY ranked\.sort_value DESC, ranked\.id DESC/u
  );
  assert.deepEqual(observedRankOrderBy, [
    { observedAt: "desc" },
    { snapshotId: "desc" },
    { keywordId: "asc" },
    { trackingContextId: "desc" }
  ]);
  assert.deepEqual(ascending.data[0]?.positions, [
    {
      searchEngine: "YANDEX",
      found: false,
      previousPosition: 13,
      observedAt: "2026-08-05T10:00:00.000Z"
    }
  ]);
});

test("sorts AI positions in four stable capture-state buckets", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000014";
  const rawQueries: Prisma.Sql[] = [];
  const service = new KeywordService(
    {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        rawQueries.push(Prisma.sql(strings, ...values));
        return [{ id: keywordId, sort_value: 7n }];
      },
      keyword: {
        findMany: async () => [{
          ...keyword(keywordId, "2026-08-01T09:00:00.000Z"),
          targetPageId: null,
          typedCustomValues: []
        }],
        count: async () => 1
      },
      trackingContextKeywordAssignment: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] }
    } as unknown as PrismaService,
    semanticVersions()
  );

  await service.list(
    workspaceId,
    projectId,
    { limit: 100, sort: "YANDEX_AI_POSITION_ASC" },
    "request-ai-position-sort"
  );
  await service.list(
    workspaceId,
    projectId,
    { limit: 100, sort: "GOOGLE_AI_POSITION_DESC" },
    "request-ai-position-sort-desc"
  );
  await service.list(
    workspaceId,
    projectId,
    { limit: 100, sort: "GOOGLE_AI_CHECKED_AT_DESC" },
    "request-ai-date-sort"
  );
  await service.list(
    workspaceId,
    projectId,
    {
      limit: 100,
      sort: "RANK_AI_POSITION_ASC",
      rankSortDimensionKey: "GOOGLE|RU|1011973|ru|MOBILE"
    },
    "request-ai-slice-position-sort"
  );
  await service.list(
    workspaceId,
    projectId,
    {
      limit: 100,
      sort: "RANK_AI_CHECKED_AT_DESC",
      rankSortDimensionKey: "GOOGLE|RU|1011973|ru|MOBILE"
    },
    "request-ai-slice-date-sort"
  );

  assert.equal(rawQueries.length, 5);
  assert.match(rawQueries[0]?.sql ?? "", /FROM ai_answer_snapshots current_ai/u);
  for (const query of rawQueries.slice(0, 2)) {
    assert.match(
      query.sql,
      /WHEN latest_ai\.site_found AND latest_ai\.position IS NOT NULL/u
    );
  }
  assert.match(rawQueries[0]?.sql ?? "", /latest_ai\.site_found/u);
  assert.match(rawQueries[0]?.sql ?? "", /historical_position/u);
  assert.match(
    rawQueries[0]?.sql ?? "",
    /WHEN previous\.site_found = TRUE AND previous\.position IS NOT NULL/u
  );
  assert.match(
    rawQueries[0]?.sql ?? "",
    /\(previous\.observed_at, previous\.id\) </u
  );
  assert.match(rawQueries[0]?.sql ?? "", /ORDER BY ranked\.sort_value ASC/u);
  assert.ok(rawQueries[0]?.values.includes("YANDEX"));
  assert.ok(rawQueries[0]?.values.includes(3_000_000n));
  assert.match(rawQueries[1]?.sql ?? "", /historical_position/u);
  assert.match(rawQueries[1]?.sql ?? "", /ORDER BY ranked\.sort_value DESC/u);
  assert.ok(rawQueries[1]?.values.includes("GOOGLE"));
  assert.ok(rawQueries[1]?.values.includes(0n));
  assert.match(rawQueries[2]?.sql ?? "", /extract\(epoch from latest_ai\.observed_at\)/u);
  assert.match(rawQueries[2]?.sql ?? "", /ORDER BY ranked\.sort_value DESC/u);
  assert.ok(rawQueries[2]?.values.includes("GOOGLE"));
  for (const query of rawQueries.slice(3)) {
    assert.ok(query?.values.includes("GOOGLE"));
    assert.ok(query?.values.includes("1011973"));
    assert.ok(query?.values.includes("MOBILE"));
  }
  assert.match(rawQueries[3]?.sql ?? "", /latest_ai\.site_found/u);
  assert.match(
    rawQueries[4]?.sql ?? "",
    /extract\(epoch from latest_ai\.observed_at\)/u
  );
});

test("moves a keyword to the system trash before allowing permanent deletion", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000080";
  const trashId = "01900000-0000-7000-8000-000000000081";
  const ungroupedId = "01900000-0000-7000-8000-000000000082";
  const current = {
    ...keyword(keywordId, "2026-08-01T10:00:00Z"),
    targetPageId: null,
    typedCustomValues: []
  };
  const membershipCreates: unknown[] = [];
  const purgeCalls: string[] = [];
  let purgeUpdate: unknown;
  let stored: Omit<typeof current, "status"> & {
    status: "ACTIVE" | "DELETED";
  } = current;
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: keywordId }],
    keywordGroup: {
      findFirst: async ({ where }: { where: { systemKind?: string } }) =>
        where.systemKind === "TRASH"
          ? { id: trashId }
          : where.systemKind === "UNGROUPED"
            ? { id: ungroupedId }
            : null,
      create: async () => {
        throw new Error("System groups must be reused");
      }
    },
    keywordGroupMembership: {
      deleteMany: async () => {
        purgeCalls.push("memberships");
        return { count: 1 };
      },
      create: async ({ data }: { data: unknown }) => {
        membershipCreates.push(data);
        return data;
      }
    },
    keywordTag: {
      deleteMany: async () => {
        purgeCalls.push("tags");
        return { count: 1 };
      }
    },
    semanticKeywordCustomValue: {
      deleteMany: async () => {
        purgeCalls.push("custom-values");
        return { count: 1 };
      }
    },
    keyword: {
      findUnique: async () => stored,
      update: async (input?: { data?: unknown }) => {
        if (input?.data && stored.status === "DELETED") {
          purgeCalls.push("keyword-redaction");
          purgeUpdate = input.data;
          return stored;
        }
        stored = {
          ...stored,
          status: "DELETED" as const,
          version: stored.version + 1,
          memberships: [
            { group: { id: trashId, path: "__system__/trash", name: "Корзина" } }
          ]
        };
        return stored;
      }
    }
  };
  const versions = {
    ...semanticVersions(),
    createWithKeywordChange: async () => ({})
  } as unknown as SemanticVersionService;
  const service = new KeywordService({
    $transaction: async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction)
  } as unknown as PrismaService, versions);

  await service.delete(keywordId, {
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    version: 1
  });
  assert.deepEqual(membershipCreates, [
    { projectId, keywordId, groupId: trashId }
  ]);
  assert.deepEqual(purgeCalls, ["memberships"]);
  purgeCalls.length = 0;

  await service.delete(keywordId, {
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    version: 2,
    permanent: true
  });
  assert.deepEqual(purgeCalls, [
    "memberships",
    "tags",
    "custom-values",
    "keyword-redaction"
  ]);
  assert.deepEqual(purgeUpdate, {
    textOriginal: "",
    textNormalized: `__purged__:${keywordId}`,
    normalizedHash: sha256ForTest(
      `purged:${workspaceId}:${projectId}:${keywordId}`
    ),
    language: "und",
    priority: 0,
    isFavorite: false,
    showAiAnswerButton: false,
    intent: null,
    clusterId: null,
    targetPageId: null,
    isTracked: false,
    customValues: {},
    note: null,
    sourceMode: "MANUAL",
    sourceId: null,
    createdBy: null,
    updatedBy: "01900000-0000-7000-8000-000000000003",
    version: { increment: 1 }
  });
});

test("skips active and trashed duplicates without capacity or restore writes", async () => {
  for (const status of ["ACTIVE", "DELETED"] as const) {
    const existing = {
      ...keyword(
        status === "ACTIVE"
          ? "01900000-0000-7000-8000-000000000083"
          : "01900000-0000-7000-8000-000000000084",
        "2026-08-01T10:00:00Z"
      ),
      status,
      deletedAt: status === "DELETED" ? new Date("2026-08-02T08:00:00Z") : null,
      typedCustomValues: [],
      memberships: [
        {
          group: {
            id: "01900000-0000-7000-8000-000000000085",
            path: status === "DELETED" ? "__system__/trash" : "SEO",
            name: status === "DELETED" ? "Корзина" : "SEO",
            systemKind: status === "DELETED" ? "TRASH" : null
          }
        }
      ]
    };
    let observedIdentity: unknown;
    let mutationCount = 0;
    const transaction = {
      $executeRaw: async () => 1,
      keyword: {
        findFirst: async ({ where }: { where: unknown }) => {
          observedIdentity = where;
          return existing;
        },
        count: async () => {
          throw new Error("Duplicate skip must not consume capacity");
        },
        create: async () => {
          mutationCount += 1;
          return existing;
        },
        updateMany: async () => {
          mutationCount += 1;
          return { count: 1 };
        }
      },
      keywordGroupMembership: {
        findFirst: async () =>
          status === "DELETED" ? { keywordId: existing.id } : null
      },
      page: {
        findFirst: async () => ({ url: "https://example.com/seo" })
      },
      trackingContextKeywordAssignment: {
        findFirst: async () => null
      }
    };
    const service = new KeywordService(
      {
        $transaction: async (
          callback: (client: typeof transaction) => unknown
        ) => callback(transaction)
      } as unknown as PrismaService,
      semanticVersions()
    );

    const result = await service.create(createInput("SKIP_EXISTING"));

    assert.equal(result.id, existing.id);
    assert.equal(result.createOutcome, "SKIPPED_EXISTING");
    assert.equal(mutationCount, 0);
    assert.deepEqual(observedIdentity, {
      workspaceId,
      projectId,
      language: "ru",
      normalizedHash:
        "4a6b150b17193cd6e8b2c63ee4af762d636371ea727666f1f31f704146f59244"
    });
    if (status === "DELETED") {
      const rejectedPolicyResult = await service.create(
        createInput("REJECT_EXISTING")
      );
      assert.equal(rejectedPolicyResult.createOutcome, "SKIPPED_EXISTING");
      assert.equal(rejectedPolicyResult.trashed, true);
    } else {
      await assert.rejects(
        () => service.create(createInput("REJECT_EXISTING")),
        (error: unknown) =>
          error instanceof HttpException &&
          error.getStatus() === HttpStatus.CONFLICT &&
          (error.getResponse() as { code?: string }).code === "DUPLICATE"
      );
    }
  }
});

test("links an active canonical keyword to another regular group", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000086";
  const targetGroupId = "01900000-0000-7000-8000-000000000087";
  const tagId = "01900000-0000-7000-8000-000000000089";
  let stored = {
    ...keyword(keywordId, "2026-08-01T10:00:00Z"),
    typedCustomValues: [],
    tags: [{ tag: { id: tagId, name: "Приоритет" } }],
    memberships: [
      {
        group: {
          id: "01900000-0000-7000-8000-000000000030",
          path: "Услуги / SEO",
          name: "SEO",
          systemKind: null
        }
      }
    ]
  };
  let createdMembership: unknown;
  let removedMemberships: unknown;
  let observedUpdate: unknown;
  let versionChange: unknown;
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: keywordId }],
    keyword: {
      findFirst: async () => stored,
      findUnique: async () => stored,
      updateMany: async (input: { data: unknown; where: unknown }) => {
        observedUpdate = input;
        stored = { ...stored, version: stored.version + 1 };
        return { count: 1 };
      },
      count: async () => {
        throw new Error("Moving an existing keyword must not consume capacity");
      },
      create: async () => {
        throw new Error("Linking must not create another keyword identity");
      }
    },
    keywordGroup: {
      findFirst: async () => ({
        id: targetGroupId,
        path: "Услуги / Продвижение",
        name: "Продвижение",
        systemKind: null
      })
    },
    keywordGroupMembership: {
      findFirst: async () => null,
      create: async ({ data }: { data: {
        projectId: string;
        keywordId: string;
        groupId: string;
      } }) => {
        createdMembership = data;
        stored = {
          ...stored,
          memberships: [...stored.memberships, {
            group: {
              id: data.groupId,
              path: "Услуги / Продвижение",
              name: "Продвижение",
              systemKind: null
            }
          }]
        };
        return data;
      },
      deleteMany: async ({ where }: { where: unknown }) => {
        removedMemberships = where;
        return { count: 0 };
      }
    },
    page: {
      findFirst: async () => ({ url: "https://example.com/seo" })
    },
    trackingContextKeywordAssignment: {
      findFirst: async () => null
    }
  };
  const versions = {
    ...semanticVersions(),
    createWithKeywordChange: async (
      _transaction: unknown,
      _identity: unknown,
      change: unknown
    ) => {
      versionChange = change;
      return {};
    }
  } as unknown as SemanticVersionService;
  const service = new KeywordService(
    {
      $transaction: async (
        callback: (client: typeof transaction) => unknown
      ) => callback(transaction)
    } as unknown as PrismaService,
    versions
  );

  const result = await service.create({
    ...createInput("ADD_TO_GROUP"),
    groupId: "01900000-0000-7000-8000-000000000088",
    duplicateGroupId: targetGroupId
  });

  assert.equal(result.id, keywordId);
  assert.equal(result.groupId, targetGroupId);
  assert.equal(result.version, 2);
  assert.equal(result.groupMembershipCount, 2);
  assert.equal(result.createOutcome, "LINKED_EXISTING");
  assert.deepEqual(createdMembership, {
    projectId,
    keywordId,
    groupId: targetGroupId
  });
  assert.deepEqual(removedMemberships, {
    projectId,
    keywordId,
    group: {
      workspaceId,
      projectId,
      systemKind: "UNGROUPED"
    }
  });
  assert.deepEqual(observedUpdate, {
    where: {
      id: keywordId,
      workspaceId,
      projectId,
      status: "ACTIVE",
      version: 1
    },
    data: {
      updatedBy: "01900000-0000-7000-8000-000000000003",
      version: { increment: 1 }
    }
  });
  assert.deepEqual(versionChange, {
    entityId: keywordId,
    operation: "UPDATE",
    beforeState: {
      textOriginal: "SEO аудит",
      textNormalized: "seo аудит",
      normalizedHash: "a".repeat(64),
      language: "ru",
      priority: 0,
      isFavorite: false,
      isTracked: false,
      intent: null,
      status: "ACTIVE",
      clusterId: null,
      targetPageId: "01900000-0000-7000-8000-000000000020",
      groupId: "01900000-0000-7000-8000-000000000030",
      tagIds: [tagId]
    },
    afterState: {
      textOriginal: "SEO аудит",
      textNormalized: "seo аудит",
      normalizedHash: "a".repeat(64),
      language: "ru",
      priority: 0,
      isFavorite: false,
      isTracked: false,
      intent: null,
      status: "ACTIVE",
      clusterId: null,
      targetPageId: "01900000-0000-7000-8000-000000000020",
      groupId: "01900000-0000-7000-8000-000000000030",
      groupIds: [
        "01900000-0000-7000-8000-000000000030",
        targetGroupId
      ],
      tagIds: [tagId]
    },
    beforeVersion: 1,
    afterVersion: 2
  });
});

test("moves an active duplicate into only the requested group", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000096";
  const oldGroupId = "01900000-0000-7000-8000-000000000097";
  const targetGroupId = "01900000-0000-7000-8000-000000000098";
  const group = (id: string, name: string) => ({
    id,
    path: name,
    name,
    systemKind: null
  });
  let stored = {
    ...keyword(keywordId, "2026-08-01T10:00:00Z"),
    typedCustomValues: [],
    tags: [],
    memberships: [
      { group: group(oldGroupId, "Старая") },
      { group: group(targetGroupId, "Текущая") }
    ]
  };
  let deletedWhere: unknown;
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: keywordId }],
    keyword: {
      findFirst: async () => stored,
      findUnique: async () => stored,
      updateMany: async () => {
        stored = { ...stored, version: stored.version + 1 };
        return { count: 1 };
      },
      count: async () => { throw new Error("Moving must not consume capacity"); },
      create: async () => { throw new Error("Moving must not create a keyword"); }
    },
    keywordGroup: {
      findFirst: async () => group(targetGroupId, "Текущая")
    },
    keywordGroupMembership: {
      findFirst: async () => null,
      deleteMany: async ({ where }: { where: unknown }) => {
        deletedWhere = where;
        stored = { ...stored, memberships: [] };
        return { count: 2 };
      },
      create: async ({ data }: { data: { groupId: string } }) => {
        stored = { ...stored, memberships: [{ group: group(data.groupId, "Текущая") }] };
        return data;
      }
    },
    page: { findFirst: async () => ({ url: "https://example.com/seo" }) },
    trackingContextKeywordAssignment: { findFirst: async () => null }
  };
  const versions = {
    ...semanticVersions(),
    createWithKeywordChange: async () => ({})
  } as unknown as SemanticVersionService;
  const service = new KeywordService({
    $transaction: async (callback: (client: typeof transaction) => unknown) => callback(transaction)
  } as unknown as PrismaService, versions);

  const result = await service.create({
    ...createInput("MOVE_TO_GROUP"),
    duplicateGroupId: targetGroupId
  });

  assert.equal(result.id, keywordId);
  assert.equal(result.groupId, targetGroupId);
  assert.equal(result.groupMembershipCount, undefined);
  assert.equal(stored.memberships.length, 1);
  assert.equal(result.createOutcome, "LINKED_EXISTING");
  assert.deepEqual(deletedWhere, { projectId, keywordId });
});

test("moving a trashed keyword restores it in the target group", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000106";
  const trashGroupId = "01900000-0000-7000-8000-000000000107";
  const targetGroupId = "01900000-0000-7000-8000-000000000108";
  let stored = {
    ...keyword(keywordId, "2026-08-01T10:00:00Z"),
    status: "DELETED" as "ACTIVE" | "DELETED",
    deletedAt: new Date("2026-09-01T10:00:00Z") as Date | null,
    typedCustomValues: [],
    memberships: [{
      group: {
        id: trashGroupId,
        path: "Корзина",
        name: "Корзина",
        systemKind: "TRASH" as "TRASH" | null
      }
    }]
  };
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: keywordId }],
    keyword: {
      findUnique: async () => stored,
      update: async ({ data }: { data: { status?: "ACTIVE"; deletedAt?: null } }) => {
        stored = {
          ...stored,
          status: data.status ?? stored.status,
          deletedAt: data.deletedAt === null ? null : stored.deletedAt,
          version: stored.version + 1
        };
        return stored;
      }
    },
    keywordGroup: {
      findFirst: async () => ({ id: targetGroupId, systemKind: null })
    },
    keywordGroupMembership: {
      deleteMany: async () => {
        stored = { ...stored, memberships: [] };
        return { count: 1 };
      },
      create: async () => {
        stored = {
          ...stored,
          memberships: [{
            group: {
              id: targetGroupId,
              path: "Активные",
              name: "Активные",
              systemKind: null
            }
          }]
        };
        return {};
      }
    },
    page: { findFirst: async () => ({ url: "https://example.com/seo" }) },
    trackingContextKeywordAssignment: { findFirst: async () => null }
  };
  const versions = {
    ...semanticVersions(),
    createWithKeywordChange: async () => ({})
  } as unknown as SemanticVersionService;
  const service = new KeywordService({
    $transaction: async (callback: (client: typeof transaction) => unknown) => callback(transaction)
  } as unknown as PrismaService, versions);

  const result = await service.update(keywordId, {
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    version: 1,
    groupId: targetGroupId
  });

  assert.equal(result.trashed, undefined);
  assert.equal(result.groupId, targetGroupId);
  assert.equal(stored.status, "ACTIVE");
  assert.equal(stored.deletedAt, null);
  assert.equal(stored.memberships.length, 1);
});

test("restores a trashed duplicate only with the explicit recovery policy", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000086";
  const ungroupedId = "01900000-0000-7000-8000-000000000087";
  const trashId = "01900000-0000-7000-8000-000000000088";
  type MutableStoredKeyword = Omit<
    ReturnType<typeof keyword>,
    | "status"
    | "deletedAt"
    | "targetPageId"
    | "memberships"
    | "tags"
    | "updatedBy"
  > & {
    status: "ACTIVE" | "DELETED";
    deletedAt: Date | null;
    targetPageId: string | null;
    updatedBy: string | null;
    memberships: Array<{
      group: {
        id: string;
        path: string;
        name: string;
        systemKind: "UNGROUPED" | "TRASH" | null;
      };
    }>;
    tags: Array<{ tag: { id?: string; name: string } }>;
    typedCustomValues: never[];
  };
  let stored: MutableStoredKeyword = {
    ...keyword(keywordId, "2026-08-01T10:00:00Z"),
    status: "DELETED" as const,
    deletedAt: new Date("2026-08-02T08:00:00Z"),
    targetPageId: null,
    memberships: [
      {
        group: {
          id: trashId,
          path: "__system__/trash",
          name: "Корзина",
          systemKind: "TRASH"
        }
      }
    ],
    tags: [{ tag: { id: "old-tag", name: "Старый" } }],
    typedCustomValues: []
  };
  let observedCasWhere: unknown;
  let capacityCountCalls = 0;
  let versionChange: unknown;
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: keywordId }],
    keyword: {
      findFirst: async () => stored,
      findUnique: async () => stored,
      count: async () => {
        capacityCountCalls += 1;
        return 0;
      },
      create: async () => {
        throw new Error("Tombstone restore must not insert a duplicate row");
      },
      updateMany: async ({ where }: { where: unknown }) => {
        observedCasWhere = where;
        stored = {
          ...stored,
          textOriginal: "SEO аудит",
          textNormalized: "seo аудит",
          priority: 0,
          isFavorite: false,
          intent: null,
          clusterId: null,
          targetPageId: null,
          status: "ACTIVE" as const,
          deletedAt: null,
          updatedBy: "01900000-0000-7000-8000-000000000003",
          version: 2,
          updatedAt: new Date("2026-08-02T09:00:00Z")
        };
        return { count: 1 };
      }
    },
    keywordGroup: {
      findFirst: async ({ where }: { where: { systemKind: string } }) => ({
        id: where.systemKind === "TRASH" ? trashId : ungroupedId
      }),
      create: async () => {
        throw new Error("System groups must be reused");
      }
    },
    keywordGroupMembership: {
      findFirst: async () => ({ keywordId }),
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: { groupId: string } }) => {
        stored = {
          ...stored,
          memberships: [
            {
              group: {
                id: data.groupId,
                path: "__system__/ungrouped",
                name: "Без группы",
                systemKind: "UNGROUPED" as const
              }
            }
          ]
        };
        return data;
      }
    },
    keywordTag: {
      deleteMany: async () => {
        stored = { ...stored, tags: [] };
        return { count: 1 };
      },
      createMany: async () => ({ count: 0 })
    },
    trackingContextKeywordAssignment: {
      findFirst: async () => null
    }
  };
  const versions = {
    ...semanticVersions(),
    createWithKeywordChange: async (
      _transaction: unknown,
      _identity: unknown,
      change: unknown
    ) => {
      versionChange = change;
      return {};
    }
  } as unknown as SemanticVersionService;
  const service = new KeywordService(
    {
      $transaction: async (
        callback: (client: typeof transaction) => unknown
      ) => callback(transaction)
    } as unknown as PrismaService,
    versions
  );

  const result = await service.create(createInput("RESTORE_TRASHED"));

  assert.equal(result.id, keywordId);
  assert.equal(result.version, 2);
  assert.equal(result.createOutcome, "RESTORED");
  assert.equal(result.groupId, ungroupedId);
  assert.equal(capacityCountCalls, 0);
  assert.deepEqual(observedCasWhere, {
    id: keywordId,
    workspaceId,
    projectId,
    status: "DELETED",
    version: 1,
    language: "ru",
    normalizedHash:
      "4a6b150b17193cd6e8b2c63ee4af762d636371ea727666f1f31f704146f59244"
  });
  assert.deepEqual(versionChange, {
    entityId: keywordId,
    operation: "UPDATE",
    beforeState: {
      textOriginal: "SEO аудит",
      textNormalized: "seo аудит",
      normalizedHash: "a".repeat(64),
      language: "ru",
      priority: 0,
      isFavorite: false,
      isTracked: false,
      intent: null,
      status: "DELETED",
      clusterId: null,
      targetPageId: null,
      groupId: trashId,
      tagIds: ["old-tag"]
    },
    afterState: {
      textOriginal: "SEO аудит",
      textNormalized: "seo аудит",
      normalizedHash: "a".repeat(64),
      language: "ru",
      priority: 0,
      isFavorite: false,
      isTracked: false,
      intent: null,
      status: "ACTIVE",
      clusterId: null,
      targetPageId: null,
      groupId: ungroupedId,
      tagIds: []
    },
    beforeVersion: 1,
    afterVersion: 2
  });
});

test("bulk create keeps duplicate outcomes indexed and partial", async () => {
  const service = new KeywordService(
    {} as PrismaService,
    semanticVersions()
  );
  let seen = false;
  service.create = async (input) => {
    if (input.text === "provider failure") throw new Error("provider failure");
    if (!seen) {
      seen = true;
      return { ...semanticItem("01900000-0000-7000-8000-000000000090"), createOutcome: "CREATED" };
    }
    if (input.duplicatePolicy === "SKIP_EXISTING") {
      return { ...semanticItem("01900000-0000-7000-8000-000000000090"), createOutcome: "SKIPPED_EXISTING" };
    }
    throw new HttpException({ code: "DUPLICATE" }, HttpStatus.CONFLICT);
  };

  const entitlement = createInput("SKIP_EXISTING").entitlement;
  const skipped = await service.bulkCreate({
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    entitlement,
    duplicatePolicy: "SKIP_EXISTING",
    items: [
      createItem("SEO аудит"),
      createItem("SEO аудит")
    ]
  });
  assert.deepEqual(
    skipped.rows.map(({ index, outcome }) => ({ index, outcome })),
    [
      { index: 0, outcome: "CREATED" },
      { index: 1, outcome: "SKIPPED_EXISTING" }
    ]
  );

  seen = false;
  const rejected = await service.bulkCreate({
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    entitlement,
    duplicatePolicy: "REJECT_EXISTING",
    items: [
      createItem("SEO аудит"),
      createItem("SEO аудит"),
      createItem("provider failure")
    ]
  });
  assert.deepEqual(
    rejected.rows.map(({ index, outcome }) => ({ index, outcome })),
    [
      { index: 0, outcome: "CREATED" },
      { index: 1, outcome: "REJECTED_EXISTING" },
      { index: 2, outcome: "FAILED" }
    ]
  );
  assert.equal(rejected.created, 1);
  assert.equal(rejected.skipped, 0);
  assert.equal(rejected.rejected, 1);
  assert.equal(rejected.failed, 1);

  seen = false;
  const rowOverride = await service.bulkCreate({
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    entitlement,
    duplicatePolicy: "SKIP_EXISTING",
    items: [
      createItem("SEO аудит"),
      { ...createItem("SEO аудит"), duplicatePolicy: "REJECT_EXISTING" }
    ]
  });
  assert.deepEqual(
    rowOverride.rows.map(({ index, outcome }) => ({ index, outcome })),
    [
      { index: 0, outcome: "CREATED" },
      { index: 1, outcome: "REJECTED_EXISTING" }
    ]
  );
});

test("bulk update partitions changed, conflicted and skipped rows", async () => {
  const changedId = "01900000-0000-7000-8000-000000000040";
  const conflictId = "01900000-0000-7000-8000-000000000041";
  const skippedId = "01900000-0000-7000-8000-000000000042";
  const service = new KeywordService(
    {} as PrismaService,
    semanticVersions()
  );
  service.update = async (
    id: string,
    input: InternalUpdateSemanticKeywordInput
  ) => {
    assert.equal(input.priority, 15);
    if (id === conflictId) {
      throw new HttpException({}, HttpStatus.PRECONDITION_FAILED);
    }
    if (id === skippedId) {
      throw new HttpException({}, HttpStatus.NOT_FOUND);
    }
    return semanticItem(id);
  };

  const result = await service.bulkUpdate({
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    items: [
      { id: changedId, version: 1 },
      { id: conflictId, version: 2 },
      { id: skippedId, version: 3 }
    ],
    patch: { priority: 15 }
  });

  assert.equal(result.selected, 3);
  assert.equal(result.changed, 1);
  assert.equal(result.conflicted, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.conflictedIds, [conflictId]);
});

test("cleaning preview detects versions and project duplicates", async () => {
  const changedId = "01900000-0000-7000-8000-000000000050";
  const conflictId = "01900000-0000-7000-8000-000000000051";
  const duplicateId = "01900000-0000-7000-8000-000000000052";
  let call = 0;
  const service = new KeywordService(
    {
      keyword: {
        findMany: async (query: {
          where: { OR?: readonly { language: string; normalizedHash: string }[] };
        }) => {
          call += 1;
          if (call === 1) {
            return [
              {
                id: changedId,
                textOriginal: "  SEO   АУДИТ  ",
                language: "ru",
                version: 1
              },
              {
                id: conflictId,
                textOriginal: "Ёлка",
                language: "ru",
                version: 2
              }
            ];
          }
          const target = query.where.OR?.[0];
          return target
            ? [{ id: duplicateId, ...target }]
            : [];
        }
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  const preview = await service.previewCleaning({
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    items: [
      { id: changedId, version: 1 },
      { id: conflictId, version: 1 }
    ],
    rules: { collapseWhitespace: true, letterCase: "LOWER" }
  });

  assert.equal(preview.applicable, 0);
  assert.equal(preview.conflicted, 1);
  assert.equal(preview.failed, 1);
  assert.equal(preview.changes[0]?.state, "DUPLICATE");
  assert.equal(preview.changes[1]?.state, "CONFLICTED");
});

test("cleaning apply creates one version and partitions every selection", async () => {
  const changedId = "01900000-0000-7000-8000-000000000060";
  const unchangedId = "01900000-0000-7000-8000-000000000061";
  const failedId = "01900000-0000-7000-8000-000000000062";
  let finalized = 0;
  const versions = {
    ...semanticVersions(),
    finalizeBulkVersion: async () => {
      finalized += 1;
      return {};
    }
  } as unknown as SemanticVersionService;
  const service = new KeywordService({} as PrismaService, versions);
  service.previewCleaning = async () => ({
    selected: 3,
    applicable: 1,
    unchanged: 1,
    conflicted: 0,
    failed: 1,
    changes: [
      {
        keywordId: changedId,
        state: "APPLICABLE",
        expectedVersion: 1,
        currentVersion: 1,
        beforeText: "SEO   аудит",
        afterText: "SEO аудит"
      },
      {
        keywordId: unchangedId,
        state: "UNCHANGED",
        expectedVersion: 1,
        currentVersion: 1,
        beforeText: "PPC",
        afterText: "PPC"
      },
      {
        keywordId: failedId,
        state: "INVALID",
        expectedVersion: 1,
        currentVersion: 1,
        beforeText: "!",
        afterText: ""
      }
    ]
  });
  service.update = async (id, input) => {
    assert.equal(input.text, "SEO аудит");
    return semanticItem(id);
  };

  const result = await service.clean({
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    items: [
      { id: changedId, version: 1 },
      { id: unchangedId, version: 1 },
      { id: failedId, version: 1 }
    ],
    rules: { collapseWhitespace: true }
  });

  assert.equal(result.changed, 1);
  assert.deepEqual(result.unchangedIds, [unchangedId]);
  assert.deepEqual(result.failedIds, [failedId]);
  assert.equal(finalized, 1);
});

function keyword(id: string, createdAt: string) {
  return {
    id,
    workspaceId,
    projectId,
    textOriginal: "SEO аудит",
    textNormalized: "seo аудит",
    normalizedHash: "a".repeat(64),
    language: "ru",
    priority: 0,
    isFavorite: false,
    intent: null,
    status: "ACTIVE" as const,
    clusterId: null,
    targetPageId: "01900000-0000-7000-8000-000000000020",
    isTracked: false,
    customValues: {},
    sourceMode: "IMPORT" as const,
    sourceId: null,
    createdBy: null,
    updatedBy: null,
    version: 1,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    deletedAt: null,
    memberships: [
      {
        group: {
          id: "01900000-0000-7000-8000-000000000030",
          path: "Услуги / SEO",
          name: "SEO"
        }
      }
    ],
    tags: [{ tag: { name: "Приоритет" } }]
  };
}

function semanticVersions(): SemanticVersionService {
  return {
    createOpenBulkVersion: async (input: {
      workspaceId: string;
      projectId: string;
    }) => ({
      id: "01900000-0000-7000-8000-000000000099",
      workspaceId: input.workspaceId,
      projectId: input.projectId
    }),
    finalizeBulkVersion: async () => ({})
  } as unknown as SemanticVersionService;
}

function semanticItem(id: string): SemanticKeywordListItem {
  return {
    id,
    textOriginal: "SEO аудит",
    textNormalized: "seo аудит",
    language: "ru",
    priority: 15,
    isFavorite: false,
    isTracked: false,
    showAiAnswerButton: false,
    tags: [],
    tagsTruncated: false,
    sourceMode: "MANUAL",
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z",
    version: 2
  };
}

function createInput(
  duplicatePolicy: InternalCreateSemanticKeywordInput["duplicatePolicy"]
): InternalCreateSemanticKeywordInput {
  return {
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    entitlement: {
      planCode: "PRO",
      planVersion: 1,
      storedKeywords: 10_000,
      keywordsPerProject: 5_000,
      foldersPerProject: 200,
      trackedContextPairs: 5_000
    },
    text: "SEO аудит",
    language: "ru",
    priority: 0,
    isFavorite: false,
    tagNames: [],
    duplicatePolicy
  };
}

function createItem(text: string) {
  const {
    workspaceId: _workspaceId,
    projectId: _projectId,
    actorId: _actorId,
    entitlement: _entitlement,
    duplicatePolicy: _duplicatePolicy,
    ...item
  } = createInput("REJECT_EXISTING");
  return { ...item, text };
}

test("shows a saved competitor-only Google SPB collection even when sources are empty", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000021";
  const snapshotId = "01900000-0000-7000-8000-000000000022";
  const service = new KeywordService({
    keyword: { findFirst: async () => ({ id: keywordId, note: null }) },
    rankDimensionHistoryDeletion: { findMany: async () => [] },
    frequencySeasonalityPoint: { findMany: async () => [] },
    frequencySnapshot: { findMany: async () => [] },
    currentRank: { findMany: async () => [] },
    rankSnapshot: { findMany: async () => [] },
    aiAnswerSnapshot: { findMany: async ({ where }: { where: Readonly<Record<string, unknown>> }) => {
      assert.equal(where.workspaceId, workspaceId);
      assert.equal(where.projectId, projectId);
      if (where.positionTrackingEnabled) return [];
      assert.equal(where.sources, undefined, "A completed collection must not disappear when sources are empty");
      return [{ id: snapshotId, searchEngine: "GOOGLE", regionCode: "1012040", device: "DESKTOP", answerPresent: true, sources: [], observedAt: new Date("2026-09-21T10:00:00Z") }];
    } }
  } as unknown as PrismaService, semanticVersions());
  const result = await service.insights(workspaceId, projectId, keywordId);
  assert.deepEqual(result.aiPositionHistory, []);
  assert.equal(result.aiCompetitorSnapshots?.[0]?.answerPresent, true);
  assert.equal(result.aiCompetitorSnapshots?.[0]?.regionCode, "1012040");
  assert.deepEqual(result.aiCompetitorSnapshots?.[0]?.results, []);
});
