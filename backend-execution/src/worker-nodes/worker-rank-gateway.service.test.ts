import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { utf8Sha256 } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import type { IntegrationCredentialCryptoService } from "../integrations/integration-credential-crypto.service.js";
import type { PlatformCredentialPoolSelectionService } from "../integrations/platform-credential-pool-selection.service.js";
import type { XmlStockHttpQuotaLimiter } from "../integrations/xmlstock-http-quota-limiter.js";
import type { RankBillingSettlementClient } from "../platform-api/rank-billing-settlement.client.js";
import type { RankConnectorRuntimeBrokerService } from "../rank-runs/rank-connector-runtime-broker.service.js";
import { rankProviderRequestIntent, type RankProviderRequestIntentV1 } from "../rank-runs/rank-provider-request-intent.js";
import { xmlStockRankPageProgressHash } from "../rank-runs/xmlstock-rank.connector.js";
import { WorkerNodeService } from "./worker-node.service.js";
import { WorkerRankGatewayService } from "./worker-rank-gateway.service.js";
import { parseWorkerRankTask } from "./worker-rank-task.js";

const id = {
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
  lease: "01900000-0000-7000-8000-000000000012",
  node: "01900000-0000-7000-8000-000000000013",
  quotaMember: "01900000-0000-7000-8000-000000000014"
} as const;

test("remote rank poll uses node cap and shared physical key, then fences completion", async () => {
  const events: string[] = [];
  let paid = false;
  const request = requestIntent();
  const claim = {
    provider: "XMLSTOCK" as const,
    executionId: id.execution,
    workspaceId: id.workspace,
    credentialId: id.credential,
    credentialMaterialVersion: 1,
    leaseOwner: `remote:${id.node}:${id.lease}`,
    leaseToken: id.lease,
    leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
    leaseGeneration: 1,
    executionVersion: 3,
    encryptedCredential: { keyVersion: 1 },
    providerTaskId: "task-123",
    request
  };
  const nodes = {
    async authorizeForWork(nodeId: string) {
      assert.equal(nodeId, id.node);
      return { httpSlots: 24, cpuSlots: 4 };
    },
    async authenticateForCompletion() { events.push("authenticated"); }
  } as unknown as WorkerNodeService;
  const broker = {
    async claimXmlStockPollBatch() { return { claims: [claim], examined: 1 }; },
    async readBillingSettlement() { return { required: paid, grantId: id.lease }; },
    async completePoll(_claim: unknown, input: { readonly outcome: string }) {
      events.push(`completed:${input.outcome}`);
      return { status: "POLL_WAIT" };
    }
  } as unknown as RankConnectorRuntimeBrokerService;
  const crypto = {
    decrypt() {
      return {
        apiKey: "test-secret",
        accountIdentifier: "test-account",
        rateLimitScopeId: id.credential
      };
    }
  } as unknown as IntegrationCredentialCryptoService;
  const platformPool = {
    async select(_provider: unknown, secret: unknown) { return secret; }
  } as unknown as PlatformCredentialPoolSelectionService;
  const quota = {
    async tryAcquire(input: { readonly credentialId: string; readonly nodeId: string; readonly nodeConcurrency: number }) {
      assert.equal(input.credentialId, id.credential);
      assert.equal(input.nodeId, id.node);
      assert.equal(input.nodeConcurrency, 24);
      events.push("permit");
      return {
        allowed: true, credentialId: id.credential, workspaceId: id.workspace,
        product: "YANDEX_LIVE", member: id.quotaMember, nodeId: id.node
      };
    },
    async release() { events.push("released"); },
    async recordSuccess() { events.push("quota-observed"); }
  } as unknown as XmlStockHttpQuotaLimiter;
  const settlement = {
    async hold() { events.push("hold"); },
    async capture() { events.push("capture"); },
    async release() { events.push("balance-release"); }
  } as unknown as RankBillingSettlementClient;
  const config = {
    workerGatewayEnabled: true,
    integrationCredentials: {
      role: "BOTH",
      activeKeyVersion: 1,
      keys: new Map([[1, Buffer.alloc(32, 9)]])
    }
  } as unknown as AppConfig;
  const gateway = new WorkerRankGatewayService(
    nodes, broker, crypto, platformPool, quota, settlement, config
  );
  const [task] = await gateway.claimBatch(id.node, "node-token", 1);
  assert.ok(task);
  assert.equal(task.secret.apiKey, "test-secret");
  assert.equal(task.requestSnapshot, request);
  assert.equal(JSON.stringify(task.ticket).includes("test-secret"), false);
  assert.deepEqual(await gateway.complete(id.node, "node-token", task.ticket, request, {
    status: "RETRYABLE_FAILURE", code: "PROVIDER_UNAVAILABLE"
  }), { status: "POLL_WAIT" });
  assert.deepEqual(events, [
    "permit", "authenticated", "completed:RETRYABLE_FAILURE", "released"
  ]);
  await assert.rejects(() => gateway.complete(
    id.node, "node-token", task.ticket, request,
    { status: "READY", value: { invalid: true } }
  ), TypeError);
  assert.deepEqual(events.slice(-3), [
    "authenticated", "completed:REJECTED", "released"
  ]);

  paid = true;
  const [paidTask] = await gateway.claimBatch(id.node, "node-token", 1);
  assert.ok(paidTask);
  assert.deepEqual(events.slice(-2), ["permit", "hold"]);
  const progress = {
    schemaVersion: "xmlstock-rank-page-progress@1" as const,
    taskId: "task-123",
    engine: "YANDEX" as const,
    depth: 30 as const,
    nextPage: 1,
    documents: [{ position: 1, url: "https://example.com/" }]
  };
  const authenticatedBeforeBatch = events.filter((event) => event === "authenticated").length;
  assert.deepEqual(await gateway.completeBatch(id.node, "node-token", [
    { schemaVersion: "worker-rank-poll-result@1", ticket: paidTask.ticket,
      requestSnapshot: request, outcome: { status: "CHECKPOINTED", progress, hash: xmlStockRankPageProgressHash(progress) } },
    { schemaVersion: "worker-rank-poll-result@1", ticket: "invalid",
      requestSnapshot: request, outcome: { status: "PENDING", retryAfterSeconds: 1 } }
  ]), [true, false]);
  assert.equal(events.filter((event) => event === "authenticated").length, authenticatedBeforeBatch + 1);
  assert.deepEqual(events.slice(-4), [
    "quota-observed", "capture", "completed:CHECKPOINTED", "released"
  ]);
});

