import assert from "node:assert/strict";
import test from "node:test";
import type {
  InternalRankCheckFinalizationReceipt,
  InternalSealRankManifestInput
} from "@seo-platform/contracts";
import { utf8Sha256 } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { RankManifestClient } from "../seo-data/rank-manifest.client.js";
import {
  rankManifestCommandHash,
  rankManifestCommandJson
} from "./rank-manifest-command.js";
import { RankResultFinalizationService } from "./rank-result-finalization.service.js";

const ids = {
  workspace: "01900000-0000-7000-8000-000000000001",
  project: "01900000-0000-7000-8000-000000000002",
  actor: "01900000-0000-7000-8000-000000000003",
  job: "01900000-0000-7000-8000-000000000004",
  estimate: "01900000-0000-7000-8000-000000000005",
  context: "01900000-0000-7000-8000-000000000006",
  manifest: "01900000-0000-7000-8000-000000000007",
  item: "01900000-0000-7000-8000-000000000008",
  execution: "01900000-0000-7000-8000-000000000009",
  entry: "01900000-0000-7000-8000-00000000000a",
  keyword: "01900000-0000-7000-8000-00000000000b"
} as const;

test("claims, finalizes and atomically closes one persisted rank Job", async () => {
  const storedJob = job();
  let finalizedInput: unknown;
  let itemStatus: string | undefined;
  const transaction = {
    $queryRaw: async (
      strings: TemplateStringsArray
    ): Promise<readonly unknown[]> => {
      const sql = strings.join(" ");
      if (sql.includes("rank-job-graph:job")) {
        return [
          {
            jobId: ids.job,
            workspaceId: ids.workspace,
            projectId: ids.project
          }
        ];
      }
      if (sql.includes("rank-job-graph:run")) {
        return [{ jobId: ids.job }];
      }
      if (sql.includes("clock_timestamp")) {
        return [{ now: new Date("2026-07-30T12:00:00.000Z") }];
      }
      if (sql.includes("requestSnapshot")) {
        return [
          {
            executionId: ids.execution,
            jobItemId: ids.item,
            manifestChunkIndex: 0,
            status: "PERSISTED",
            providerTaskId: "3944",
            lastErrorCode: null,
            requestSnapshot: requestIntent()
          }
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    job: {
      findFirst: async () => ({
        ...storedJob,
        rankRun: { ...storedJob.rankRun }
      }),
      updateMany: async ({
        data
      }: {
        readonly data: Record<string, unknown>;
      }) => {
        if (data.stage === "FINALIZING") {
          storedJob.stage = "FINALIZING";
          storedJob.leaseOwner = String(data.leaseOwner);
          storedJob.leaseExpiresAt =
            data.leaseExpiresAt as Date;
        }
        if (data.status === "COMPLETED") {
          storedJob.status = "COMPLETED";
          storedJob.stage = "FINISHED";
          storedJob.leaseOwner = null;
          storedJob.leaseExpiresAt = null;
        }
        storedJob.version += 1;
        return { count: 1 };
      }
    },
    jobItem: {
      updateMany: async ({
        data
      }: {
        readonly data: Record<string, unknown>;
      }) => {
        itemStatus = String(data.status);
        return { count: 1 };
      }
    },
    rankJobRun: {
      updateMany: async () => {
        storedJob.rankRun.sealState = "FINALIZED";
        storedJob.rankRun.finalizationStatus = "COMPLETED";
        return { count: 1 };
      }
    }
  };
  const prisma = {
    $transaction: async <T>(
      callback: (client: typeof transaction) => Promise<T>
    ) => callback(transaction)
  } as unknown as PrismaService;
  const manifests = {
    async finalize(
      input: unknown
    ): Promise<InternalRankCheckFinalizationReceipt> {
      finalizedInput = input;
      return {
        schemaVersion: "rank-finalize@1",
        workspaceId: ids.workspace,
        projectId: ids.project,
        jobId: ids.job,
        manifestId: ids.manifest,
        requestHash: hash("f"),
        trackingContextId: ids.context,
        configurationVersion: 2,
        status: "COMPLETED",
        pairCount: "1",
        persistedCount: "1",
        foundCount: "0",
        notFoundCount: "1",
        missingCount: "0",
        finalizedAt: "2026-07-30T12:00:01.000Z"
      };
    }
  } as unknown as RankManifestClient;
  const service = new RankResultFinalizationService(
    prisma,
    manifests,
    { internalCommandTimeoutMs: 1_000 } as AppConfig
  );

  assert.equal(
    await service.process(ids.job, "rank-finalize-test"),
    "COMPLETED"
  );
  assert.deepEqual(finalizedInput, {
    schemaVersion: "rank-finalize@1",
    workspaceId: ids.workspace,
    projectId: ids.project,
    actorId: ids.actor,
    jobId: ids.job,
    manifestId: ids.manifest,
    status: "COMPLETED"
  });
  assert.equal(itemStatus, "COMPLETED");
  assert.equal(storedJob.status, "COMPLETED");
  assert.equal(storedJob.stage, "FINISHED");
  assert.equal(storedJob.rankRun.sealState, "FINALIZED");
});

function job() {
  const command = manifestCommand();
  return {
    id: ids.job,
    workspaceId: ids.workspace,
    projectId: ids.project,
    actorId: ids.actor,
    type: "MANUAL_RANK_CHECK",
    status: "RUNNING",
    stage: "WAITING_EXECUTION_GRANT",
    version: 5,
    retryAt: null as Date | null,
    leaseOwner: null as string | null,
    leaseExpiresAt: null as Date | null,
    progressTotal: 1n,
    rankRun: {
      estimateId: ids.estimate,
      trackingContextId: ids.context,
      projectDomain: "example.com",
      projectStatus: "ACTIVE",
      projectVersion: 4,
      manifestCommand: rankManifestCommandJson(command),
      manifestCommandHash: rankManifestCommandHash(command),
      sealState: "SEALED",
      finalizationStatus: null as "COMPLETED" | null,
      manifestId: ids.manifest,
      manifestPairCount: 1,
      manifestChunkCount: 1
    }
  };
}

function manifestCommand(): InternalSealRankManifestInput {
  return {
    workspaceId: ids.workspace,
    projectId: ids.project,
    actorId: ids.actor,
    jobId: ids.job,
    estimateId: ids.estimate,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: {
      id: ids.project,
      workspaceId: ids.workspace,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    estimate: {
      trackingContextId: ids.context,
      contextVersion: 3,
      configurationVersion: 2,
      configurationHash: hash("a"),
      semanticScopeHash: hash("b"),
      scopeHash: hash("c"),
      pairCount: "1",
      expiresAt: "2026-07-30T12:05:00.000Z"
    },
    execution: {
      searchEngine: "GOOGLE",
      countryCode: "RU",
      regionCode: "1011969",
      language: "ru",
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

function requestIntent() {
  return {
    schemaVersion: "rank-provider-request-intent@1",
    workspaceId: ids.workspace,
    projectId: ids.project,
    actorId: ids.actor,
    jobId: ids.job,
    jobItemId: ids.item,
    estimateId: ids.estimate,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: { domain: "example.com", version: 4 },
    execution: manifestCommand().execution,
    manifest: {
      id: ids.manifest,
      hashSchemaVersion: "rank-manifest@1",
      manifestHash: hash("d"),
      pairCount: "1"
    },
    manifestChunk: {
      manifestId: ids.manifest,
      chunkIndex: 0,
      hashSchemaVersion: "rank-manifest-chunk@1",
      chunkHash: hash("e")
    },
    executionConnectorVersion: "arsenkin-positions@2.0.0",
    providerPolicyVersion: "manual-arsenkin-positions@1.0.0",
    keywords: [
      {
        manifestEntryId: ids.entry,
        sequence: 0,
        keywordId: ids.keyword,
        keywordText: "seo audit",
        keywordTextHash: {
          algorithm: "SHA_256",
          value: utf8Sha256("seo audit")
        },
        language: "ru"
      }
    ]
  };
}

function hash(character: string) {
  return {
    algorithm: "SHA_256" as const,
    value: character.repeat(64)
  };
}
