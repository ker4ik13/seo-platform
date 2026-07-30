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
import type {
  RankProviderRequestIntent
} from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { RankManifestClient } from "../seo-data/rank-manifest.client.js";
import { rankManifestCommandHash } from "./rank-manifest-command.js";
import {
  RankProviderRequestIntentError,
  RankProviderRequestIntentService,
  storedRankProviderRequestIntent,
  type RankProviderRequestIntentBinding
} from "./rank-provider-request-intent.service.js";
import {
  RANK_PROVIDER_REQUEST_INTENT_SCHEMA,
  buildRankProviderRequestIntent,
  rankProviderRequestIntentCanonicalJson,
  rankProviderRequestIntentHash,
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
  intentId: "01900000-0000-7000-8000-000000000009",
  firstEntryId: "01900000-0000-7000-8000-000000000010",
  secondEntryId: "01900000-0000-7000-8000-000000000011",
  firstAssignmentId: "01900000-0000-7000-8000-000000000012",
  secondAssignmentId: "01900000-0000-7000-8000-000000000013",
  firstKeywordId: "01900000-0000-7000-8000-000000000014",
  secondKeywordId: "01900000-0000-7000-8000-000000000015"
} as const;

const providerPolicyVersion = "manual-arsenkin@1.0.0";
const executionConnectorVersion = "arsenkin-positions@1.0.0";
const manifestHash = hash("d");

test("validates one exact stored provider request intent replay", () => {
  const intent = requestIntent();
  const row = storedRow(intent);

  assert.deepEqual(
    storedRankProviderRequestIntent(row, binding()),
    intent
  );
});

test("rejects tampered stored request, request hash and chunk hash", () => {
  const intent = requestIntent();
  const row = storedRow(intent);
  const changedIntent = {
    ...intent,
    providerPolicyVersion: "manual-arsenkin@1.0.1"
  } satisfies RankProviderRequestIntentV1;
  const candidates: readonly RankProviderRequestIntent[] = [
    {
      ...row,
      requestSnapshot: jsonSnapshot(changedIntent),
      requestHash: Buffer.from(
        rankProviderRequestIntentHash(changedIntent).value,
        "hex"
      )
    },
    { ...row, requestHash: Buffer.alloc(32, 0xee) },
    { ...row, manifestChunkHash: Buffer.alloc(32, 0xff) }
  ];

  for (const candidate of candidates) {
    assert.throws(
      () =>
        storedRankProviderRequestIntent(candidate, binding()),
      localStateInvalid
    );
  }
});

test("locks, fetches, revalidates and creates in the required order", async () => {
  const fixture = serviceFixture();

  const created = await fixture.service.ensureForItem(ids.jobItemId);

  assert.equal(created.id, ids.intentId);
  assert.deepEqual(fixture.events, [
    "first-locked-snapshot",
    "get-chunk",
    "second-locked-revalidation",
    "create"
  ]);
  assert.equal(fixture.state.transactionCount, 2);
  assert.equal(fixture.state.manifestCalls, 1);
  assert.equal(fixture.state.createCalls, 1);
  assert.deepEqual(fixture.state.chunkInput, {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    jobId: ids.jobId,
    manifestId: ids.manifestId,
    chunkIndex: 0
  });
  assert.equal(fixture.state.chunkActorId, ids.actorId);
  assert.deepEqual(
    storedRankProviderRequestIntent(created, binding()),
    requestIntent()
  );
});

test("rejects a graph change discovered by the second locked revalidation", async () => {
  const fixture = serviceFixture({
    graphPolicyVersions: [
      providerPolicyVersion,
      "manual-arsenkin@1.0.1"
    ]
  });

  await assert.rejects(
    () => fixture.service.ensureForItem(ids.jobItemId),
    localStateInvalid
  );
  assert.deepEqual(fixture.events, [
    "first-locked-snapshot",
    "get-chunk",
    "second-locked-revalidation"
  ]);
  assert.equal(fixture.state.createCalls, 0);
});

test("revalidates an exact existing replay against the authoritative chunk", async () => {
  const existing = storedRow(requestIntent());
  const fixture = serviceFixture({
    existingByTransaction: [existing, existing]
  });

  const replay = await fixture.service.ensureForItem(ids.jobItemId);

  assert.equal(replay, existing);
  assert.deepEqual(fixture.events, [
    "first-locked-snapshot",
    "get-chunk",
    "second-locked-revalidation"
  ]);
  assert.equal(fixture.state.transactionCount, 2);
  assert.equal(fixture.state.manifestCalls, 1);
  assert.equal(fixture.state.createCalls, 0);
});