test("one empty batch poll authenticates once and never polls per free slot", async () => {
  let authorizations = 0;
  let claims = 0;
  const gateway = new WorkerRankGatewayService(
    {
      async authorizeForWork() {
        authorizations += 1;
        return { httpSlots: 64, cpuSlots: 4 };
      }
    } as unknown as WorkerNodeService,
    {
      async claimXmlStockPollBatch() {
        claims += 1;
        return { claims: [], examined: 0 };
      }
    } as unknown as RankConnectorRuntimeBrokerService,
    {} as IntegrationCredentialCryptoService,
    {} as PlatformCredentialPoolSelectionService,
    {} as XmlStockHttpQuotaLimiter,
    {} as RankBillingSettlementClient,
    {
      workerGatewayEnabled: true,
      integrationCredentials: { role: "BOTH" }
    } as AppConfig
  );
  assert.deepEqual(await gateway.claimBatch(id.node, "node-token", 64), []);
  assert.equal(authorizations, 1);
  assert.equal(claims, 1);
});

test("one busy worker poll returns 64 fenced rank pages without unbounded claims", async () => {
  let claimed = 0;
  let databaseCalls = 0;
  const request = requestIntent();
  const gateway = new WorkerRankGatewayService(
    { authorizeForWork: async () => ({ httpSlots: 100, cpuSlots: 2 }) } as unknown as WorkerNodeService,
    {
      claimXmlStockPollBatch: async (owner: string, _seconds: number, size: number) => {
        databaseCalls++;
        await delay(2);
        const claims = Array.from({ length: Math.min(size, 64 - claimed) }, () => {
          claimed++;
          return { provider: "XMLSTOCK", workspaceId: id.workspace, credentialId: id.credential,
            executionId: randomUUID(), request, encryptedCredential: { keyVersion: 1 },
            providerTaskId: `task-${claimed}`, leaseOwner: owner, leaseToken: randomUUID(), leaseGeneration: 1,
            executionVersion: 1, leaseExpiresAt: new Date(Date.now() + 90_000).toISOString() };
        });
        return { claims, examined: claims.length };
      },
      readBillingSettlement: async () => ({ required: false })
    } as unknown as RankConnectorRuntimeBrokerService,
    { decrypt: () => ({ apiKey: "test-secret", accountIdentifier: "test-account", rateLimitScopeId: id.credential }) } as unknown as IntegrationCredentialCryptoService,
    { select: async (_provider: unknown, secret: unknown) => secret } as unknown as PlatformCredentialPoolSelectionService,
    { tryAcquire: async () => ({ allowed: true, credentialId: id.credential, workspaceId: id.workspace,
      product: "YANDEX_LIVE", member: randomUUID(), nodeId: id.node }) } as unknown as XmlStockHttpQuotaLimiter,
    {} as RankBillingSettlementClient,
    { workerGatewayEnabled: true, integrationCredentials: { role: "BOTH", activeKeyVersion: 1,
      keys: new Map([[1, Buffer.alloc(32, 9)]]) } } as unknown as AppConfig
  );

  const tasks = await gateway.claimBatch(id.node, "token", 100, 500);
  assert.equal(tasks.length, 64);
  assert.equal(claimed, 64);
  assert.equal(databaseCalls, 4, "64 pages need four SQL round-trips, not 64");
  assert.equal(new Set(tasks.map((task) => parseWorkerRankTask(task).ticket)).size, 64);
});

