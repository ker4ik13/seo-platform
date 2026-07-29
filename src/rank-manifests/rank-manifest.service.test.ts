import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type { InternalSealRankManifestInput } from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import { semanticRankScopeHash } from "../rank-scopes/rank-scope-hash.js";
import { RankManifestService } from "./rank-manifest.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const estimateId = "01900000-0000-7000-8000-000000000005";
const trackingContextId =
  "01900000-0000-7000-8000-000000000006";
const manifestId = "01900000-0000-7000-8000-000000000007";
const sealedAt = new Date("2026-07-29T12:00:00.000Z");

test("atomically seals immutable header, chunks and keyword snapshots", async () => {
  const harness = manifestHarness();
  const service = new RankManifestService(harness.prisma);
  const input = command(harness.context, harness.assignments);

  const result = await service.seal(input);

  assert.deepEqual(harness.transactionOptions, [
    {
      isolationLevel: "RepeatableRead",
      maxWait: 5_000,
      timeout: 30_000
    }
  ]);
  assert.equal(harness.lockCalls, 1);
  assert.equal(harness.scopeReads, 1);
  assert.equal(harness.manifestWrites, 1);
  assert.equal(result.id, manifestId);
  assert.equal(result.pairCount, "2");
  assert.equal(result.chunkCount, "1");
  assert.equal(result.chunkSize, "250");
  assert.equal(result.status, "SEALED");
  assert.match(result.manifestHash.value, /^[0-9a-f]{64}$/u);
  assert.match(result.deduplicationHash.value, /^[0-9a-f]{64}$/u);
  assert.notEqual(
    result.manifestHash.value,
    result.deduplicationHash.value
  );
  assert.equal(
    result.manifestHash.value,
    "965957cbd8dfd14230912e1b001f3aa62bd3219c6e7eb2680ba998f8fe4fe290"
  );
  assert.equal(
    result.deduplicationHash.value,
    "791944cbf7617829c7f61d8a8ff51a015d0c20b2e2072efac160ef2da0cba3be"
  );
  assert.doesNotMatch(JSON.stringify(result), /Keyword 1/u);
  assert.equal(harness.storedChunks.length, 1);
  assert.equal(harness.storedChunks[0]?.entryCount, 2);
  assert.equal(
    Buffer.from(
      harness.storedChunks[0]?.chunkHash as Uint8Array
    ).toString("hex"),
    "cef4e30fbc11ef7875de6633f9a56e7dcd3c60e04f19dec232d939bdf6af1e0d"
  );
  assert.equal(harness.storedEntries.length, 2);
  assert.equal(harness.storedEntries[0]?.keywordText, "Keyword 1");
  assert.equal(
    Buffer.from(
      harness.storedEntries[0]?.keywordTextHash as Uint8Array
    ).length,
    32
  );
  assert.deepEqual(harness.assignmentWhere, {
    workspaceId,
    projectId,
    contextId: trackingContextId,
    removedAt: null,
    keyword: { status: "ACTIVE" }
  });
});

test("exact replay returns the original seal before mutable scope reads", async () => {
  const harness = manifestHarness();
  const service = new RankManifestService(harness.prisma);
  const input = command(harness.context, harness.assignments);
  const first = await service.seal(input);
  harness.context.status = "ARCHIVED";

  const replay = await service.seal(input);

  assert.deepEqual(replay, first);
  assert.equal(harness.scopeReads, 1);
  assert.equal(harness.manifestWrites, 1);

  await assert.rejects(
    () =>
      service.seal({
        ...input,
        estimateId:
          "01900000-0000-7000-8000-000000000099"
      }),
    (error: unknown) =>
      hasError(error, 409, "IDEMPOTENCY_CONFLICT")
  );
  assert.equal(harness.scopeReads, 1);
});

