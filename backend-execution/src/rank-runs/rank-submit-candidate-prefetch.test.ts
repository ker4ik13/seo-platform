import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
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

test("30 XMLStock candidates are discovered once and claimed individually", async () => {
  let discoveryCalls = 0;
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

  const results = await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      broker.claimSubmit(
        `worker-${index}`,
        25,
        XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
      )
    )
  );

  assert.equal(discoveryCalls, 1);
  assert.equal(claimed.size, 30);
  assert.equal(peakJobClaims, 1);
  assert.equal(results.filter(Boolean).length, 30);
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
