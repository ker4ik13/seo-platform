import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import type { XmlStockHttpQuotaLimiter } from "../integrations/xmlstock-http-quota-limiter.js";
import type { XmlStockWordstatConnector } from "../frequency-collections/xmlstock-wordstat.connector.js";
import {
  KeywordResearchRuntimeBrokerService,
  type KeywordResearchClaim
} from "./keyword-research-runtime-broker.service.js";
import { KeywordResearchRuntimeService } from "./keyword-research-runtime.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const runId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const credentialId = "01900000-0000-7000-8000-000000000005";
const leaseToken = "01900000-0000-7000-8000-000000000006";
const queries = ["первый запрос", "второй запрос", "третий запрос"];

function claim(): Extract<KeywordResearchClaim, { readonly source: "XMLSTOCK_WORDSTAT" }> {
  return {
    source: "XMLSTOCK_WORDSTAT", provider: "XMLSTOCK",
    runId, workspaceId, projectId, jobId, credentialId,
    page: 1, maxKeywords: 6_000, collectedKeywords: 0,
    runVersion: 2, jobVersion: 2, leaseOwner: "research-worker-1",
    leaseToken, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    encryptedCredential: {} as never,
    input: {
      queries, regionCode: "0", device: "ALL", minusWords: [],
      clearMinusPhrases: false, includeRightColumn: false, clearPlus: false,
      maxKeywords: 6_000
    }
  };
}

function runtime(input: {
  readonly broker: Record<string, unknown>;
  readonly quota?: Record<string, unknown>;
  readonly connector?: Record<string, unknown>;
}): KeywordResearchRuntimeService {
  return new KeywordResearchRuntimeService(
    input.broker as unknown as KeywordResearchRuntimeBrokerService,
    { decrypt: () => ({ apiKey: "disposable-test-key", accountIdentifier: "42" }) } as unknown as IntegrationCredentialCryptoService,
    {} as never,
    {} as never,
    (input.connector ?? {}) as unknown as XmlStockWordstatConnector,
    (input.quota ?? {}) as unknown as XmlStockHttpQuotaLimiter,
    { integrationCredentialValidation: { timeoutMs: 10_000 } } as AppConfig
  );
}

test("one XMLStock Wordstat research run starts distinct seeds concurrently and checkpoints each", async () => {
  const observedQueries: string[] = [];
  const checkpoints: number[] = [];
  const applied: string[] = [];
  let active = 0;
  let peak = 0;
  const worker = runtime({
    broker: {
      claim: async () => claim(),
      xmlStockSeedCheckpoint: async (_claim: unknown, _index: number, begin: boolean) => ({ state: begin ? "STARTED" : "AVAILABLE" }),
      finishXmlStockSeedCheckpoint: async (_claim: unknown, index: number) => { checkpoints.push(index); },
      completeXmlStockSeed: async (_claim: unknown, input: { rows: readonly { sourceQuery: string }[] }) => { applied.push(input.rows[0]!.sourceQuery); }
    },
    quota: {
      tryAcquire: async (input: { credentialId: string; workspaceId: string; product: string }) => ({
        allowed: true, credentialId: input.credentialId, workspaceId: input.workspaceId,
        product: input.product, member: leaseToken
      }),
      release: async () => undefined,
      recordSuccess: async () => undefined
    },
    connector: {
      expand: async (input: { query: string }) => {
        observedQueries.push(input.query);
        active += 1; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return {
          ok: true,
          rows: [{ keyword: input.query, frequencyBase: 1, sourceQuery: input.query, sourceColumn: "LEFT" }],
          raw: { rows: [input.query] }
        };
      }
    }
  });

  assert.equal(await worker.processOne("research-worker-1"), "XMLSTOCK_SEED_APPLIED");
  assert.deepEqual(observedQueries.sort(), [...queries].sort());
  assert.equal(peak, 3);
  assert.deepEqual(checkpoints.sort(), [1, 2, 3]);
  assert.deepEqual(applied, [queries[0]]);
});

