import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { RemoteWorkController } from "./remote-work.controller.js";
import type { RemoteWorkGatewayService } from "./remote-work-gateway.service.js";
import type { WorkerRankGatewayService } from "./worker-rank-gateway.service.js";
import type { WorkerNodeService } from "./worker-node.service.js";

const nodeId = "01900000-0000-7000-8000-000000000013";
test("combined claim probes rank once before delivering all capability work", async () => {
  const budgets: number[] = [];
  const controller = new RemoteWorkController(
    { claim: async () => [], cancelled: async () => [] } as unknown as RemoteWorkGatewayService,
    { claimBatch: async (_id: string, _token: string, _slots: number, budget: number) => {
      budgets.push(budget); return [];
    } } as unknown as WorkerRankGatewayService,
    { authorizeCombinedWork: async () => ({ capabilities: ["RANK"] }) } as unknown as WorkerNodeService
  );
  const response = await controller.claim(
    { httpSlots: 128, cpuSlots: 2, capabilitySlots: { RANK: 128 } },
    { "x-worker-id": nodeId, authorization: `Bearer wn_${"a".repeat(43)}` },
    { id: "request-1" } as FastifyRequest
  );
  assert.deepEqual(response.data, { work: [], ranks: [], cancelled: [] });
  assert.equal(budgets.length, 1);
  assert.ok(budgets.every(budget => budget > 0 && budget <= 5_000));
});
