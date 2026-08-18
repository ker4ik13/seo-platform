import assert from "node:assert/strict";
import test from "node:test";
import { utf8Sha256 } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import type { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import type { XmlStockHttpQuotaGate } from "../integrations/xmlstock-http-quota-limiter.js";
import type { ArsenkinRankConnector } from "./arsenkin-rank.connector.js";
import type { XmlStockRankConnector } from "./xmlstock-rank.connector.js";
import type {
  RankConnectorPollClaim,
  RankConnectorRuntimeBrokerService,
  RankConnectorSubmitClaim
} from "./rank-connector-runtime-broker.service.js";
import { RankConnectorLeaseLostError } from "./rank-connector-runtime-broker.service.js";
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
    serpResults: [{
      position: 2,
      rankingUrl: "https://example.com/page",
      normalizedRankingUrl: "https://example.com/page"
    }],
    dataQualityFlags: [
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE",
      "TITLE_UNAVAILABLE",
      "SNIPPET_UNAVAILABLE"
    ]
  });
});

test("rejects a malformed finished provider result instead of leaving the poll claimed", async () => {
  let completed:
    | {
        readonly outcome: string;
        readonly errorCode?: string;
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
        status: "REJECTED",
        executionVersion: 6
      };
    }
  } as unknown as RankConnectorRuntimeBrokerService;
  const connector = {
    async fetchResult() {
      return {
        status: "READY" as const,
        value: { code: "TASK_RESULT", task_id: "3944" }
      };
    }
  } as unknown as ArsenkinRankConnector;

  assert.equal(
    await service(broker, connector, false).processOne("connector-worker"),
    "POLL_TERMINAL"
  );
  assert.deepEqual(completed, {
    outcome: "REJECTED",
    errorCode: "INVALID_PROVIDER_RESPONSE"
  });
});

test("claims enough lease for check plus get and caps rank request timeout", async () => {
  const pollClaim: RankConnectorPollClaim = {
    ...claim(),
    leaseExpiresAt: new Date(Date.now() + 23_000).toISOString(),
    providerTaskId: "3944",
    request: requestIntent()
  };
  let claimedLeaseSeconds: number | undefined;
  const broker = {
    async claimPoll(
      _leaseOwner: string,
      leaseSeconds: number
    ) {
      claimedLeaseSeconds = leaseSeconds;
      return pollClaim;
    },
    async completePoll() {
      return {
        executionId: ids.execution,
        status: "POLL_WAIT",
        executionVersion: 6
      };
    }
  } as unknown as RankConnectorRuntimeBrokerService;
  let providerTimeoutMs: number | undefined;
  const connector = {
    async fetchResult(
      _taskId: string,
      _secret: unknown,
      timeoutMs: number
    ) {
      providerTimeoutMs = timeoutMs;
      return { status: "PENDING" as const };
    }
  } as unknown as ArsenkinRankConnector;

  assert.equal(
    await service(broker, connector, false, 120_000).processOne(
      "connector-worker"
    ),
    "POLL_PENDING"
  );
  assert.equal(claimedLeaseSeconds, 23);
  assert.equal(providerTimeoutMs, 10_000);
});

