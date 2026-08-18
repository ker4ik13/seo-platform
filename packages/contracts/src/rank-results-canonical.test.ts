import assert from "node:assert/strict";
import test from "node:test";
import * as rootContracts from "./index.js";
import {
  rankCheckFinalizationHash,
  rankCheckFinalizationHashPreimage,
  rankChunkIngestHash,
  rankChunkIngestHashPreimage,
  rankHistoryFilterHash,
  rankHistoryFilterHashPreimage
} from "./rank-results-canonical.js";
import {
  rankManifestChunkHashPreimage,
  type InternalRankManifestEntry,
  type InternalFinalizeRankCheckInput,
  type InternalRankChunkIngestCommand,
  type InternalRankManifestChunk
} from "./api/rank-runs.js";
import type { InternalRankHistoryQuery } from "./api/rank-history.js";
import {
  canonicalJsonSha256,
  utf8Sha256
} from "./canonical-json.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  otherActorId: "01900000-0000-7000-8000-000000000004",
  jobId: "01900000-0000-7000-8000-000000000005",
  jobItemId: "01900000-0000-7000-8000-000000000006",
  manifestId: "01900000-0000-7000-8000-000000000007",
  firstEntryId: "01900000-0000-7000-8000-000000000008",
  secondEntryId: "01900000-0000-7000-8000-000000000009",
  firstAssignmentId: "01900000-0000-7000-8000-000000000010",
  secondAssignmentId: "01900000-0000-7000-8000-000000000011",
  firstKeywordId: "01900000-0000-7000-8000-000000000012",
  secondKeywordId: "01900000-0000-7000-8000-000000000013",
  contextId: "01900000-0000-7000-8000-000000000014"
} as const;

const hash = (character: string) =>
  ({
    algorithm: "SHA_256",
    value: character.repeat(64)
  }) as const;

function sealedChunk(): InternalRankManifestChunk {
  const entries: readonly InternalRankManifestEntry[] = [
    {
      id: ids.firstEntryId,
      sequence: 0,
      assignmentId: ids.firstAssignmentId,
      keywordId: ids.firstKeywordId,
      keywordVersion: 2,
      keywordText: "first internal keyword",
      keywordTextHash: {
        algorithm: "SHA_256",
        value: utf8Sha256("first internal keyword")
      },
      language: "en"
    },
    {
      id: ids.secondEntryId,
      sequence: 1,
      assignmentId: ids.secondAssignmentId,
      keywordId: ids.secondKeywordId,
      keywordVersion: 3,
      keywordText: "second internal keyword",
      keywordTextHash: {
        algorithm: "SHA_256",
        value: utf8Sha256("second internal keyword")
      },
      language: "en"
    }
  ];
  const withoutHash = {
    hashSchemaVersion: "rank-manifest-chunk@1",
    manifestId: ids.manifestId,
    chunkIndex: 0,
    entries
  } as const;
  const chunkHash = {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(
      "rank-manifest-chunk@1",
      rankManifestChunkHashPreimage(withoutHash)
    )
  } as const;
  return {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    jobId: ids.jobId,
    manifestId: ids.manifestId,
    chunkIndex: 0,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash,
    entries
  };
}

function ingestCommand(): InternalRankChunkIngestCommand {
  return {
    schemaVersion: "rank-ingest@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    manifestId: ids.manifestId,
    chunkIndex: 0,
    manifestChunkHash: sealedChunk().chunkHash,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    providerRequestId: "arsenkin-task-42",
    connectorVersion: "arsenkin.positions.v1",
    observedAt: "2026-07-29T12:05:00.000Z",
    results: [
      {
        manifestEntryId: ids.firstEntryId,
        keywordId: ids.firstKeywordId,
        dataQualityFlags: [
          "PIXEL_POSITION_UNAVAILABLE",
          "ABSOLUTE_POSITION_UNAVAILABLE",
          "SNIPPET_UNAVAILABLE"
        ],
        found: true,
        position: 7,
        rankingUrl: "https://project.example/page",
        normalizedRankingUrl: "https://project.example/page",
        title: "Example",
        resultType: "ORGANIC",
        serpFeatures: []
      },
      {
        manifestEntryId: ids.secondEntryId,
        keywordId: ids.secondKeywordId,
        dataQualityFlags: ["PROVIDER_OBSERVED_AT_UNAVAILABLE"],
        found: false,
        position: null
      }
    ]
  };
}

function rehashChunk(
  chunk: InternalRankManifestChunk
): InternalRankManifestChunk {
  return {
    ...chunk,
    chunkHash: {
      algorithm: "SHA_256",
      value: canonicalJsonSha256(
        "rank-manifest-chunk@1",
        rankManifestChunkHashPreimage(chunk)
      )
    }
  };
}

