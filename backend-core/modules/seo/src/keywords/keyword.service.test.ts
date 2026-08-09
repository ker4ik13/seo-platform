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

test("averages the latest found position once per active keyword", async () => {
  const firstKeywordId = "01900000-0000-7000-8000-000000000010";
  const secondKeywordId = "01900000-0000-7000-8000-000000000011";
  const service = new KeywordService(
    {
      keyword: {
        findMany: async () => [
          { id: firstKeywordId },
          { id: secondKeywordId }
        ]
      },
      currentRank: {
        findMany: async () => [
          { keywordId: firstKeywordId, position: 10 },
          { keywordId: firstKeywordId, position: 30 },
          { keywordId: secondKeywordId, position: 20 },
          {
            keywordId: "01900000-0000-7000-8000-000000000099",
            position: 1
          }
        ]
      }
    } as unknown as PrismaService,
    semanticVersions()
  );

  assert.deepEqual(await service.positionSummary(workspaceId, projectId), {
    positionedKeywordCount: 2,
    averagePosition: 15
  });
});

test("returns a scoped cursor page with groups, tags and target URLs", async () => {
  let observedWhere: unknown;
  const rows = [
    keyword("01900000-0000-7000-8000-000000000010", "2026-07-29T08:00:00Z"),
    keyword("01900000-0000-7000-8000-000000000011", "2026-07-29T07:00:00Z")
  ];
  const service = new KeywordService({
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
          observedAt: new Date("2026-08-01T10:00:00.000Z")
        }
      ]
    },
    trackingContextVersion: {
      findMany: async () => [
        {
          contextId: "01900000-0000-7000-8000-000000000070",
          configurationVersion: 1,
          searchEngine: "YANDEX"
        }
      ]
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
  assert.equal(result.data[0]?.targetUrl, "https://example.com/seo");
  assert.deepEqual(result.data[0]?.tags, ["Приоритет"]);
  assert.equal(result.data[0]?.isTracked, true);
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
      observedAt: "2026-08-01T10:00:00.000Z"
    }
  ]);
  assert.equal(result.page.hasNext, true);
  assert.equal(result.page.totalApprox, 2);
  assert.ok(result.page.nextCursor);
  assert.ok(observedWhere);

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

test("projects exact rank collection metadata into keyword history", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000012";
  const contextId = "01900000-0000-7000-8000-000000000072";
  const service = new KeywordService(
    {
      keyword: {
        findFirst: async () => ({ id: keywordId, note: null })
      },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      rankSnapshot: {
        findMany: async () => [{
          id: "01900000-0000-7000-8000-000000000073",
          trackingContextId: contextId,
          configurationVersion: 2,
          provider: "XMLSTOCK",
          found: false,
          position: null,
          observedAt: new Date("2026-08-06T11:45:00.000Z"),
          manifest: {
            execution: {
              providerMappingVersion: "xmlstock-yandex-live@2"
            }
          }
        }]
      },
      rankSerpResult: {
        findMany: async () => [
          {
            snapshotId: "01900000-0000-7000-8000-000000000073",
            position: 1,
            rankingUrl: "https://competitor.example/one",
            title: "Конкурент",
            snippet: null
          },
          {
            snapshotId: "01900000-0000-7000-8000-000000000073",
            position: 2,
            rankingUrl: "https://example.com/result",
            title: null,
            snippet: null
          }
        ]
      },
      trackingContext: {
        findMany: async () => [{ id: contextId, name: "Яндекс · Москва" }]
      },
      trackingContextVersion: {
        findMany: async () => [{
          contextId,
          configurationVersion: 2,
          searchEngine: "YANDEX",
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

  const result = await service.insights(workspaceId, projectId, keywordId);

  assert.deepEqual(result.positionHistory, [{
    snapshotId: "01900000-0000-7000-8000-000000000073",
    trackingContextId: contextId,
    contextName: "Яндекс · Москва",
    searchEngine: "YANDEX",
    searchSource: "LIVE",
    device: "DESKTOP",
    regionCode: "213",
    regionLabel: "Москва",
    countryCode: "RU",
    language: "ru",
    depth: 50,
    provider: "XMLSTOCK",
    found: false,
    observedAt: "2026-08-06T11:45:00.000Z"
  }]);
  assert.deepEqual(result.competitorSnapshots, [{
    snapshotId: "01900000-0000-7000-8000-000000000073",
    trackingContextId: contextId,
    contextName: "Яндекс · Москва",
    searchEngine: "YANDEX",
    searchSource: "LIVE",
    provider: "XMLSTOCK",
    observedAt: "2026-08-06T11:45:00.000Z",
    results: [
      {
        position: 1,
        url: "https://competitor.example/one",
        title: "Конкурент"
      },
      { position: 2, url: "https://example.com/result" }
    ]
  }]);
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

test("projects imported Key Collector positions without poisoning keyword insights", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000082";
  const contextId = "01900000-0000-7000-8000-000000000083";
  const service = new KeywordService(
    {
      keyword: {
        findFirst: async () => ({ id: keywordId, note: null })
      },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      rankSnapshot: {
        findMany: async () => [{
          id: "01900000-0000-7000-8000-000000000084",
          trackingContextId: contextId,
          configurationVersion: 1,
          provider: "KEY_COLLECTOR",
          found: true,
          position: 34,
          observedAt: new Date("2026-08-07T14:00:00.000Z"),
          manifest: {
            execution: { source: "KC4", searchEngine: "YANDEX" }
          }
        }]
      },
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
    regionCode: "global",
    regionLabel: "Импорт Key Collector",
    countryCode: "RU",
    language: "ru",
    depth: 100,
    provider: "KEY_COLLECTOR",
    found: true,
    position: 34,
    observedAt: "2026-08-07T14:00:00.000Z"
  }]);
});

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

test("sorts by the latest engine result and keeps missing positions last", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000012";
  const latestContextId = "01900000-0000-7000-8000-000000000072";
  const previousContextId = "01900000-0000-7000-8000-000000000071";
  const rawQueries: Prisma.Sql[] = [];
  let observedRankOrderBy: unknown;
  const service = new KeywordService(
    {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        rawQueries.push(Prisma.sql(strings, ...values));
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
              observedAt: new Date("2026-08-05T10:00:00.000Z")
            },
            {
              keywordId,
              trackingContextId: previousContextId,
              configurationVersion: 1,
              found: true,
              position: 13,
              previousPosition: null,
              rankingUrl: "https://example.com/previous",
              observedAt: new Date("2026-08-04T10:00:00.000Z")
            }
          ];
        }
      },
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

  assert.equal(rawQueries.length, 2);
  for (const query of rawQueries) {
    assert.match(
      query.sql,
      /CASE WHEN cr\.found THEN cr\.position::bigint END AS metric/u
    );
    assert.doesNotMatch(query.sql, /AND cr\.found = TRUE/u);
  }
  assert.ok(rawQueries[0]?.values.includes(9_223_372_036_854_775_807n));
  assert.ok(rawQueries[1]?.values.includes(-1n));
  assert.match(
    rawQueries[0]?.sql ?? "",
    /ORDER BY ranked\.sort_value ASC, ranked\.id ASC/u
  );
  assert.match(
    rawQueries[1]?.sql ?? "",
    /ORDER BY ranked\.sort_value DESC, ranked\.id DESC/u
  );
  assert.deepEqual(observedRankOrderBy, [
    { observedAt: "desc" },
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