test("exact replay reconstructs the immutable seal after lifecycle close", async () => {
  const harness = manifestHarness();
  const service = new RankManifestService(harness.prisma);
  const input = command(harness.context, harness.assignments);
  const first = await service.seal(input);
  harness.closeManifest(new Date("2026-07-29T12:10:00.000Z"));

  const replay = await service.seal(input);

  assert.deepEqual(replay, first);
  assert.equal(replay.status, "SEALED");
  assert.equal(harness.scopeReads, 1);
});

test("rejects a different active job with the same semantic scope", async () => {
  const harness = manifestHarness();
  const service = new RankManifestService(harness.prisma);
  const firstInput = command(harness.context, harness.assignments);
  await service.seal(firstInput);

  await assert.rejects(
    () =>
      service.seal({
        ...firstInput,
        jobId: "01900000-0000-7000-8000-000000000090",
        estimateId: "01900000-0000-7000-8000-000000000091"
      }),
    (error: unknown) =>
      hasError(error, 409, "EQUIVALENT_RUN_ACTIVE")
  );

  assert.equal(harness.manifestWrites, 1);
});

test("exact replay fails closed when persisted chunk integrity drifts", async () => {
  const harness = manifestHarness();
  const service = new RankManifestService(harness.prisma);
  const input = command(harness.context, harness.assignments);
  await service.seal(input);

  harness.storedChunks[0]!.chunkHash = Uint8Array.from(
    { length: 32 },
    () => 0
  );

  await assert.rejects(
    () => service.seal(input),
    /Stored rank manifest hash is invalid/u
  );
});

test("semantic dedup excludes run IDs and non-execution revisions", async () => {
  const firstHarness = manifestHarness();
  const reassigned = [
    assignment(1),
    assignment(2)
  ].map((row, index) => ({
    ...row,
    id: `01900000-0000-7000-8000-${String(8_000 + index).padStart(12, "0")}`,
    keyword: {
      ...row.keyword,
      version: row.keyword.version + 10
    }
  })).reverse();
  const secondHarness = manifestHarness({
    manifestId: "01900000-0000-7000-8000-000000000080",
    sealedAt: new Date("2026-07-29T12:05:00.000Z"),
    entryIdOffset: 80,
    assignments: reassigned
  });
  secondHarness.context.version += 1;
  secondHarness.context.id =
    "01900000-0000-7000-8000-000000000095";
  secondHarness.context.configurations[0]!.configurationVersion += 1;
  secondHarness.context.configurations[0]!.configurationHash =
    "f".repeat(64);
  const firstInput = command(
    firstHarness.context,
    firstHarness.assignments
  );
  const secondInput = {
    ...command(secondHarness.context, secondHarness.assignments),
    actorId: "01900000-0000-7000-8000-000000000090",
    jobId: "01900000-0000-7000-8000-000000000091",
    estimateId: "01900000-0000-7000-8000-000000000092",
    project: {
      ...command(secondHarness.context, secondHarness.assignments)
        .project,
      version: 99
    },
    estimate: {
      ...command(secondHarness.context, secondHarness.assignments)
        .estimate,
      scopeHash: hash("d".repeat(64))
    }
  } as const;

  const first = await new RankManifestService(
    firstHarness.prisma
  ).seal(firstInput);
  const second = await new RankManifestService(
    secondHarness.prisma
  ).seal(secondInput);

  assert.equal(
    first.deduplicationHash.value,
    second.deduplicationHash.value
  );
  assert.notEqual(first.manifestHash.value, second.manifestHash.value);
});