test("a full Live key does not starve Google XML or Yandex XML in the same worker batch", async () => {
  const google = requestIntent();
  const googleIntent = { ...google, execution: { ...google.execution, searchEngine: "GOOGLE" as const, providerMappingVersion: "xmlstock-google-live@2" } };
  const xmlIntent = { ...google, execution: { ...google.execution, providerMappingVersion: "xmlstock-yandex-search-api@2" } };
  const requests = [requestIntent(), googleIntent, xmlIntent];
  const deferred: unknown[] = [], products: string[] = [];
  const config = { workerGatewayEnabled: true, integrationCredentials: {
    role: "BOTH", activeKeyVersion: 1, keys: new Map([[1, Buffer.alloc(32, 9)]])
  } } as unknown as AppConfig;
  const gateway = new WorkerRankGatewayService(
    { authorizeForWork: async () => ({ httpSlots: 32 }) } as unknown as WorkerNodeService,
    {
      claimXmlStockPollBatch: async (owner: string, _seconds: number, size: number) => {
        const claims = Array.from({ length: size }, () => requests.shift()).filter((request): request is RankProviderRequestIntentV1 => request !== undefined).map(request => ({ provider: "XMLSTOCK", workspaceId: id.workspace, credentialId: id.credential,
          executionId: id.execution, request, encryptedCredential: { keyVersion: 1 },
          providerTaskId: "task-123", leaseOwner: owner, leaseToken: id.lease, leaseGeneration: 1,
          executionVersion: 1, leaseExpiresAt: new Date(Date.now() + 90_000).toISOString() }));
        return { claims, examined: claims.length };
      },
      deferPollForProviderCapacity: async (...args: unknown[]) => { deferred.push(args); },
      readBillingSettlement: async () => ({ required: false })
    } as unknown as RankConnectorRuntimeBrokerService,
    { decrypt: () => ({ apiKey: "test-secret", accountIdentifier: "test-account", rateLimitScopeId: id.credential }) } as unknown as IntegrationCredentialCryptoService,
    { select: async (_provider: unknown, secret: unknown) => secret } as unknown as PlatformCredentialPoolSelectionService,
    { tryAcquire: async (input: { product:string }) => {
      products.push(input.product);
      return input.product === "YANDEX_LIVE" ? { allowed: false, retryAfterSeconds: 1 } :
        { allowed: true, credentialId: id.credential, workspaceId: id.workspace, product: input.product, member: id.quotaMember, nodeId: id.node };
    } } as unknown as XmlStockHttpQuotaLimiter,
    {} as RankBillingSettlementClient, config
  );
  const tasks = await gateway.claimBatch(id.node, "token", 2);
  assert.equal(tasks.length, 2); assert.equal(deferred.length, 1);
  assert.deepEqual(products, ["YANDEX_LIVE", "GOOGLE_LIVE", "YANDEX_SEARCH_API"]);
  // The actual agent's strict parser must accept both tasks, not only Live.
  assert.deepEqual(tasks.map(task => rankProviderRequestIntent(parseWorkerRankTask(task).requestSnapshot).execution.searchEngine), ["GOOGLE", "YANDEX"]);
});