test("rank result hash builders stay on the explicit server-only subpath", () => {
  assert.equal("rankChunkIngestHash" in rootContracts, false);
  assert.equal("rankCheckFinalizationHash" in rootContracts, false);
  assert.equal("rankHistoryFilterHash" in rootContracts, false);
});

test("ingest preimage is exact, complete, sealed-order and canonically flagged", () => {
  const preimage = rankChunkIngestHashPreimage(
    ingestCommand(),
    sealedChunk()
  );

  assert.deepEqual(Object.keys(preimage), [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "jobItemId",
    "manifestId",
    "chunkIndex",
    "manifestChunkHash",
    "provider",
    "operation",
    "providerRequestId",
    "connectorVersion",
    "observedAt",
    "results"
  ]);
  assert.deepEqual(preimage.results[0]?.dataQualityFlags, [
    "ABSOLUTE_POSITION_UNAVAILABLE",
    "PIXEL_POSITION_UNAVAILABLE",
    "SNIPPET_UNAVAILABLE"
  ]);
  assert.equal(preimage.results[0]?.manifestEntryId, ids.firstEntryId);
  assert.equal(preimage.results[1]?.manifestEntryId, ids.secondEntryId);
  assert.equal("ingestEnvelopeHash" in preimage, false);
  assert.equal("keywordText" in preimage.results[0]!, false);
  assert.equal("rawProviderResponse" in preimage, false);

  assert.equal(
    rankChunkIngestHash(ingestCommand(), sealedChunk()).value,
    "88c5695256ade147eafa0cb16f9b563f34487bf64d0f05b4bf86171b0c14ff79"
  );
});

test("accepts the sealed execution connector version vocabulary", () => {
  const command = {
    ...ingestCommand(),
    connectorVersion: "arsenkin-positions@1.0.0"
  };
  assert.equal(
    rankChunkIngestHashPreimage(command, sealedChunk())
      .connectorVersion,
    "arsenkin-positions@1.0.0"
  );
});

test("accepts canonical XMLStock position ingest commands", () => {
  const baseChunk = sealedChunk();
  const firstEntry = baseChunk.entries[0];
  const firstResult = ingestCommand().results[0];
  if (!firstEntry || !firstResult) {
    throw new Error("Fixture is invalid");
  }
  const chunk = rehashChunk({
    ...baseChunk,
    entries: [firstEntry]
  });
  const command = {
    ...ingestCommand(),
    manifestChunkHash: chunk.chunkHash,
    provider: "XMLSTOCK",
    providerRequestId: "xmlstock-task-42",
    connectorVersion: "xmlstock-serp@1",
    results: [firstResult]
  } satisfies InternalRankChunkIngestCommand;

  assert.equal(
    rankChunkIngestHashPreimage(command, chunk).provider,
    "XMLSTOCK"
  );
  assert.equal(
    rankChunkIngestHash(command, chunk).algorithm,
    "SHA_256"
  );
});

test("canonicalizes a bounded ordered SERP evidence set", () => {
  const baseChunk = sealedChunk();
  const firstEntry = baseChunk.entries[0]!;
  const firstResult = ingestCommand().results[0]!;
  if (!firstResult.found) throw new Error("Fixture is invalid");
  const chunk = rehashChunk({ ...baseChunk, entries: [firstEntry] });
  const command = {
    ...ingestCommand(),
    manifestChunkHash: chunk.chunkHash,
    provider: "XMLSTOCK",
    providerRequestId: "xmlstock-task-with-serp",
    connectorVersion: "xmlstock-serp@1",
    results: [{
      ...firstResult,
      serpResults: [
        {
          position: 1,
          rankingUrl: "https://competitor.example/",
          normalizedRankingUrl: "https://competitor.example/",
          faviconUrl: "https://search-assets.example/competitor.png",
          title: "Competitor"
        },
        {
          position: 2,
          rankingUrl: "https://project.example/page",
          normalizedRankingUrl: "https://project.example/page"
        }
      ]
    }]
  } satisfies InternalRankChunkIngestCommand;

  assert.equal(
    rankChunkIngestHashPreimage(command, chunk).results[0]?.serpResults?.length,
    2
  );
  assert.equal(
    rankChunkIngestHashPreimage(command, chunk).results[0]?.serpResults?.[0]
      ?.faviconUrl,
    "https://search-assets.example/competitor.png"
  );
  const resultWithSerp = command.results[0];
  if (!resultWithSerp?.found || !resultWithSerp.serpResults) {
    throw new Error("Fixture is invalid");
  }
  assert.throws(
    () => rankChunkIngestHashPreimage({
      ...command,
      results: [{
        ...resultWithSerp,
        serpResults: resultWithSerp.serpResults.map((result) => ({
          ...result,
          position: 2
        }))
      }]
    }, chunk),
    /Invalid canonical rank result field: serpResult\.position/u
  );
});