test("claims a submit lease that fits inside the short execution grant", async () => {
  let claimedLeaseSeconds: number | undefined;
  const broker = {
    async claimSubmit(
      _leaseOwner: string,
      leaseSeconds: number
    ) {
      claimedLeaseSeconds = leaseSeconds;
      return claim();
    },
    async readSubmitRequest() {
      return requestIntent();
    },
    async authorizeSubmit() {
      return {
        executionId: ids.execution,
        workspaceId: ids.workspace,
        executionVersion: 3,
        submitBytesStartedAt: new Date().toISOString()
      };
    },
    async completeSubmit() {
      return {
        executionId: ids.execution,
        status: "POLL_WAIT",
        executionVersion: 4
      };
    }
  } as unknown as RankConnectorRuntimeBrokerService;
  const connector = {
    async submit() {
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
    await service(broker, connector, true, 120_000).processOne(
      "connector-worker"
    ),
    "SUBMITTED"
  );
  assert.equal(claimedLeaseSeconds, 13);
});

test("treats an asynchronously lost submit lease as recoverable", async () => {
  const broker = {
    async claimSubmit() {
      return claim();
    },
    async readSubmitRequest() {
      throw new RankConnectorLeaseLostError();
    }
  } as unknown as RankConnectorRuntimeBrokerService;

  assert.equal(
    await service(
      broker,
      {} as ArsenkinRankConnector,
      true
    ).processOne("connector-worker"),
    "LEASE_LOST"
  );
});

test("backs off XMLStock delayed Yandex polling to the documented cadence", async () => {
  const pollClaim: RankConnectorPollClaim = {
    ...claim(),
    provider: "XMLSTOCK",
    providerTaskId: "xml-request-3944",
    request: xmlStockRequestIntent()
  };
  let completed:
    | { readonly outcome: string; readonly retryAfterSeconds?: number }
    | undefined;
  const broker = {
    async claimPoll() {
      return pollClaim;
    },
    async completePoll(_claim: unknown, input: typeof completed) {
      completed = input;
      return {
        executionId: ids.execution,
        status: "POLL_WAIT",
        executionVersion: 6
      };
    }
  } as unknown as RankConnectorRuntimeBrokerService;
  const xmlStockConnector = {
    async fetchResult() {
      return { status: "PENDING" as const };
    }
  } as unknown as XmlStockRankConnector;

  assert.equal(
    await service(
      broker,
      {} as ArsenkinRankConnector,
      false,
      1_000,
      xmlStockConnector
    ).processOne("connector-worker"),
    "POLL_PENDING"
  );
  assert.deepEqual(completed, {
    outcome: "PENDING",
    retryAfterSeconds: 25
  });
});

test("persists an XMLStock Live page checkpoint before polling the next page", async () => {
  const pollClaim: RankConnectorPollClaim = {
    ...claim(),
    provider: "XMLSTOCK",
    providerTaskId: "xml-live-3944",
    request: {
      ...xmlStockRequestIntent(),
      execution: {
        ...xmlStockRequestIntent().execution,
        providerMappingVersion: "xmlstock-yandex-live@2"
      }
    }
  };
  let completed: { readonly outcome: string } | undefined;
  const broker = {
    async claimPoll() {
      return pollClaim;
    },
    async completePoll(_claim: unknown, input: { readonly outcome: string }) {
      completed = input;
      return {
        executionId: ids.execution,
        status: "POLL_WAIT",
        executionVersion: 6
      };
    }
  } as unknown as RankConnectorRuntimeBrokerService;
  const progress = {
    schemaVersion: "xmlstock-rank-page-progress@1" as const,
    taskId: "xml-live-3944",
    engine: "YANDEX" as const,
    depth: 30 as const,
    nextPage: 1,
    documents: Array.from({ length: 10 }, (_, index) => ({
      position: index + 1,
      url: `https://foreign-${index}.example/`
    }))
  };
  const xmlStockConnector = {
    async fetchResult() {
      return {
        status: "CHECKPOINTED" as const,
        progress,
        hash: hash("c")
      };
    }
  } as unknown as XmlStockRankConnector;

  assert.equal(
    await service(
      broker,
      {} as ArsenkinRankConnector,
      false,
      1_000,
      xmlStockConnector
    ).processOne("connector-worker"),
    "POLL_CHECKPOINTED"
  );
  assert.equal(completed?.outcome, "CHECKPOINTED");
});

test("defers an XMLStock poll without an HTTP request when its credential product is full", async () => {
  const pollClaim: RankConnectorPollClaim = {
    ...claim(),
    provider: "XMLSTOCK",
    providerTaskId: "xml-live-3944",
    request: {
      ...xmlStockRequestIntent(),
      execution: {
        ...xmlStockRequestIntent().execution,
        providerMappingVersion: "xmlstock-yandex-live@2"
      }
    }
  };
  let providerCalls = 0;
  let deferredBy: number | undefined;
  const broker = {
    async claimPoll() {
      return pollClaim;
    },
    async deferPollForProviderCapacity(
      _claim: RankConnectorPollClaim,
      retryAfterSeconds: number
    ) {
      deferredBy = retryAfterSeconds;
      return {
        executionId: ids.execution,
        status: "POLL_WAIT",
        executionVersion: 6
      };
    }
  } as unknown as RankConnectorRuntimeBrokerService;
  const quota: XmlStockHttpQuotaGate = {
    async tryAcquire() {
      return { allowed: false, retryAfterSeconds: 2 };
    },
    async release() {},
    async penalize() {},
    async recordSuccess() {}
  };
  const xmlStockConnector = {
    async fetchResult() {
      providerCalls += 1;
      return { status: "PENDING" as const };
    }
  } as unknown as XmlStockRankConnector;

  assert.equal(
    await service(
      broker,
      {} as ArsenkinRankConnector,
      false,
      1_000,
      xmlStockConnector,
      quota
    ).processOne("connector-worker"),
    "PROVIDER_CAPACITY_DELAYED"
  );
  assert.equal(providerCalls, 0);
  assert.equal(deferredBy, 5);
});

function service(
  broker: RankConnectorRuntimeBrokerService,
  connector: ArsenkinRankConnector,
  submitEnabled: boolean,
  timeoutMs = 1_000,
  xmlStockConnector = {} as XmlStockRankConnector,
  quota: XmlStockHttpQuotaGate = allowXmlStockQuota()
): RankConnectorRuntimeService {
  const crypto = {
    decrypt() {
      return { apiKey: "private-key" };
    }
  } as unknown as IntegrationCredentialCryptoService;
  const config = {
    integrationCredentialValidation: { timeoutMs },
    rankExecution: { submitEnabled }
  } as unknown as AppConfig;
  return new RankConnectorRuntimeService(
    broker,
    crypto,
    connector,
    xmlStockConnector,
    quota as never,
    config
  );
}

function allowXmlStockQuota(): XmlStockHttpQuotaGate {
  return {
    async tryAcquire(input) {
      return {
        allowed: true,
        credentialId: input.credentialId,
        product: input.product,
        member: ids.lease
      };
    },
    async release() {},
    async penalize() {},
    async recordSuccess() {}
  };
}

function claim(): RankConnectorSubmitClaim {
  return {
    provider: "ARSENKIN",
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
        language: "en"
      }
    ]
  };
}

function xmlStockRequestIntent(): RankProviderRequestIntentV1 {
  const intent = requestIntent();
  return {
    ...intent,
    provider: "XMLSTOCK",
    execution: {
      ...intent.execution,
      searchEngine: "YANDEX",
      regionCode: "213",
      providerMappingVersion: "xmlstock-serp@1"
    },
    executionConnectorVersion: "xmlstock-serp@1.0.0",
    providerPolicyVersion: "manual-xmlstock-serp@1.0.0"
  };
}

function providerResult(): unknown {
  return {
    code: "TASK_RESULT",
    task_id: "3944",
    result: {
      table: {
        "seo audit": {
          commerce: [false],
          position: [2],
          top20: "[]",
          url: "https://example.com/page"
        }
      },
      summary: {},
      format: 0
    },
    created_at: "2026-08-02 12:00:00",
    finished_at: "2026-08-02 12:01:00"
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