test("rejects current project, context, configuration and scope drift", async () => {
  const archived = manifestHarness();
  archived.context.status = "ARCHIVED";
  await rejectsAsStale(archived);

  const changedConfiguration = manifestHarness();
  const input = command(
    changedConfiguration.context,
    changedConfiguration.assignments
  );
  changedConfiguration.context.configurations[0]!.configurationVersion =
    3;
  await assert.rejects(
    () =>
      new RankManifestService(
        changedConfiguration.prisma
      ).seal(input),
    (error: unknown) => hasError(error, 409, "ESTIMATE_STALE")
  );
  assert.equal(changedConfiguration.manifestWrites, 0);

  const changedKeyword = manifestHarness();
  const staleInput = command(
    changedKeyword.context,
    changedKeyword.assignments
  );
  changedKeyword.assignments[0]!.keyword.textOriginal =
    "Changed after estimate";
  await assert.rejects(
    () =>
      new RankManifestService(changedKeyword.prisma).seal(staleInput),
    (error: unknown) => hasError(error, 409, "ESTIMATE_STALE")
  );

  const incompatibleExecution = manifestHarness();
  const incompatibleInput = {
    ...command(
      incompatibleExecution.context,
      incompatibleExecution.assignments
    ),
    execution: {
      ...command(
        incompatibleExecution.context,
        incompatibleExecution.assignments
      ).execution,
      safeSearch: true
    }
  } as const;
  await assert.rejects(
    () =>
      new RankManifestService(
        incompatibleExecution.prisma
      ).seal(incompatibleInput),
    (error: unknown) => hasError(error, 409, "ESTIMATE_STALE")
  );
});

test("rejects provider-incompatible keyword text before materializing scope rows", async () => {
  const source = assignment(1);
  const oversized = manifestHarness({
    assignments: [
      {
        ...source,
        keyword: {
          ...source.keyword,
          textOriginal: "я".repeat(501)
        }
      }
    ]
  });

  await assert.rejects(
    () =>
      new RankManifestService(oversized.prisma).seal(
        command(oversized.context, oversized.assignments)
      ),
    (error: unknown) => hasError(error, 409, "ESTIMATE_STALE")
  );

  assert.equal(oversized.assignmentWhere, undefined);
  assert.equal(oversized.manifestWrites, 0);
});

test("keeps a foreign tenant indistinguishable from a missing context", async () => {
  const harness = manifestHarness();
  harness.contextResult = null;
  const service = new RankManifestService(harness.prisma);

  await assert.rejects(
    () => service.seal(command(harness.context, harness.assignments)),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 404
  );
  assert.equal(harness.manifestWrites, 0);
});

test("reads only the requested tenant/job chunk and verifies its hashes", async () => {
  const harness = manifestHarness();
  const service = new RankManifestService(harness.prisma);
  const seal = await service.seal(
    command(harness.context, harness.assignments)
  );

  const chunk = await service.getChunk({
    workspaceId,
    projectId,
    jobId,
    manifestId: seal.id,
    chunkIndex: 0
  });

  assert.equal(chunk.entries.length, 2);
  assert.equal(chunk.entries[0]?.keywordText, "Keyword 1");
  assert.equal(chunk.entries[1]?.sequence, 1);
  assert.deepEqual(harness.chunkWhere, {
    workspaceId,
    projectId,
    manifestId: seal.id,
    chunkIndex: 0,
    manifest: {
      jobId,
      status: "SEALED"
    }
  });

  await assert.rejects(
    () =>
      service.getChunk({
        workspaceId,
        projectId,
        jobId: "01900000-0000-7000-8000-000000000099",
        manifestId: seal.id,
        chunkIndex: 0
      }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 404
  );

  harness.storedEntries[0]!.keywordText = "tampered";
  await assert.rejects(
    () =>
      service.getChunk({
        workspaceId,
        projectId,
        jobId,
        manifestId: seal.id,
        chunkIndex: 0
      }),
    /keyword hash is invalid/u
  );
});

test("chunks 251 snapshots into a bounded 250 + 1 read", async () => {
  const assignments = Array.from({ length: 251 }, (_, index) =>
    assignment(index + 1)
  );
  const harness = manifestHarness({ assignments, entryIdOffset: 1_000 });
  const service = new RankManifestService(harness.prisma);
  const seal = await service.seal(
    command(harness.context, harness.assignments)
  );

  assert.equal(seal.chunkCount, "2");
  assert.deepEqual(
    harness.storedChunks.map((chunk) => chunk.entryCount),
    [250, 1]
  );
  const first = await service.getChunk({
    workspaceId,
    projectId,
    jobId,
    manifestId: seal.id,
    chunkIndex: 0
  });
  const second = await service.getChunk({
    workspaceId,
    projectId,
    jobId,
    manifestId: seal.id,
    chunkIndex: 1
  });
  assert.equal(first.entries.length, 250);
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0]?.sequence, 250);
});

