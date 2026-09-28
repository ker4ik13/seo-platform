import assert from "node:assert/strict";
import test from "node:test";
import {
  rankManifestChunkHashPreimage,
  type InternalIngestRankChunkInput,
  type InternalRankManifestChunk
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  utf8Sha256
} from "@seo-platform/contracts/canonical-json";
import { rankChunkIngestHash } from "@seo-platform/contracts/rank-results-canonical";
import type { AppConfig } from "../config/app-config.js";
import type { RankManifestClient } from "../seo-data/rank-manifest.client.js";
import {
  RankResultClientError,
  type RankResultClient
} from "../seo-data/rank-result.client.js";
import type {
  RankResultPersistenceBrokerService,
  RankResultPersistenceClaim
} from "./rank-result-persistence-broker.service.js";
import { RankResultPersistenceService } from "./rank-result-persistence.service.js";

const ids = {
  workspace: "01900000-0000-7000-8000-000000000001",
  project: "01900000-0000-7000-8000-000000000002",
  actor: "01900000-0000-7000-8000-000000000003",
  job: "01900000-0000-7000-8000-000000000004",
  item: "01900000-0000-7000-8000-000000000005",
  estimate: "01900000-0000-7000-8000-000000000006",
  manifest: "01900000-0000-7000-8000-000000000007",
  entry: "01900000-0000-7000-8000-000000000008",
  assignment: "01900000-0000-7000-8000-000000000009",
  keyword: "01900000-0000-7000-8000-00000000000a",
  execution: "01900000-0000-7000-8000-00000000000b",
  lease: "01900000-0000-7000-8000-00000000000c"
} as const;

test("persists one staged normalized chunk and fences completion", async () => {
  let ingested: InternalIngestRankChunkInput | undefined;
  let persisted: boolean | undefined;
  const currentClaim = claim();
  const broker = {
    async claim() {
      return currentClaim;
    },
    async complete(
      completedClaim: RankResultPersistenceClaim,
      success: boolean
    ) {
      assert.equal(completedClaim, currentClaim);
      persisted = success;
      return success ? "PERSISTED" : "STAGED";
    }
  } as unknown as RankResultPersistenceBrokerService;
  const manifests = {
    async getChunk() {
      return sealedChunk();
    }
  } as unknown as RankManifestClient;
  const results = {
    async ingest(input: InternalIngestRankChunkInput) {
      ingested = input;
      return {};
    }
  } as unknown as RankResultClient;

  assert.equal(
    await service(broker, manifests, results).processOne("rank-worker"),
    "PERSISTED"
  );
  assert.equal(persisted, true);
  assert.ok(ingested);
  assert.equal(ingested.providerRequestId, "task-3944");
  assert.equal(ingested.results.length, 1);
  const { ingestEnvelopeHash: _storedHash, ...command } = ingested;
  assert.deepEqual(
    ingested.ingestEnvelopeHash,
    rankChunkIngestHash(command, sealedChunk())
  );
  assert.equal("rawProviderResponse" in ingested, false);
});

test("returns a staged chunk to PostgreSQL after retryable ingest failure", async () => {
  let persisted: boolean | undefined;
  const broker = {
    async claim() {
      return claim();
    },
    async complete(
      _claim: RankResultPersistenceClaim,
      success: boolean
    ) {
      persisted = success;
      return success ? "PERSISTED" : "STAGED";
    }
  } as unknown as RankResultPersistenceBrokerService;
  const manifests = {
    async getChunk() {
      return sealedChunk();
    }
  } as unknown as RankManifestClient;
  const results = {
    async ingest() {
      throw new RankResultClientError("UNAVAILABLE", true);
    }
  } as unknown as RankResultClient;

  assert.equal(
    await service(broker, manifests, results).processOne("rank-worker"),
    "RETRY_PENDING"
  );
  assert.equal(persisted, false);
});

test("persists several XMLStock chunks through one bounded transaction request", async () => {
  const first = {
    ...claim(),
    request: { ...claim().request, provider: "XMLSTOCK" as const }
  };
  const secondChunkWithoutHash = {
    ...sealedChunk(),
    chunkIndex: 1,
    entries: sealedChunk().entries.map((entry) => ({ ...entry, sequence: 1 }))
  };
  const secondChunk = {
    ...secondChunkWithoutHash,
    chunkHash: {
      algorithm: "SHA_256" as const,
      value: canonicalJsonSha256(
        "rank-manifest-chunk@1",
        rankManifestChunkHashPreimage(secondChunkWithoutHash)
      )
    }
  };
  const second = {
    ...claim(),
    executionId: "01900000-0000-7000-8000-00000000000d",
    jobItemId: "01900000-0000-7000-8000-00000000000e",
    manifestChunkIndex: 1,
    manifestChunkHash: secondChunk.chunkHash,
    request: {
      ...first.request,
      jobItemId: "01900000-0000-7000-8000-00000000000e"
    }
  };
  const claims = [first, second];
  const completions: Array<{ id: string; persisted: boolean }> = [];
  const broker = {
    async claim() { return claims.shift(); },
    async complete(value: RankResultPersistenceClaim, persisted: boolean) {
      completions.push({ id: value.executionId, persisted });
      return "PERSISTED";
    }
  } as unknown as RankResultPersistenceBrokerService;
  const manifests = {
    async getChunk(input: { chunkIndex: number }) {
      return input.chunkIndex === 1 ? secondChunk : sealedChunk();
    }
  } as unknown as RankManifestClient;
  let batchCount = 0;
  const results = {
    async ingestBatch(input: { items: readonly InternalIngestRankChunkInput[] }) {
      batchCount += 1;
      assert.equal(input.items.length, 2);
    },
    async ingest() { assert.fail("One-key HTTP writes must be batched"); }
  } as unknown as RankResultClient;

  assert.equal(await service(broker, manifests, results).processBatch("rank-result-worker"), 2);
  assert.equal(batchCount, 1);
  assert.deepEqual(completions, [
    { id: first.executionId, persisted: true },
    { id: second.executionId, persisted: true }
  ]);
});