test("accepts XMLStock per-keyword chunks after the first chunk", () => {
  const baseChunk = sealedChunk();
  const firstEntry = baseChunk.entries[0];
  const firstResult = ingestCommand().results[0];
  if (!firstEntry || !firstResult) {
    throw new Error("Fixture is invalid");
  }
  const chunk = rehashChunk({
    ...baseChunk,
    chunkIndex: 1,
    entries: [{ ...firstEntry, sequence: 1 }]
  });
  const command = {
    ...ingestCommand(),
    chunkIndex: 1,
    manifestChunkHash: chunk.chunkHash,
    provider: "XMLSTOCK",
    providerRequestId: "xmlstock-task-43",
    connectorVersion: "xmlstock-serp@1",
    results: [firstResult]
  } satisfies InternalRankChunkIngestCommand;

  assert.equal(
    rankChunkIngestHashPreimage(command, chunk).chunkIndex,
    1
  );
});

test("accepts TOP-100 and rejects positions outside the persisted contract", () => {
  const command = ingestCommand();
  const found = command.results[0];
  assert.equal(found?.found, true);
  if (found?.found !== true) {
    throw new Error("Fixture is invalid");
  }
  const top100 = {
    ...command,
    results: [
      { ...found, position: 100 },
      command.results[1]!
    ]
  } satisfies InternalRankChunkIngestCommand;

  assert.equal(
    rankChunkIngestHashPreimage(top100, sealedChunk()).results[0]
      ?.position,
    100
  );
  assert.throws(
    () =>
      rankChunkIngestHashPreimage(
        {
          ...top100,
          results: [
            { ...found, position: 101 },
            command.results[1]!
          ]
        },
        sealedChunk()
      ),
    /Invalid canonical rank result field: foundResult/u
  );
});

test("equivalent quality-flag order has one ingest hash", () => {
  const first = ingestCommand();
  const second = ingestCommand();
  const firstResult = second.results[0];
  assert.equal(firstResult?.found, true);
  if (firstResult?.found !== true) {
    throw new Error("Fixture is invalid");
  }
  const reordered = {
    ...second,
    results: [
      {
        ...firstResult,
        dataQualityFlags: [...firstResult.dataQualityFlags].reverse()
      },
      second.results[1]!
    ]
  } satisfies InternalRankChunkIngestCommand;

  assert.deepEqual(
    rankChunkIngestHash(first, sealedChunk()),
    rankChunkIngestHash(reordered, sealedChunk())
  );
});

test("ingest hash fails closed on incomplete, reordered, foreign and extra data", () => {
  const command = ingestCommand();
  const chunk = sealedChunk();
  const cases = [
    {
      ...command,
      results: command.results.slice(0, 1)
    },
    {
      ...command,
      results: [command.results[1]!, command.results[0]!]
    },
    {
      ...command,
      manifestChunkHash: hash("d")
    },
    {
      ...command,
      workspaceId:
        "0190000a-0000-7000-8000-000000000001".toUpperCase()
    },
    {
      ...command,
      rawProviderResponse: "must never be outside the hash allowlist"
    }
  ];

  for (const value of cases) {
    assert.throws(
      () =>
        rankChunkIngestHashPreimage(
          value as InternalRankChunkIngestCommand,
          chunk
        ),
      /Invalid canonical rank result field/u
    );
  }
});

test("ingest validates the sealed chunk integrity and bounded entry evidence", () => {
  const command = ingestCommand();
  const chunk = sealedChunk();
  const forgedHash = hash("d");
  assert.throws(
    () =>
      rankChunkIngestHashPreimage(
        {
          ...command,
          manifestChunkHash: forgedHash
        },
        {
          ...chunk,
          chunkHash: forgedHash
        }
      ),
    /Invalid canonical rank result field: sealedChunk\.chunkHash/u
  );

  const firstEntry = chunk.entries[0]!;
  for (const invalidEntry of [
    {
      ...firstEntry,
      sequence: 1
    },
    {
      ...firstEntry,
      keywordText: `${firstEntry.keywordText} changed`
    },
    {
      ...firstEntry,
      keywordText: "x".repeat(501),
      keywordTextHash: {
        algorithm: "SHA_256" as const,
        value: utf8Sha256("x".repeat(501))
      }
    },
    {
      ...firstEntry,
      language: "EN"
    }
  ]) {
    const invalidChunk = rehashChunk({
      ...chunk,
      entries: [invalidEntry, chunk.entries[1]!]
    });
    assert.throws(
      () =>
        rankChunkIngestHashPreimage(
          {
            ...command,
            manifestChunkHash: invalidChunk.chunkHash
          },
          invalidChunk
        ),
      /Invalid canonical rank result field: manifestEntry/u
    );
  }
});