test("accepted XMLStock seed is applied without another provider request", async () => {
  let applied = 0;
  const worker = runtime({ broker: {
    claim: async () => claim(),
    xmlStockSeedCheckpoint: async () => ({
      state: "ACCEPTED", responseHash: Buffer.alloc(32),
      rows: [{ keyword: "готово", frequencyBase: 1, sourceQuery: queries[0], sourceColumn: "LEFT" }]
    }),
    completeXmlStockSeed: async () => { applied += 1; }
  } });
  assert.equal(await worker.processOne("research-worker-1"), "XMLSTOCK_SEED_APPLIED");
  assert.equal(applied, 1);
});

test("ambiguous XMLStock seed is skipped while later seeds remain eligible", async () => {
  let skipped = 0;
  const worker = runtime({ broker: {
    claim: async () => claim(),
    xmlStockSeedCheckpoint: async () => ({ state: "UNKNOWN" }),
    skipUnknownXmlStockSeed: async () => { skipped += 1; }
  } });
  assert.equal(await worker.processOne("research-worker-1"), "XMLSTOCK_SEED_APPLIED");
  assert.equal(skipped, 1);
});

test("an interrupted provider response records UNKNOWN and never retries that seed", async () => {
  const states: string[] = [];
  let providerCalls = 0;
  let skipped = 0;
  const worker = runtime({
    broker: {
      claim: async () => claim(),
      xmlStockSeedCheckpoint: async (_claim: unknown, _index: number, begin: boolean) => ({ state: begin ? "STARTED" : "AVAILABLE" }),
      finishXmlStockSeedCheckpoint: async (_claim: unknown, _index: number, input: { state: string }) => { states.push(input.state); },
      skipUnknownXmlStockSeed: async () => { skipped += 1; }
    },
    quota: {
      tryAcquire: async (input: { credentialId: string; workspaceId: string; product: string }) => ({
        allowed: true, credentialId: input.credentialId, workspaceId: input.workspaceId,
        product: input.product, member: leaseToken
      }),
      release: async () => undefined
    },
    connector: { expand: async () => { providerCalls += 1; throw new Error("ambiguous transport"); } }
  });

  assert.equal(await worker.processOne("research-worker-1"), "XMLSTOCK_SEED_APPLIED");
  assert.equal(providerCalls, 3);
  assert.deepEqual(states, ["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  assert.equal(skipped, 1);
});

test("a near-complete Wordstat run does not prepay unused seed requests", async () => {
  const scopedClaim = { ...claim(), maxKeywords: 1 };
  let providerCalls = 0;
  const worker = runtime({
    broker: {
      claim: async () => scopedClaim,
      xmlStockSeedCheckpoint: async (_claim: unknown, _index: number, begin: boolean) => ({ state: begin ? "STARTED" : "AVAILABLE" }),
      finishXmlStockSeedCheckpoint: async () => undefined,
      completeXmlStockSeed: async () => undefined
    },
    quota: {
      tryAcquire: async (input: { credentialId: string; workspaceId: string; product: string }) => ({
        allowed: true, credentialId: input.credentialId, workspaceId: input.workspaceId,
        product: input.product, member: leaseToken
      }),
      release: async () => undefined,
      recordSuccess: async () => undefined
    },
    connector: {
      expand: async (input: { query: string; maxKeywords: number }) => {
        providerCalls += 1;
        assert.equal(input.maxKeywords, 1);
        return {
          ok: true,
          rows: [{ keyword: input.query, frequencyBase: 1, sourceQuery: input.query, sourceColumn: "LEFT" }],
          raw: { rows: [input.query] }
        };
      }
    }
  });
  assert.equal(await worker.processOne("research-worker-1"), "READY_TO_IMPORT");
  assert.equal(providerCalls, 1);
});
