import assert from "node:assert/strict";
import test from "node:test";
import {
  rankManifestChunkHashPreimage,
  type InternalRankManifestChunk,
  type InternalRankManifestEntry,
  type InternalSealRankManifestInput,
  type RankManifestHash
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  utf8Sha256
} from "@seo-platform/contracts/canonical-json";
import {
  buildRankProviderRequestIntent,
  rankProviderRequestIntent,
  rankProviderRequestIntentCanonicalJson,
  rankProviderRequestIntentHash,
  type RankProviderRequestIntentBuildInput,
  type RankProviderRequestIntentV1
} from "./rank-provider-request-intent.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  jobId: "01900000-0000-7000-8000-000000000004",
  jobItemId: "01900000-0000-7000-8000-000000000005",
  estimateId: "01900000-0000-7000-8000-000000000006",
  trackingContextId: "01900000-0000-7000-8000-000000000007",
  manifestId: "01900000-0000-7000-8000-000000000008",
  firstEntryId: "01900000-0000-7000-8000-000000000009",
  secondEntryId: "01900000-0000-7000-8000-000000000010",
  firstAssignmentId: "01900000-0000-7000-8000-000000000011",
  secondAssignmentId: "01900000-0000-7000-8000-000000000012",
  firstKeywordId: "01900000-0000-7000-8000-000000000013",
  secondKeywordId: "01900000-0000-7000-8000-000000000014"
} as const;

test("builds the exact secret-free adapter command and a JCS golden hash", () => {
  const intent = buildRankProviderRequestIntent(buildInput());
  const reparsed = rankProviderRequestIntent(
    JSON.parse(rankProviderRequestIntentCanonicalJson(intent))
  );

  assert.deepEqual(reparsed, intent);
  assert.deepEqual(intent.project, {
    domain: "example.com",
    version: 4
  });
  assert.deepEqual(intent.manifestChunk, {
    manifestId: ids.manifestId,
    chunkIndex: 0,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash: manifestChunk().chunkHash
  });
  assert.deepEqual(
    intent.keywords.map((keyword) => ({
      id: keyword.keywordId,
      text: keyword.keywordText,
      textHash: keyword.keywordTextHash,
      language: keyword.language
    })),
    [
      {
        id: ids.firstKeywordId,
        text: "seo платформа",
        textHash: textHash("seo платформа"),
        language: "ru"
      },
      {
        id: ids.secondKeywordId,
        text: "café rankings",
        textHash: textHash("café rankings"),
        language: "en"
      }
    ]
  );
  assert.equal(
    rankProviderRequestIntentHash(intent).value,
    "3b46942564e5dc6e4ad4f9f54f17ba94b3aaffad176ead53723b826e0971351f"
  );
});

test("canonical hash changes for every provider-significant projection", () => {
  const intent = buildRankProviderRequestIntent(buildInput());
  const baseline = rankProviderRequestIntentHash(intent).value;
  const changedValues: RankProviderRequestIntentV1[] = [
    {
      ...intent,
      project: { ...intent.project, domain: "www.example.com" }
    },
    {
      ...intent,
      project: { ...intent.project, version: 5 }
    },
    {
      ...intent,
      execution: {
        ...intent.execution,
        device: "MOBILE"
      }
    },
    {
      ...intent,
      manifest: {
        ...intent.manifest,
        manifestHash: hash("e")
      }
    },
    {
      ...intent,
      manifestChunk: {
        ...intent.manifestChunk,
        chunkHash: hash("f")
      }
    },
    {
      ...intent,
      executionConnectorVersion: "arsenkin-positions@1.0.1"
    }
  ];

  for (const changed of changedValues) {
    assert.notEqual(
      rankProviderRequestIntentHash(changed).value,
      baseline
    );
  }
  assert.throws(
    () =>
      rankProviderRequestIntentHash({
        ...intent,
        providerPolicyVersion: "manual-arsenkin-positions@1.0.1"
      }),
    /Invalid rank provider request intent/u
  );
});

test("rejects tampered source chunks and cross-tenant or incomplete slices", () => {
  const input = buildInput();
  const chunk = input.chunk;
  const mismatchedJob = {
    ...chunk,
    jobId: ids.jobItemId
  };
  const tamperedChunkHash = {
    ...chunk,
    chunkHash: hash("f")
  };
  const missingEntry = rehashChunk({
    ...chunk,
    entries: chunk.entries.slice(0, 1)
  });
  const reorderedEntries = rehashChunk({
    ...chunk,
    entries: [...chunk.entries].reverse()
  });

  for (const candidate of [
    { ...input, chunk: mismatchedJob },
    { ...input, chunk: tamperedChunkHash },
    { ...input, chunk: missingEntry },
    { ...input, chunk: reorderedEntries }
  ]) {
    assert.throws(
      () => buildRankProviderRequestIntent(candidate),
      TypeError
    );
  }
});

test("parser is recursively exact and detects keyword tampering", () => {
  const intent = buildRankProviderRequestIntent(buildInput());
  const first = intent.keywords[0];
  assert.ok(first);

  const candidates: unknown[] = [
    { ...intent, secret: "must-not-cross" },
    {
      ...intent,
      project: { ...intent.project, credentialId: ids.actorId }
    },
    {
      ...intent,
      manifestChunk: {
        ...intent.manifestChunk,
        chunkIndex: 4
      }
    },
    {
      ...intent,
      keywords: [
        {
          ...first,
          keywordText: "tampered keyword"
        },
        intent.keywords[1]
      ]
    },
    {
      ...intent,
      keywords: [...intent.keywords].reverse()
    },
    {
      ...intent,
      executionConnectorVersion: "INVALID VERSION"
    }
  ];

  for (const candidate of candidates) {
    assert.throws(
      () => rankProviderRequestIntent(candidate),
      TypeError
    );
  }
});