async function rejectsAsStale(
  harness: ReturnType<typeof manifestHarness>
): Promise<void> {
  await assert.rejects(
    () =>
      new RankManifestService(harness.prisma).seal(
        command(harness.context, harness.assignments)
      ),
    (error: unknown) => hasError(error, 409, "ESTIMATE_STALE")
  );
  assert.equal(harness.manifestWrites, 0);
}

function hasError(
  error: unknown,
  status: number,
  code: string
): boolean {
  if (!(error instanceof HttpException) || error.getStatus() !== status) {
    return false;
  }
  const response = error.getResponse();
  return (
    typeof response === "object" &&
    response !== null &&
    "error" in response &&
    typeof response.error === "object" &&
    response.error !== null &&
    "code" in response.error &&
    response.error.code === code
  );
}

function command(
  context: ReturnType<typeof trackingContext>,
  assignments: ReturnType<typeof assignment>[]
): InternalSealRankManifestInput {
  const configuration = context.configurations[0]!;
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    estimateId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    estimate: {
      trackingContextId: context.id,
      contextVersion: context.version,
      configurationVersion: configuration.configurationVersion,
      configurationHash: hash(configuration.configurationHash),
      semanticScopeHash: hash(
        semanticRankScopeHash(context, configuration, assignments)
      ),
      scopeHash: hash("c".repeat(64)),
      pairCount: String(assignments.length)
    },
    execution: {
      searchEngine: "GOOGLE",
      countryCode: configuration.countryCode,
      language: configuration.language,
      device: configuration.device,
      depth: 30,
      domainMatchRule: { mode: "EXACT_HOST" },
      safeSearch: configuration.safeSearch,
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE",
      providerMappingVersion: "arsenkin-positions@1"
    },
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    }
  };
}

function hash(value: string) {
  return {
    algorithm: "SHA_256" as const,
    value
  };
}

function trackingContext() {
  return {
    id: trackingContextId,
    workspaceId,
    projectId,
    status: "ACTIVE" as "ACTIVE" | "ARCHIVED",
    version: 3,
    configurations: [
      {
        configurationVersion: 2,
        configurationHash: "a".repeat(64),
        searchEngine: "GOOGLE" as const,
        countryCode: "US",
        regionCode: null,
        language: "en",
        device: "DESKTOP" as const,
        depth: 30,
        domainMatchMode: "EXACT_HOST" as const,
        domainMatchValue: null,
        safeSearch: false
      }
    ]
  };
}

function assignment(sequence: number) {
  const assignmentSuffix = String(sequence + 2_000).padStart(12, "0");
  const keywordSuffix = String(sequence + 4_000).padStart(12, "0");
  return {
    id: `01900000-0000-7000-8000-${assignmentSuffix}`,
    keywordId: `01900000-0000-7000-8000-${keywordSuffix}`,
    keyword: {
      version: 1,
      textOriginal: `Keyword ${sequence}`,
      language: "en"
    }
  };
}