test("ingest and history mechanics reject coerced scalar values", () => {
  assert.throws(
    () =>
      rankChunkIngestHashPreimage(
        {
          ...ingestCommand(),
          providerRequestId: 42
        } as unknown as InternalRankChunkIngestCommand,
        sealedChunk()
      ),
    /Invalid canonical rank result field: command/u
  );

  assert.throws(
    () =>
      rankHistoryFilterHashPreimage({
        workspaceId: ids.workspaceId,
        projectId: ids.projectId,
        actorId: ids.actorId,
        observedFrom: "2026-07-01T00:00:00.000Z",
        observedBefore: "2026-08-01T00:00:00.000Z",
        limit: 25,
        cursor: 42
      } as unknown as InternalRankHistoryQuery),
    /Invalid canonical rank result field: historyQuery/u
  );
});

test("ingest quality flags are an exact projection of optional fields", () => {
  const command = ingestCommand();
  const found = command.results[0];
  const notFound = command.results[1];
  if (found?.found !== true || notFound?.found !== false) {
    throw new Error("Fixture is invalid");
  }

  for (const firstResult of [
    {
      ...found,
      dataQualityFlags: found.dataQualityFlags.filter(
        (flag) => flag !== "SNIPPET_UNAVAILABLE"
      )
    },
    {
      ...found,
      absolutePosition: 7
    }
  ]) {
    assert.throws(
      () =>
        rankChunkIngestHashPreimage(
          {
            ...command,
            results: [firstResult, notFound]
          } as InternalRankChunkIngestCommand,
          sealedChunk()
        ),
      /Invalid canonical rank result field/u
    );
  }

  assert.throws(
    () =>
      rankChunkIngestHashPreimage(
        {
          ...command,
          results: [
            found,
            {
              ...notFound,
              dataQualityFlags: ["ABSOLUTE_POSITION_UNAVAILABLE"]
            }
          ]
        },
        sealedChunk()
      ),
    /Invalid canonical rank result field/u
  );
});

test("finalize hash is exact and actor-independent", () => {
  const input = {
    schemaVersion: "rank-finalize@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    manifestId: ids.manifestId,
    status: "PARTIALLY_COMPLETED"
  } as const satisfies InternalFinalizeRankCheckInput;
  const preimage = rankCheckFinalizationHashPreimage(input);

  assert.deepEqual(Object.keys(preimage), [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "jobId",
    "manifestId",
    "status"
  ]);
  assert.equal("actorId" in preimage, false);
  assert.equal("persistedCount" in preimage, false);
  assert.deepEqual(
    rankCheckFinalizationHash(input),
    rankCheckFinalizationHash({
      ...input,
      actorId: ids.otherActorId
    })
  );
  assert.equal(
    rankCheckFinalizationHash(input).value,
    "9d74323c1b74fed5286c2649d9d6e851887e9b13b6c402b0ba48507225b8806a"
  );
  assert.throws(
    () =>
      rankCheckFinalizationHash({
        ...input,
        persistedCount: "1"
      } as InternalFinalizeRankCheckInput),
    /Invalid canonical rank result field/u
  );
});

test("history filter hash binds tenant/range/filters but not cursor mechanics", () => {
  const query = {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    observedFrom: "2026-07-01T00:00:00.000Z",
    observedBefore: "2026-08-01T00:00:00.000Z",
    trackingContextId: ids.contextId,
    keywordId: ids.firstKeywordId,
    limit: 200,
    cursor: "opaque-cursor-one"
  } satisfies InternalRankHistoryQuery;
  const preimage = rankHistoryFilterHashPreimage(query);

  assert.deepEqual(Object.keys(preimage), [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "observedFrom",
    "observedBefore",
    "trackingContextId",
    "keywordId"
  ]);
  assert.equal("actorId" in preimage, false);
  assert.equal("limit" in preimage, false);
  assert.equal("cursor" in preimage, false);
  assert.deepEqual(
    rankHistoryFilterHash(query),
    rankHistoryFilterHash({
      ...query,
      actorId: ids.otherActorId,
      limit: 25,
      cursor: "opaque-cursor-two"
    })
  );
  assert.equal(
    rankHistoryFilterHash(query).value,
    "a1e71da17e413ada15ee2604bdee0076cb2428a1beb5bd6331db00a41a3b7656"
  );
  assert.throws(
    () =>
      rankHistoryFilterHash({
        ...query,
        observedFrom: query.observedBefore
      }),
    /Invalid canonical rank result field/u
  );
});
