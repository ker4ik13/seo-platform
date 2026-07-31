import assert from "node:assert/strict";
import test from "node:test";
import { utf8Sha256 } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import type { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import type { ArsenkinRankConnector } from "./arsenkin-rank.connector.js";
import type {
  RankConnectorPollClaim,
  RankConnectorRuntimeBrokerService,
  RankConnectorSubmitClaim
} from "./rank-connector-runtime-broker.service.js";
import { RankConnectorRuntimeService } from "./rank-connector-runtime.service.js";
import type { RankProviderRequestIntentV1 } from "./rank-provider-request-intent.js";

const ids = {
  workspace: "01900000-0000-7000-8000-000000000001",
  project: "01900000-0000-7000-8000-000000000002",
  actor: "01900000-0000-7000-8000-000000000003",
  job: "01900000-0000-7000-8000-000000000004",
  item: "01900000-0000-7000-8000-000000000005",
  estimate: "01900000-0000-7000-8000-000000000006",
  manifest: "01900000-0000-7000-8000-000000000007",
  entry: "01900000-0000-7000-8000-000000000008",
  keyword: "01900000-0000-7000-8000-000000000009",
  credential: "01900000-0000-7000-8000-000000000010",
  execution: "01900000-0000-7000-8000-000000000011",
  lease: "01900000-0000-7000-8000-000000000012"
} as const;

test("authorizes once, submits once and durably records an accepted task", async () => {
  const calls: string[] = [];
  const submitClaim = claim();
  const broker = {
    async claimSubmit() {
      calls.push("claim");
      return submitClaim;
    },
    async readSubmitRequest() {
      calls.push("read");
      return requestIntent();
    },
    async authorizeSubmit() {
      calls.push("authorize");
      return {
        executionId: ids.execution,
        workspaceId: ids.workspace,
        executionVersion: 3,
        submitBytesStartedAt: new Date().toISOString()
      };
    },
    async completeSubmit(
      _claim: unknown,
      _permit: unknown,
      outcome: { status: string }
    ) {
      calls.push(`complete:${outcome.status}`);
      return {
        executionId: ids.execution,
        status: "POLL_WAIT",
        executionVersion: 4
      };
    },
    async claimPoll() {
      throw new Error("poll must not run after a submit claim");
    }
  } as unknown as RankConnectorRuntimeBrokerService;
  const connector = {
    async submit() {
      calls.push("provider");
      return {
        status: "ACCEPTED" as const,
        taskId: "3944",
        request: {
          tools_name: "check-top" as const,
          data: {
            queries: ["seo audit"],
            is_snippet: false as const,
            noreask: false as const,
            se: [{ type: 11 as const, region: 1011969 }] as const,
            depth: 30 as const
          }
        }
      };
    }
  } as unknown as ArsenkinRankConnector;

  assert.equal(
    await service(broker, connector, true).processOne("connector-worker"),
    "SUBMITTED"
  );
  assert.deepEqual(calls, [
    "claim",
    "read",
    "authorize",
    "provider",
    "complete:ACCEPTED"
  ]);
});

test("polls an accepted task and stages only normalized output", async () => {
  let completed:
    | {
        readonly outcome: string;
        readonly snapshot?: { readonly results: readonly unknown[] };
      }
    | undefined;
  const pollClaim: RankConnectorPollClaim = {
    ...claim(),
    providerTaskId: "3944",
    request: requestIntent()
  };
  const broker = {
    async claimPoll() {
      return pollClaim;
    },
    async completePoll(_claim: unknown, input: typeof completed) {
      completed = input;
      return {
        executionId: ids.execution,
        status: "STAGED",
        executionVersion: 6
      };
    }
  } as unknown as RankConnectorRuntimeBrokerService;
  const connector = {
    async fetchResult() {
      return {
        status: "READY" as const,
        value: providerResult()
      };
    }
  } as unknown as ArsenkinRankConnector;

  assert.equal(
    await service(broker, connector, false).processOne("connector-worker"),
    "RESULT_STAGED"
  );
  assert.equal(completed?.outcome, "READY");
  assert.equal(completed?.snapshot?.results.length, 1);
  assert.deepEqual(completed?.snapshot?.results[0], {
    manifestEntryId: ids.entry,
    keywordId: ids.keyword,
    found: true,
    position: 2,
    rankingUrl: "https://example.com/page",
    normalizedRankingUrl: "https://example.com/page",
    resultType: "ORGANIC",
    serpFeatures: [],
    dataQualityFlags: [
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE",
      "TITLE_UNAVAILABLE",
      "SNIPPET_UNAVAILABLE"
    ]
  });
});

function service(
  broker: RankConnectorRuntimeBrokerService,
  connector: ArsenkinRankConnector,
  submitEnabled: boolean
): RankConnectorRuntimeService {
  const crypto = {
    decrypt() {
      return { apiKey: "private-key" };
    }
  } as unknown as IntegrationCredentialCryptoService;
  const config = {
    integrationCredentialValidation: { timeoutMs: 1_000 },
    rankExecution: { submitEnabled }
  } as unknown as AppConfig;
  return new RankConnectorRuntimeService(
    broker,
    crypto,
    connector,
    config
  );
}

function claim(): RankConnectorSubmitClaim {
  return {
    executionId: ids.execution,
    workspaceId: ids.workspace,
    credentialId: ids.credential,
    credentialMaterialVersion: 1,
    leaseOwner: "connector-worker",
    leaseToken: ids.lease,
    leaseExpiresAt: new Date(Date.now() + 20_000).toISOString(),
    leaseGeneration: 1,
    executionVersion: 2,
    encryptedCredential: {
      ciphertext: Buffer.from("ciphertext"),
      nonce: Buffer.alloc(12),
      authTag: Buffer.alloc(16),
      encryptedDataKey: Buffer.from("encrypted-data-key"),
      dataKeyNonce: Buffer.alloc(12),
      dataKeyAuthTag: Buffer.alloc(16),
      keyVersion: 1
    }
  };
}

function requestIntent(): RankProviderRequestIntentV1 {
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
    project: { domain: "example.com", version: 1 },
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
      chunkHash: hash("b")
    },
    executionConnectorVersion: "arsenkin-positions@1.0.0",
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
        language: "en"
      }
    ]
  };
}

function providerResult(): unknown {
  return {
    code: "TASK_RESULT",
    task_id: "3944",
    result: {
      request: {
        queries: ["seo audit"],
        depth: 30,
        ss: [{ ss: 11, region: 1011969 }]
      },
      result: {
        collect: [
          [
            [
              "https://competitor.example/",
              "https://example.com/page"
            ]
          ]
        ]
      }
    }
  };
}

function hash(character: string): {
  readonly algorithm: "SHA_256";
  readonly value: string;
} {
  return {
    algorithm: "SHA_256",
    value: character.repeat(64)
  };
}
