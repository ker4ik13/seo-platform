import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { RankScopeService } from "./rank-scope.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const trackingContextId = "01900000-0000-7000-8000-000000000004";
const command = {
  workspaceId,
  projectId,
  actorId,
  trackingContextId
} as const;

test("reads an empty scope atomically at RepeatableRead", async () => {
  const observed: unknown[] = [];
  const service = scopeService(context(), [], observed);

  const result = await service.calculate(command);

  assert.equal(result.keywordCount, "0");
  assert.equal(result.pairCount, "0");
  assert.equal(result.contextCount, "1");
  assert.equal(result.configurationVersion, 3);
  assert.equal(result.configurationHash, "c".repeat(64));
  assert.match(
    availableScopeHash(result.semanticScopeHash),
    /^[0-9a-f]{64}$/u
  );
  assert.equal(Number.isNaN(Date.parse(result.calculatedAt)), false);
  assert.deepEqual(Object.keys(result).sort(), [
    "calculatedAt",
    "configuration",
    "configurationHash",
    "configurationVersion",
    "contextCount",
    "contextStatus",
    "contextVersion",
    "keywordCount",
    "pairCount",
    "projectId",
    "semanticScopeHash",
    "trackingContextId",
    "workspaceId"
  ]);
  assert.deepEqual(Object.keys(result.configuration).sort(), [
    "countryCode",
    "depth",
    "device",
    "domainMatchRule",
    "language",
    "regionCode",
    "regionLabel",
    "safeSearch",
    "searchEngine"
  ]);
  assert.deepEqual(observed[0], { isolationLevel: "RepeatableRead", timeout: 30_000 });
  assert.deepEqual(observed[1], {
    id: trackingContextId,
    workspaceId,
    projectId
  });
  assert.deepEqual(observed[2], {
    workspaceId,
    projectId,
    contextId: trackingContextId,
    removedAt: null,
    keyword: { status: "ACTIVE", isTracked: true }
  });
});

test("includes disabled keywords only for an explicit launch override", async () => {
  const observed: unknown[] = [];
  const service = scopeService(
    context({ launchProfile: { includeUntracked: true } }),
    [],
    observed
  );

  await service.calculate(command);

  assert.deepEqual(observed[2], {
    workspaceId,
    projectId,
    contextId: trackingContextId,
    removedAt: null,
    keyword: { status: "ACTIVE" }
  });
});

test("hash is stable and changes with execution-relevant keyword state", async () => {
  const original = [
    assignment(1, {
      textOriginal: "  Exact SEO  ",
      language: "en",
      version: 7
    }),
    assignment(2, {
      textOriginal: "SEO tools",
      language: "en",
      version: 2
    })
  ];
  const first = await scopeService(context(), original).calculate(command);
  const replay = await scopeService(context(), original).calculate(command);
  const reassigned = await scopeService(context(), [
    original[1]!,
    {
      ...original[0]!,
      id: "01900000-0000-7000-8000-000000009999"
    }
  ]).calculate(command);
  const textChanged = await scopeService(context(), [
    {
      ...original[0]!,
      keyword: {
        ...original[0]!.keyword,
        textOriginal: "Exact SEO"
      }
    },
    original[1]!
  ]).calculate(command);
  const versionChanged = await scopeService(context(), [
    original[0]!,
    {
      ...original[1]!,
      keyword: {
        ...original[1]!.keyword,
        version: 3
      }
    }
  ]).calculate(command);

  assert.equal(
    availableScopeHash(replay.semanticScopeHash),
    availableScopeHash(first.semanticScopeHash)
  );
  assert.equal(
    availableScopeHash(reassigned.semanticScopeHash),
    availableScopeHash(first.semanticScopeHash)
  );
  assert.equal(
    availableScopeHash(first.semanticScopeHash),
    "15001c9a454f7e4bbe2dfedada203e01b87e11fe55b39c00a7a5019dc70f01bb"
  );
  assert.doesNotMatch(
    JSON.stringify(first),
    new RegExp(original[0]!.keywordId, "u")
  );
  assert.doesNotMatch(JSON.stringify(first), /Exact SEO/u);
  assert.notEqual(
    availableScopeHash(textChanged.semanticScopeHash),
    availableScopeHash(first.semanticScopeHash)
  );
  assert.notEqual(
    availableScopeHash(versionChanged.semanticScopeHash),
    availableScopeHash(first.semanticScopeHash)
  );
  const configurationChanged = await scopeService(
    context({
      configurations: [
        {
          ...context().configurations[0]!,
          configurationVersion: 4,
          configurationHash: "d".repeat(64)
        }
      ]
    }),
    original
  ).calculate(command);
  assert.notEqual(
    availableScopeHash(configurationChanged.semanticScopeHash),
    availableScopeHash(first.semanticScopeHash)
  );
});

