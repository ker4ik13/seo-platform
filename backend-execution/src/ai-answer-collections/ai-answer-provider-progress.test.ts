import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import {
  AiAnswerRuntimeBrokerService,
  type AiAnswerClaim
} from "./ai-answer-runtime-broker.service.js";

const jobId = "01900000-0000-7000-8000-000000000001";
const itemId = "01900000-0000-7000-8000-000000000002";

test("fenced Arsenkin defer carries the current task percentage in one broker call", async () => {
  const statements: Array<{ readonly sql: string; readonly values: readonly unknown[] }> = [];
  const broker = new AiAnswerRuntimeBrokerService({
    $queryRaw: async (statement: { readonly sql: string; readonly values: readonly unknown[] }) => {
      statements.push(statement);
      return [{ jobId, jobVersion: 2 }];
    }
  } as unknown as PrismaService);
  const claim = {
    jobId,
    jobVersion: 1,
    leaseOwner: "worker-1",
    items: [{ jobItemId: itemId }]
  } as unknown as AiAnswerClaim;

  await broker.defer(claim, "task-1", 5, 0, true);
  await broker.defer(claim, "task-1", 5, 87, false);
  await broker.defer(claim, "task-1", 5, undefined, false);
  assert.equal(statements.length, 3);
  assert.ok(statements.every(({ sql }) => sql.includes("defer_ai_answer_collection_batch")));
  assert.deepEqual(statements.map(({ values }) => values.slice(-2)), [
    [0, true],
    [87, false],
    [null, false]
  ]);
  await assert.rejects(() => broker.defer(claim, "task-1", 5, 101, false), TypeError);
  assert.equal(statements.length, 3);
});