test("rejects self-consistent forged stored keywords against the authoritative chunk", async () => {
  const exactIntent = requestIntent();
  const firstKeyword = exactIntent.keywords[0];
  assert.ok(firstKeyword);
  const forgedIntent: RankProviderRequestIntentV1 = {
    ...exactIntent,
    keywords: [
      {
        ...firstKeyword,
        keywordText: "forged keyword",
        keywordTextHash: textHash("forged keyword")
      },
      exactIntent.keywords[1] as RankProviderRequestIntentV1["keywords"][number]
    ]
  };
  const forged = storedRow(forgedIntent);
  assert.deepEqual(
    storedRankProviderRequestIntent(forged, binding()),
    forgedIntent
  );
  const fixture = serviceFixture({
    existingByTransaction: [forged, forged]
  });

  await assert.rejects(
    () => fixture.service.ensureForItem(ids.jobItemId),
    localStateInvalid
  );
  assert.deepEqual(fixture.events, [
    "first-locked-snapshot",
    "get-chunk",
    "second-locked-revalidation"
  ]);
  assert.equal(fixture.state.transactionCount, 2);
  assert.equal(fixture.state.manifestCalls, 1);
  assert.equal(fixture.state.createCalls, 0);
});

test("rejects a malformed item reference before manifest HTTP", async () => {
  const fixture = serviceFixture({
    inputReference: {
      schemaVersion: "rank-job-item@1",
      manifestId: ids.manifestId,
      chunkIndex: 0,
      providerPayload: "must-not-cross"
    }
  });

  await assert.rejects(
    () => fixture.service.ensureForItem(ids.jobItemId),
    localStateInvalid
  );
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.state.transactionCount, 1);
  assert.equal(fixture.state.manifestCalls, 0);
  assert.equal(fixture.state.createCalls, 0);
});

interface ServiceFixtureOptions {
  readonly existingByTransaction?: readonly (
    | RankProviderRequestIntent
    | null
  )[];
  readonly graphPolicyVersions?: readonly string[];
  readonly inputReference?: unknown;
}

interface ServiceFixtureState {
  transactionCount: number;
  manifestCalls: number;
  createCalls: number;
  chunkInput: unknown;
  chunkActorId: string | undefined;
}

function serviceFixture(
  options: ServiceFixtureOptions = {}
): {
  readonly service: RankProviderRequestIntentService;
  readonly events: string[];
  readonly state: ServiceFixtureState;
} {
  const events: string[] = [];
  const state: ServiceFixtureState = {
    transactionCount: 0,
    manifestCalls: 0,
    createCalls: 0,
    chunkInput: undefined,
    chunkActorId: undefined
  };
  const existingByTransaction =
    options.existingByTransaction ?? [null, null];
  const graphPolicyVersions =
    options.graphPolicyVersions ?? [
      providerPolicyVersion,
      providerPolicyVersion
    ];
  const prisma = {
    jobItem: {
      findUnique: async () => ({ jobId: ids.jobId })
    },
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>
    ) => {
      const transactionIndex = state.transactionCount;
      state.transactionCount += 1;
      let rawCall = 0;
      const policyVersion =
        graphPolicyVersions[transactionIndex] ??
        providerPolicyVersion;
      const transaction = {
        $queryRaw: async (..._input: readonly unknown[]) => {
          rawCall += 1;
          if (rawCall === 1) {
            return [
              {
                jobId: ids.jobId,
                workspaceId: ids.workspaceId,
                projectId: ids.projectId
              }
            ];
          }
          if (rawCall === 2) return [{ jobId: ids.jobId }];
          if (rawCall === 3) {
            return [{ jobItemId: ids.jobItemId }];
          }
          throw new Error("Unexpected rank graph lock");
        },
        job: {
          findUnique: async () => jobGraph(policyVersion)
        },
        jobItem: {
          findUnique: async () =>
            jobItem(options.inputReference)
        },
        rankProviderRequestIntent: {
          findFirst: async () => {
            assert.equal(rawCall, 3);
            events.push(
              transactionIndex === 0
                ? "first-locked-snapshot"
                : "second-locked-revalidation"
            );
            return existingByTransaction[transactionIndex] ?? null;
          },
          create: async (input: {
            readonly data: Omit<
              RankProviderRequestIntent,
              "id" | "createdAt"
            >;
          }) => {
            state.createCalls += 1;
            events.push("create");
            return {
              id: ids.intentId,
              ...input.data,
              createdAt: new Date("2026-07-30T12:00:00.000Z")
            };
          }
        }
      };
      return callback(transaction);
    }
  } as unknown as PrismaService;
  const manifests = {
    getChunk: async (input: unknown, actorId: string) => {
      state.manifestCalls += 1;
      state.chunkInput = input;
      state.chunkActorId = actorId;
      events.push("get-chunk");
      return manifestChunk();
    }
  } as unknown as RankManifestClient;

  return {
    service: new RankProviderRequestIntentService(prisma, manifests),
    events,
    state
  };
}