test("archive status is preserved and changes the semantic scope hash", async () => {
  const rows = [assignment(1)];
  const active = await scopeService(context(), rows).calculate(command);
  const archived = await scopeService(
    context({ status: "ARCHIVED" }),
    rows
  ).calculate(command);

  assert.equal(archived.contextStatus, "ARCHIVED");
  assert.notEqual(
    availableScopeHash(archived.semanticScopeHash),
    availableScopeHash(active.semanticScopeHash)
  );
});

test("returns an unavailable hash for a bounded over-limit scope", async () => {
  const sentinelKeywordId =
    "01900000-0000-7000-8000-000000009999";
  const sentinelText = "SENTINEL_PRIVATE_KEYWORD_TEXT";
  const rows = Array.from({ length: 300_001 }, (_, index) =>
    assignment(index + 1)
  );
  rows[300_000] = {
    ...rows[300_000]!,
    keywordId: sentinelKeywordId,
    keyword: {
      ...rows[300_000]!.keyword,
      id: sentinelKeywordId,
      textOriginal: sentinelText
    }
  };

  const result = await scopeService(context(), rows).calculate(command);
  const serialized = JSON.stringify(result);

  assert.equal(result.keywordCount, "300001");
  assert.equal(result.pairCount, "300001");
  assert.deepEqual(result.semanticScopeHash, {
    availability: "UNAVAILABLE"
  });
  assert.doesNotMatch(serialized, new RegExp(sentinelKeywordId, "u"));
  assert.doesNotMatch(serialized, new RegExp(sentinelText, "u"));
});

test("does not materialize provider-incompatible keyword text", async () => {
  const observed: unknown[] = [];
  const result = await scopeService(
    context(),
    [
      assignment(1, {
        textOriginal: "я".repeat(501)
      })
    ],
    observed
  ).calculate(command);

  assert.equal(result.keywordCount, "1");
  assert.deepEqual(result.semanticScopeHash, {
    availability: "UNAVAILABLE"
  });
  assert.equal(observed.length, 2);
});

test("foreign tenant and context stay indistinguishable as not found", async () => {
  const foreignWorkspaceId =
    "01900000-0000-7000-8000-000000000099";
  let assignmentRead = false;
  const service = new RankScopeService({
    $transaction: async (
      work: (transaction: unknown) => Promise<unknown>,
      options: unknown
    ) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead", timeout: 30_000 });
      return work({
        trackingContext: {
          findFirst: async ({ where }: { where: unknown }) => {
            assert.deepEqual(where, {
              id: trackingContextId,
              workspaceId: foreignWorkspaceId,
              projectId
            });
            return null;
          }
        },
        trackingContextKeywordAssignment: {
          findMany: async () => {
            assignmentRead = true;
            return [];
          }
        }
      });
    }
  } as unknown as PrismaService);

  await assert.rejects(
    () =>
      service.calculate({
        ...command,
        workspaceId: foreignWorkspaceId
      }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 404
  );
  assert.equal(assignmentRead, false);
});

