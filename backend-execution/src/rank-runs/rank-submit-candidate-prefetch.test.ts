import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { AdaptiveRankLaneDemand } from "../queue/connector-runtime-dispatch.js";
import { RankConnectorRuntimeBrokerService } from "./rank-connector-runtime-broker.service.js";
import {
  ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION,
  XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
} from "./rank-execution-evidence.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const credentialId = "01900000-0000-7000-8000-000000000002";
const leaseToken = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const candidates = Array.from({ length: 30 }, (_, index) =>
  `01900000-0000-7000-8000-${String(index + 100).padStart(12, "0")}`
);

function claimRow(executionId: string, provider = "XMLSTOCK") {
  return {
    executionId,
    provider,
    workspaceId,
    credentialId,
    credentialMaterialVersion: 1,
    leaseToken,
    leaseExpiresAt: new Date(Date.now() + 25_000),
    leaseGeneration: 1,
    executionVersion: 2,
    ciphertext: Buffer.from([1]),
    nonce: Buffer.alloc(12),
    authTag: Buffer.alloc(16),
    encryptedDataKey: Buffer.from([1]),
    dataKeyNonce: Buffer.alloc(12),
    dataKeyAuthTag: Buffer.alloc(16),
    keyVersion: 1
  };
}

test("30 XMLStock candidates need one ID scan and two fenced SQL claim waves", async () => {
  let discoveryCalls = 0;
  let batchCalls = 0;
  const claimed = new Set<string>();
  let activeJobClaims = 0;
  let peakJobClaims = 0;
  const prisma = {
    async $queryRaw(query: { strings: readonly string[]; values: readonly unknown[] }) {
      const sql = query.strings.join("?");
      if (sql.includes("list_rank_connector_submit_candidates")) {
        discoveryCalls += 1;
        return candidates.map((executionId) => ({ executionId, jobId }));
      }
      if (sql.includes("unnest(") && sql.includes("claim_rank_connector_submit_targeted")) {
        batchCalls++;
        const batchIds = query.values.filter((value): value is string =>
          typeof value === "string" && candidates.includes(value));
        for (const executionId of batchIds) claimed.add(executionId);
        return batchIds.map((executionId) => claimRow(executionId));
      }
      assert.match(sql, /claim_rank_connector_submit_targeted/u);
      const executionId = query.values.at(-1);
      assert.ok(typeof executionId === "string");
      assert.ok(!claimed.has(executionId));
      claimed.add(executionId);
      activeJobClaims += 1;
      peakJobClaims = Math.max(peakJobClaims, activeJobClaims);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeJobClaims -= 1;
      return [claimRow(executionId)];
    }
  } as unknown as PrismaService;
  const broker = new RankConnectorRuntimeBrokerService(prisma);
  assert.equal(broker.pendingSubmitCandidates(), 0);
  const first = await broker.claimSubmit("worker-0", 25, XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION);
  assert.ok(first);
  assert.equal(broker.pendingSubmitCandidates(), 29, "cached backlog must wake the connector lanes");
  const laneDemand = new AdaptiveRankLaneDemand(32);
  laneDemand.started();
  laneDemand.finished("SUBMITTED");
  const burst = laneDemand.nextBurst(Math.ceil(broker.pendingSubmitCandidates() / 16));
  assert.equal(burst, 2, "the remaining cached IDs need two bounded waves, not 29 lanes");
  const batches = await Promise.all([
    broker.claimXmlStockSubmitBatch("worker-batch-1", 25, 15),
    broker.claimXmlStockSubmitBatch("worker-batch-2", 25, 15)
  ]);
  const results = batches.flat();

  assert.equal(discoveryCalls, 1);
  assert.equal(batchCalls, 2, "the remaining pages need two SQL round-trips, not 29");
  assert.equal(claimed.size, 30);
  assert.equal(peakJobClaims, 1);
  assert.equal(results.length, 29);
  assert.equal(broker.pendingSubmitCandidates(), 0);
});

test("stale candidate is skipped; Arsenkin keeps its existing bounded claim", async () => {
  let discoveryCalls = 0;
  let targetedCalls = 0;
  const prisma = {
    async $queryRaw(query: { strings: readonly string[]; values: readonly unknown[] }) {
      const sql = query.strings.join("?");
      if (sql.includes("list_rank_connector_submit_candidates")) {
        discoveryCalls += 1;
        return candidates.slice(0, 2).map((executionId) => ({ executionId, jobId }));
      }
      if (sql.includes("claim_rank_connector_submit_targeted")) {
        targetedCalls += 1;
        return targetedCalls === 1 ? [] : [claimRow(candidates[1]!)];
      }
      assert.match(sql, /claim_rank_connector_submit_bounded/u);
      return [claimRow(candidates[2]!, "ARSENKIN")];
    }
  } as unknown as PrismaService;
  const broker = new RankConnectorRuntimeBrokerService(prisma);

  const xmlstock = await broker.claimSubmit(
    "worker-1", 25, XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
  );
  const arsenkin = await broker.claimSubmit(
    "worker-2", 25, ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION
  );

  assert.equal(discoveryCalls, 1);
  assert.equal(targetedCalls, 2);
  assert.equal(xmlstock?.executionId, candidates[1]);
  assert.equal(arsenkin?.provider, "ARSENKIN");
});

test("remote rank poll reuses the cached ID page for one SQL batch per wave", async () => {
  let scans = 0;
  let batchCalls = 0;
  const prisma = {
    async $queryRaw(query: { strings: readonly string[] }) {
      const sql = query.strings.join("?");
      if (sql.includes("list_rank_connector_poll_candidates_for_worker")) {
        scans++;
        return candidates.map((executionId) => ({ executionId, jobId }));
      }
      assert.match(sql, /unnest\(.+claim_rank_connector_poll_targeted/su);
      batchCalls++;
      return [];
    }
  } as unknown as PrismaService;
  const broker = new RankConnectorRuntimeBrokerService(prisma);
  const owner = "remote:01900000-0000-7000-8000-000000000006:01900000-0000-7000-8000-000000000007";
  assert.deepEqual(await broker.claimXmlStockPollBatch(owner, 90, 16), { claims: [], examined: 16 });
  assert.deepEqual(await broker.claimXmlStockPollBatch(owner, 90, 14), { claims: [], examined: 14 });
  assert.equal(scans, 1, "the 100-ID hint must not be rescanned per wave");
  assert.equal(batchCalls, 2, "thirty targeted fences need only two DB calls");
});