function manifestHarness(
  options: {
    readonly manifestId?: string;
    readonly sealedAt?: Date;
    readonly entryIdOffset?: number;
    readonly assignments?: ReturnType<typeof assignment>[];
  } = {}
) {
  const context = trackingContext();
  const assignments = [
    ...(options.assignments ?? [assignment(1), assignment(2)])
  ].sort((left, right) =>
    left.keywordId < right.keywordId
      ? -1
      : left.keywordId > right.keywordId
        ? 1
        : 0
  );
  const allocatedManifestId = options.manifestId ?? manifestId;
  const allocatedSealedAt = options.sealedAt ?? sealedAt;
  const entryIdOffset = options.entryIdOffset ?? 20;
  const storedChunks: Array<Record<string, unknown>> = [];
  const storedEntries: Array<Record<string, unknown>> = [];
  let storedManifest: Record<string, unknown> | undefined;
  let contextResult: ReturnType<typeof trackingContext> | null = context;
  let lockCalls = 0;
  let scopeReads = 0;
  let manifestWrites = 0;
  let assignmentWhere: unknown;
  let chunkWhere: unknown;
  const transactionOptions: unknown[] = [];

  const manifestRecord = (): Record<string, unknown> | null =>
    storedManifest
      ? {
          ...storedManifest,
          chunks: storedChunks
            .map((chunk) => ({
              chunkIndex: chunk.chunkIndex,
              hashSchemaVersion: chunk.hashSchemaVersion,
              chunkHash: chunk.chunkHash,
              entryCount: chunk.entryCount
            }))
            .sort(
              (left, right) =>
                Number(left.chunkIndex) - Number(right.chunkIndex)
            )
        }
      : null;

  const findManifest = (
    where: Readonly<Record<string, unknown>>,
    select: Readonly<Record<string, unknown>>
  ) => {
    const record = manifestRecord();
    if (!record) return null;
    const excluded = where.NOT as
      | Readonly<Record<string, unknown>>
      | undefined;
    const expectedDeduplicationHash = where.deduplicationHash;
    if (
      (where.workspaceId !== undefined &&
        where.workspaceId !== record.workspaceId) ||
      (where.projectId !== undefined &&
        where.projectId !== record.projectId) ||
      (where.jobId !== undefined && where.jobId !== record.jobId) ||
      (where.provider !== undefined &&
        where.provider !== record.provider) ||
      (where.status !== undefined && where.status !== record.status) ||
      (excluded?.jobId !== undefined &&
        excluded.jobId === record.jobId) ||
      (expectedDeduplicationHash instanceof Uint8Array &&
        !Buffer.from(expectedDeduplicationHash).equals(
          Buffer.from(record.deduplicationHash as Uint8Array)
        ))
    ) {
      return null;
    }
    return Object.keys(select).length === 1 && select.jobId === true
      ? { jobId: record.jobId }
      : record;
  };

  const chunkRecord = (where: Record<string, unknown>) => {
    chunkWhere = where;
    if (!storedManifest) return null;
    const manifestFilter = where.manifest as
      | Readonly<Record<string, unknown>>
      | undefined;
    if (
      where.workspaceId !== workspaceId ||
      where.projectId !== projectId ||
      where.manifestId !== storedManifest.id ||
      manifestFilter?.jobId !== storedManifest.jobId ||
      manifestFilter?.status !== storedManifest.status
    ) {
      return null;
    }
    const selected = storedChunks.find(
      (chunk) => chunk.chunkIndex === where.chunkIndex
    );
    if (!selected) return null;
    return {
      ...selected,
      manifest: {
        jobId: storedManifest.jobId,
        chunkCount: storedManifest.chunkCount,
        status: storedManifest.status
      },
      entries: storedEntries
        .filter(
          (entry) => entry.chunkIndex === selected.chunkIndex
        )
        .sort(
          (left, right) =>
            Number(left.sequence) - Number(right.sequence)
        )
    };
  };

  const transaction = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes("pg_advisory_xact_lock")) {
        lockCalls += 1;
        assert.match(sql, /statement_timestamp\(\)/u);
        return [{ snapshotAt: allocatedSealedAt }];
      }
      if (sql.includes("bounded_rank_scope")) {
        assert.match(
          sql,
          /CASE[\s\S]*octet_length[\s\S]*THEN[\s\S]*ELSE char_length/u
        );
        const bounded = assignments.slice(0, 1_001);
        const characterCounts = bounded.map(
          ({ keyword }) => [...keyword.textOriginal].length
        );
        const byteCounts = bounded.map(({ keyword }) =>
          Buffer.byteLength(keyword.textOriginal, "utf8")
        );
        return [
          {
            assignmentCount: bounded.length,
            maxKeywordCharacters: Math.max(0, ...characterCounts),
            maxKeywordBytes: String(Math.max(0, ...byteCounts)),
            totalKeywordBytes: String(
              byteCounts.reduce((total, value) => total + value, 0)
            )
          }
        ];
      }
      assert.match(sql, /uuidv7\(\)/u);
      assert.doesNotMatch(sql, /timestamp\(\)/u);
      return [
        {
          manifestId: allocatedManifestId,
          entryIds: assignments.map((_, index) => {
            const suffix = String(entryIdOffset + index).padStart(12, "0");
            return `01900000-0000-7000-8000-${suffix}`;
          })
        }
      ];
    },
    rankExecutionManifest: {
      findFirst: async ({
        where,
        select
      }: {
        where: Readonly<Record<string, unknown>>;
        select: Readonly<Record<string, unknown>>;
      }) => findManifest(where, select),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        manifestWrites += 1;
        storedManifest = { ...data, closedAt: null };
        return data;
      },
      update: async ({
        where,
        data
      }: {
        where: Readonly<Record<string, unknown>>;
        data: Readonly<Record<string, unknown>>;
      }) => {
        assert.deepEqual(where, { id: allocatedManifestId });
        assert.deepEqual(data, { status: "SEALED" });
        if (!storedManifest || storedManifest.status !== "BUILDING") {
          throw new Error("Manifest is not building");
        }
        storedManifest.status = "SEALED";
        return storedManifest;
      }
    },
    trackingContext: {
      findFirst: async () => {
        scopeReads += 1;
        return contextResult;
      }
    },
    trackingContextKeywordAssignment: {
      findMany: async ({
        where,
        orderBy,
        take
      }: {
        where: unknown;
        orderBy: unknown;
        take: number;
      }) => {
        assignmentWhere = where;
        assert.deepEqual(orderBy, { keywordId: "asc" });
        assert.equal(take, 1_001);
        return [...assignments];
      }
    },
    rankExecutionManifestChunk: {
      createMany: async ({
        data
      }: {
        data: Array<Record<string, unknown>>;
      }) => {
        storedChunks.push(...data.map((row) => ({ ...row })));
        return { count: data.length };
      }
    },
    rankExecutionManifestEntry: {
      createMany: async ({
        data
      }: {
        data: Array<Record<string, unknown>>;
      }) => {
        storedEntries.push(...data.map((row) => ({ ...row })));
        return { count: data.length };
      }
    }
  };
  const prisma = {
    $transaction: async (
      work: (value: unknown) => Promise<unknown>,
      optionsValue: unknown
    ) => {
      transactionOptions.push(optionsValue);
      return work(transaction);
    },
    rankExecutionManifest: {
      findFirst: async ({
        where,
        select
      }: {
        where: Readonly<Record<string, unknown>>;
        select: Readonly<Record<string, unknown>>;
      }) => findManifest(where, select)
    },
    rankExecutionManifestChunk: {
      findFirst: async ({
        where
      }: {
        where: Record<string, unknown>;
      }) => chunkRecord(where)
    }
  } as unknown as PrismaService;

  return {
    prisma,
    context,
    assignments,
    storedChunks,
    storedEntries,
    transactionOptions,
    get lockCalls() {
      return lockCalls;
    },
    get scopeReads() {
      return scopeReads;
    },
    get manifestWrites() {
      return manifestWrites;
    },
    get assignmentWhere() {
      return assignmentWhere;
    },
    get chunkWhere() {
      return chunkWhere;
    },
    closeManifest(closedAt: Date) {
      if (!storedManifest) throw new Error("Manifest is not sealed");
      storedManifest.status = "CLOSED";
      storedManifest.closedAt = closedAt;
    },
    set contextResult(value: ReturnType<typeof trackingContext> | null) {
      contextResult = value;
    }
  };
}