function scopeService(
  contextRow: ReturnType<typeof context>,
  assignments: ReturnType<typeof assignment>[],
  observed: unknown[] = []
): RankScopeService {
  return new RankScopeService({
    $transaction: async (
      work: (transaction: unknown) => Promise<unknown>,
      options: unknown
    ) => {
      observed.push(options);
      return work({
        $queryRaw: async (strings: TemplateStringsArray) => {
          if (strings.join("").includes("rank_scope_plan")) return [{ assignmentCount: Math.min(5000, assignments.length), nestedLoops: "on", jit: "on", statementTimeout: "0" }];
          if (strings.join("").includes("set_config")) return [];
          assert.match(
            strings.join(""),
            /CASE[\s\S]*octet_length[\s\S]*THEN[\s\S]*ELSE char_length/u
          );
          const bounded = assignments.slice(0, 300_001);
          const characterCounts = bounded.map(
            ({ keyword }) => [...keyword.textOriginal].length
          );
          const byteCounts = bounded.map(({ keyword }) =>
            Buffer.byteLength(keyword.textOriginal, "utf8")
          );
          return [
            {
              assignmentCount: bounded.length,
              maxKeywordCharacters: characterCounts.reduce((max, count) => Math.max(max, count), 0),
              maxKeywordBytes: String(byteCounts.reduce((max, count) => Math.max(max, count), 0)),
              totalKeywordBytes: String(
                byteCounts.reduce((total, value) => total + value, 0)
              )
            }
          ];
        },
        trackingContext: {
          findFirst: async ({
            where
          }: {
            where: Readonly<Record<string, unknown>>;
          }) => {
            observed.push(where);
            return contextRow;
          }
        },
        trackingContextKeywordAssignment: {
          findMany: async ({
            where,
            orderBy,
            take
          }: {
            where: Readonly<Record<string, unknown>>;
            orderBy: unknown;
            take: number;
          }) => {
            observed.push(where);
            assert.deepEqual(orderBy, { keywordId: "asc" });
            assert.equal(take, 5_000);
            const cursor = (where.keywordId as { gt?: string } | undefined)?.gt;
            return [...assignments].filter(row => !cursor || row.keywordId > cursor).sort((left, right) =>
              left.keywordId < right.keywordId
                ? -1
                : left.keywordId > right.keywordId
                  ? 1
                  : 0
            ).slice(0, take);
          }
        }
      });
    }
  } as unknown as PrismaService);
}

function context(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    id: trackingContextId,
    workspaceId,
    projectId,
    status: "ACTIVE" as const,
    version: 5,
    configurations: [
      {
        configurationVersion: 3,
        configurationHash: "c".repeat(64),
        searchEngine: "GOOGLE" as const,
        countryCode: "US",
        regionCode: "us-ca",
        regionLabel: "California",
        language: "en",
        device: "DESKTOP" as const,
        depth: 30,
        domainMatchMode: "EXACT_HOST" as const,
        domainMatchValue: null,
        safeSearch: false
      }
    ],
    ...overrides
  };
}

function assignment(
  sequence: number,
  keywordOverrides: Readonly<Record<string, unknown>> = {}
) {
  const suffix = String(sequence).padStart(12, "0");
  const keywordSuffix = String(sequence + 2_000).padStart(12, "0");
  const keywordId = `01900000-0000-7000-8000-${keywordSuffix}`;
  return {
    id: `01900000-0000-7000-8000-${suffix}`,
    keywordId,
    keyword: {
      id: keywordId,
      version: 1,
      textOriginal: `Keyword ${sequence}`,
      language: "en",
      ...keywordOverrides
    }
  };
}

function availableScopeHash(value: {
  readonly availability: "AVAILABLE" | "UNAVAILABLE";
  readonly value?: string;
}): string {
  assert.equal(value.availability, "AVAILABLE");
  if (typeof value.value !== "string") {
    throw new Error("Expected an available semantic scope hash");
  }
  return value.value;
}