test("full provider quotas use a bounded scan, not a retry loop without end", async () => {
  let claims = 0;
  const gateway = new WorkerRankGatewayService(
    { authorizeForWork: async () => ({ httpSlots: 32 }) } as unknown as WorkerNodeService,
    { claimXmlStockPollBatch: async (_owner: string, _seconds: number, size: number) => { claims += size; return { claims: Array.from({ length: size }, () => ({ provider: "XMLSTOCK", providerProgressInvalid: true })), examined: size }; }, completePoll: async () => ({ status: "FAILED_FINAL" }) } as unknown as RankConnectorRuntimeBrokerService,
    {} as IntegrationCredentialCryptoService, {} as PlatformCredentialPoolSelectionService,
    {} as XmlStockHttpQuotaLimiter, {} as RankBillingSettlementClient,
    { workerGatewayEnabled: true, integrationCredentials: { role: "BOTH" } } as AppConfig
  );
  assert.deepEqual(await gateway.claimBatch(id.node, "token", 32), []);
  assert.equal(claims, 128);
});

test("a saturated rank pass obeys the caller's short budget", async () => {
  let probes = 0;
  const gateway = new WorkerRankGatewayService(
    { authorizeForWork: async () => ({ httpSlots: 128 }) } as unknown as WorkerNodeService,
    { claimXmlStockPollBatch: async (_owner: string, _seconds: number, size: number) => { probes += size; return { claims: Array.from({ length: size }, () => ({ provider: "XMLSTOCK", providerProgressInvalid: true })), examined: size }; },
      completePoll: async () => { await new Promise(resolve => setTimeout(resolve, 2)); return { status: "FAILED_FINAL" }; } } as unknown as RankConnectorRuntimeBrokerService,
    {} as IntegrationCredentialCryptoService, {} as PlatformCredentialPoolSelectionService,
    {} as XmlStockHttpQuotaLimiter, {} as RankBillingSettlementClient,
    { workerGatewayEnabled: true, integrationCredentials: { role: "BOTH" } } as AppConfig
  );
  const startedAt = Date.now();
  assert.deepEqual(await gateway.claimBatch(id.node, "token", 128, 20), []);
  assert.ok(probes > 0 && probes <= 128, "a saturated pass has a fixed candidate ceiling");
  assert.ok(Date.now() - startedAt < 200);
});

function requestIntent(): RankProviderRequestIntentV1 {
  const hash = (value: string) => ({ algorithm: "SHA_256" as const, value: value.repeat(64) });
  return {
    schemaVersion: "rank-provider-request-intent@1",
    workspaceId: id.workspace,
    projectId: id.project,
    actorId: id.actor,
    jobId: id.job,
    jobItemId: id.item,
    estimateId: id.estimate,
    provider: "XMLSTOCK",
    operation: "POSITIONS",
    project: { domain: "example.com", version: 1 },
    execution: {
      searchEngine: "YANDEX", countryCode: "RU", regionCode: "213",
      language: "ru", device: "DESKTOP", depth: 30,
      domainMatchRule: { mode: "EXACT_HOST" }, safeSearch: false,
      format: "SIMPLE", rawSerp: false, fallbackMode: "NONE",
      providerMappingVersion: "xmlstock-yandex-live@2"
    },
    manifest: {
      id: id.manifest, hashSchemaVersion: "rank-manifest@1",
      manifestHash: hash("a"), pairCount: "1"
    },
    manifestChunk: {
      manifestId: id.manifest, chunkIndex: 0,
      hashSchemaVersion: "rank-manifest-chunk@1", chunkHash: hash("b")
    },
    executionConnectorVersion: "xmlstock-serp@1.0.0",
    providerPolicyVersion: "manual-xmlstock-serp@1.0.0",
    keywords: [{
      manifestEntryId: id.entry, sequence: 0, keywordId: id.keyword,
      keywordText: "seo audit",
      keywordTextHash: { algorithm: "SHA_256", value: utf8Sha256("seo audit") },
      language: "en"
    }]
  };
}
