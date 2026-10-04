import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { WorkerGatewayController } from "./worker-node.controller.js";
import type { WorkerNodeService } from "./worker-node.service.js";
import type { WorkerRankGatewayService } from "./worker-rank-gateway.service.js";

const nodeId = "01900000-0000-7000-8000-000000000001";
const headers = { "x-worker-id": nodeId, authorization: `Bearer wn_${"a".repeat(43)}` };
const entry = { schemaVersion: "worker-rank-poll-result@1", ticket: "signed-ticket", requestSnapshot: {}, outcome: {} };

test("worker result batch crosses the controller with one authenticated node identity", async () => {
  let calls = 0;
  const controller = new WorkerGatewayController(
    {} as WorkerNodeService,
    { async completeBatch(id: string, token: string, entries: readonly unknown[]) {
      calls++;
      assert.equal(id, nodeId);
      assert.equal(token, `wn_${"a".repeat(43)}`);
      assert.equal(entries.length, 2);
      return [true, false];
    } } as unknown as WorkerRankGatewayService
  );
  const response = await controller.completeRankBatch(
    { schemaVersion: "worker-rank-poll-result-batch@1", entries: [entry, entry] },
    headers,
    { id: "request-1" } as FastifyRequest
  );
  assert.deepEqual(response, { data: [true, false], meta: { requestId: "request-1" } });
  assert.equal(calls, 1);
  await assert.rejects(() => controller.completeRankBatch(
    { schemaVersion: "worker-rank-poll-result-batch@1", entries: [{ ...entry, secret: "no" }] },
    headers,
    { id: "request-2" } as FastifyRequest
  ));
  assert.equal(calls, 1);
});