test("builder rejects hidden credentials and source extensions", () => {
  const input = buildInput();
  const commandWithSecret = {
    ...input.command,
    apiKey: "must-not-cross"
  };
  const firstEntry = input.chunk.entries[0];
  assert.ok(firstEntry);
  const entryWithCredential = {
    ...firstEntry,
    credential: { ciphertext: "must-not-cross" }
  };
  const chunkWithCredential = rehashChunk({
    ...input.chunk,
    entries: [entryWithCredential, input.chunk.entries[1]]
  } as InternalRankManifestChunk);
  const inputWithCredential = {
    ...input,
    credentialId: ids.actorId
  };

  for (const candidate of [
    inputWithCredential,
    { ...input, command: commandWithSecret },
    { ...input, chunk: chunkWithCredential }
  ]) {
    assert.throws(
      () =>
        buildRankProviderRequestIntent(
          candidate as RankProviderRequestIntentBuildInput
        ),
      TypeError
    );
  }
});

test("serialized intent contains private keywords but no credential material", () => {
  const intent = buildRankProviderRequestIntent(buildInput());
  const serialized = rankProviderRequestIntentCanonicalJson(intent);

  assert.equal(serialized.includes("seo платформа"), true);
  assert.equal(serialized.includes("assignmentId"), false);
  assert.equal(serialized.includes("keywordVersion"), false);
  for (const forbidden of [
    "apiKey",
    "authorization",
    "authTag",
    "ciphertext",
    "credential",
    "encryptedDataKey",
    "nonce",
    "providerPayload",
    "secret"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("enforces keyword, language and exact chunk-size bounds", () => {
  const input = buildInput();
  const firstEntry = input.chunk.entries[0];
  assert.ok(firstEntry);
  const oversizedText = "x".repeat(501);
  const invalidEntries: readonly InternalRankManifestEntry[][] = [
    [
      {
        ...firstEntry,
        keywordText: oversizedText,
        keywordTextHash: textHash(oversizedText)
      },
      input.chunk.entries[1] as InternalRankManifestEntry
    ],
    [
      {
        ...firstEntry,
        language: "EN"
      },
      input.chunk.entries[1] as InternalRankManifestEntry
    ]
  ];

  for (const entries of invalidEntries) {
    assert.throws(
      () =>
        buildRankProviderRequestIntent({
          ...input,
          chunk: rehashChunk({ ...input.chunk, entries })
        }),
      TypeError
    );
  }
});

function buildInput(): RankProviderRequestIntentBuildInput {
  return {
    command: manifestCommand(),
    chunk: manifestChunk(),
    jobItemId: ids.jobItemId,
    manifestHash: hash("d"),
    executionConnectorVersion: "arsenkin-positions@2.0.0",
    providerPolicyVersion: "manual-arsenkin-positions@1.0.0"
  };
}

function manifestCommand(): InternalSealRankManifestInput {
  return {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    estimateId: ids.estimateId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: {
      id: ids.projectId,
      workspaceId: ids.workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    estimate: {
      trackingContextId: ids.trackingContextId,
      contextVersion: 3,
      configurationVersion: 2,
      configurationHash: hash("a"),
      semanticScopeHash: hash("b"),
      scopeHash: hash("c"),
      pairCount: "2",
      expiresAt: "2026-07-30T12:00:00.000Z"
    },
    execution: {
      searchEngine: "GOOGLE",
      countryCode: "US",
      language: "en",
      device: "DESKTOP",
      depth: 30,
      domainMatchRule: { mode: "EXACT_HOST" },
      safeSearch: false,
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

function manifestChunk(): InternalRankManifestChunk {
  const entries: readonly InternalRankManifestEntry[] = [
    {
      id: ids.firstEntryId,
      sequence: 0,
      assignmentId: ids.firstAssignmentId,
      keywordId: ids.firstKeywordId,
      keywordVersion: 2,
      keywordText: "seo платформа",
      keywordTextHash: textHash("seo платформа"),
      language: "ru"
    },
    {
      id: ids.secondEntryId,
      sequence: 1,
      assignmentId: ids.secondAssignmentId,
      keywordId: ids.secondKeywordId,
      keywordVersion: 3,
      keywordText: "café rankings",
      keywordTextHash: textHash("café rankings"),
      language: "en"
    }
  ];
  return rehashChunk({
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    jobId: ids.jobId,
    manifestId: ids.manifestId,
    chunkIndex: 0,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash: hash("0"),
    entries
  });
}

function rehashChunk(
  value: InternalRankManifestChunk
): InternalRankManifestChunk {
  return {
    ...value,
    chunkHash: {
      algorithm: "SHA_256",
      value: canonicalJsonSha256(
        "rank-manifest-chunk@1",
        rankManifestChunkHashPreimage(value)
      )
    }
  };
}

function textHash(value: string): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: utf8Sha256(value)
  };
}

function hash(character: string): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: character.repeat(64)
  };
}