function jobGraph(policyVersion: string) {
  const command = manifestCommand();
  return {
    id: ids.jobId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    type: "MANUAL_RANK_CHECK",
    status: "RUNNING",
    stage: "WAITING_EXECUTION_GRANT",
    actorId: ids.actorId,
    provider: "ARSENKIN",
    credentialMode: "BYOK_API_KEY",
    cancelRequestedAt: null,
    rankRun: {
      jobId: ids.jobId,
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      estimateId: ids.estimateId,
      trackingContextId: ids.trackingContextId,
      projectDomain: command.project.domain,
      projectStatus: "ACTIVE",
      projectVersion: command.project.version,
      manifestCommand: command,
      manifestCommandHash: rankManifestCommandHash(command),
      sealState: "SEALED",
      manifestId: ids.manifestId,
      manifestHashSchema: "rank-manifest@1",
      manifestHash: Buffer.from(manifestHash.value, "hex"),
      manifestPairCount: 2,
      manifestChunkCount: 1,
      manifestChunkSize: 250,
      finalizationStatus: null,
      finalizedAt: null,
      cancelRequestedBy: null,
      estimate: {
        id: ids.estimateId,
        workspaceId: ids.workspaceId,
        projectId: ids.projectId,
        projectVersion: command.project.version,
        provider: "ARSENKIN",
        credentialMode: "BYOK_API_KEY",
        providerPolicyVersion: policyVersion,
        keywordCount: 2
      }
    }
  };
}

function jobItem(inputReference?: unknown) {
  return {
    id: ids.jobItemId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    jobId: ids.jobId,
    sequence: 0,
    status: "QUEUED",
    inputReference:
      inputReference ?? {
        schemaVersion: "rank-job-item@1",
        manifestId: ids.manifestId,
        chunkIndex: 0
      },
    providerRequestId: null,
    outputReference: null,
    actualCostMicro: null,
    error: null,
    attempt: 0,
    retryAt: null
  };
}

function requestIntent(): RankProviderRequestIntentV1 {
  return buildRankProviderRequestIntent({
    command: manifestCommand(),
    chunk: manifestChunk(),
    jobItemId: ids.jobItemId,
    manifestHash,
    executionConnectorVersion,
    providerPolicyVersion
  });
}

function storedRow(
  intent: RankProviderRequestIntentV1
): RankProviderRequestIntent {
  const requestHash = rankProviderRequestIntentHash(intent);
  return {
    id: ids.intentId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    manifestId: ids.manifestId,
    manifestHash: Buffer.from(manifestHash.value, "hex"),
    manifestChunkIndex: 0,
    manifestChunkHash: Buffer.from(
      intent.manifestChunk.chunkHash.value,
      "hex"
    ),
    schemaVersion: RANK_PROVIDER_REQUEST_INTENT_SCHEMA,
    requestSnapshot: jsonSnapshot(intent),
    requestHash: Buffer.from(requestHash.value, "hex"),
    createdAt: new Date("2026-07-30T12:00:00.000Z")
  };
}

function binding(): RankProviderRequestIntentBinding {
  const command = manifestCommand();
  return {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    estimateId: ids.estimateId,
    projectDomain: command.project.domain,
    projectVersion: command.project.version,
    execution: command.execution,
    manifestId: ids.manifestId,
    manifestHash: Buffer.from(manifestHash.value, "hex"),
    manifestPairCount: 2,
    manifestChunkIndex: 0,
    executionConnectorVersion,
    providerPolicyVersion
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
      expiresAt: "2026-07-30T12:05:00.000Z"
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
  const chunk: InternalRankManifestChunk = {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    jobId: ids.jobId,
    manifestId: ids.manifestId,
    chunkIndex: 0,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash: hash("0"),
    entries
  };
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

function jsonSnapshot(
  intent: RankProviderRequestIntentV1
): RankProviderRequestIntent["requestSnapshot"] {
  return JSON.parse(
    rankProviderRequestIntentCanonicalJson(intent)
  ) as RankProviderRequestIntent["requestSnapshot"];
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

function localStateInvalid(error: unknown): boolean {
  return (
    error instanceof RankProviderRequestIntentError &&
    error.code === "LOCAL_STATE_INVALID" &&
    !error.retryable
  );
}
