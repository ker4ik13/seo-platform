import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { RankConnectorRuntimeBrokerService } from "./rank-connector-runtime-broker.service.js";
import {
  ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION,
  XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
} from "./rank-execution-evidence.js";

test("concurrent empty poll lanes share one database probe per provider", async () => {
  const calls = new Map<string, number>();
  const prisma = {
    async $queryRaw(query: { strings: readonly string[]; values: readonly unknown[] }) {
      assert.match(query.strings.join("?"), /claim_rank_connector_poll/u);
      const version = String(query.values[2]);
      calls.set(version, (calls.get(version) ?? 0) + 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      return [];
    }
  } as unknown as PrismaService;
  const broker = new RankConnectorRuntimeBrokerService(prisma);

  const claims = await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      broker.claimPoll(
        `poll-${index}`,
        25,
        index % 2 === 0
          ? XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION
          : ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION
      )
    )
  );
  assert.ok(claims.every((claim) => claim === undefined));
  assert.equal(calls.get(XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION), 1);
  assert.equal(calls.get(ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION), 1);

  await broker.claimPoll("before-recheck", 25, XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION);
  assert.equal(calls.get(XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION), 1);
  await new Promise<void>((resolve) => setTimeout(resolve, 510));
  await broker.claimPoll("after-recheck", 25, XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION);
  assert.equal(calls.get(XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION), 2);
});

test("empty Arsenkin submit lanes share a probe without swallowing errors", async () => {
  let calls = 0;
  const prisma = {
    async $queryRaw(query: { strings: readonly string[] }) {
      assert.match(query.strings.join("?"), /claim_rank_connector_submit_bounded/u);
      calls += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      if (calls === 1) throw new Error("database unavailable");
      return [];
    }
  } as unknown as PrismaService;
  const broker = new RankConnectorRuntimeBrokerService(prisma);
  await assert.rejects(
    broker.claimSubmit("failed", 25, ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION),
    /database unavailable/u
  );

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      broker.claimSubmit(`submit-${index}`, 25, ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION)
    )
  );
  assert.ok(results.every((claim) => claim === undefined));
  assert.equal(calls, 2);
});