function service(
  broker: RankResultPersistenceBrokerService,
  manifests: RankManifestClient,
  results: RankResultClient
): RankResultPersistenceService {
  return new RankResultPersistenceService(
    broker,
    manifests,
    results,
    {
      internalCommandTimeoutMs: 1_000
    } as AppConfig
  );
}

function claim(): RankResultPersistenceClaim {
  const chunk = sealedChunk();
  return {
    executionId: ids.execution,
    workspaceId: ids.workspace,
    projectId: ids.project,
    jobId: ids.job,
    jobItemId: ids.item,
    manifestId: ids.manifest,
    manifestChunkIndex: 0,
    manifestChunkHash: chunk.chunkHash,
    leaseOwner: "rank-worker",
    leaseToken: ids.lease,
    leaseExpiresAt: "2026-07-30T12:01:00.000Z",
    leaseGeneration: 1,
    executionVersion: 5,
    request: {
      schemaVersion: "rank-provider-request-intent@1",
      workspaceId: ids.workspace,
      projectId: ids.project,
      actorId: ids.actor,
      jobId: ids.job,
      jobItemId: ids.item,
      estimateId: ids.estimate,
      provider: "ARSENKIN",
      operation: "POSITIONS",
      project: { domain: "example.com", version: 1 },
      execution: {
        searchEngine: "GOOGLE",
        countryCode: "RU",
        device: "DESKTOP",
        regionCode: "1011969",
        language: "ru",
        depth: 30,
        domainMatchRule: { mode: "EXACT_HOST" },
        safeSearch: false,
        format: "SIMPLE",
        rawSerp: false,
        fallbackMode: "NONE",
        providerMappingVersion: "arsenkin-check-top@1"
      },
      manifest: {
        id: ids.manifest,
        hashSchemaVersion: "rank-manifest@1",
        manifestHash: hash("a"),
        pairCount: "1"
      },
      manifestChunk: {
        manifestId: ids.manifest,
        chunkIndex: 0,
        hashSchemaVersion: "rank-manifest-chunk@1",
        chunkHash: chunk.chunkHash
      },
      executionConnectorVersion: "arsenkin-positions@2.0.0",
      providerPolicyVersion: "rank-estimate@1",
      keywords: [
        {
          manifestEntryId: ids.entry,
          sequence: 0,
          keywordId: ids.keyword,
          keywordText: "seo audit",
          keywordTextHash: hashText("seo audit"),
          language: "ru"
        }
      ]
    },
    staged: {
      schemaVersion: "arsenkin-rank-result@1",
      providerRequestId: "task-3944",
      connectorVersion: "arsenkin-positions@2.0.0",
      observedAt: "2026-07-30T12:00:00.000Z",
      results: [
        {
          manifestEntryId: ids.entry,
          keywordId: ids.keyword,
          found: false,
          position: null,
          dataQualityFlags: []
        }
      ]
    }
  };
}

function sealedChunk(): InternalRankManifestChunk {
  const entries = [
    {
      id: ids.entry,
      sequence: 0,
      assignmentId: ids.assignment,
      keywordId: ids.keyword,
      keywordVersion: 1,
      keywordText: "seo audit",
      keywordTextHash: hashText("seo audit"),
      language: "ru"
    }
  ] as const;
  const preimage = {
    hashSchemaVersion: "rank-manifest-chunk@1",
    manifestId: ids.manifest,
    chunkIndex: 0,
    entries
  } as const;
  return {
    workspaceId: ids.workspace,
    projectId: ids.project,
    jobId: ids.job,
    manifestId: ids.manifest,
    chunkIndex: 0,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash: {
      algorithm: "SHA_256",
      value: canonicalJsonSha256(
        "rank-manifest-chunk@1",
        rankManifestChunkHashPreimage(preimage)
      )
    },
    entries
  };
}

function hash(character: string) {
  return {
    algorithm: "SHA_256" as const,
    value: character.repeat(64)
  };
}

function hashText(value: string) {
  return {
    algorithm: "SHA_256" as const,
    value: utf8Sha256(value)
  };
}
