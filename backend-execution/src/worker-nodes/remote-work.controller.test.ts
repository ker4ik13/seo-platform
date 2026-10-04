import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { RemoteWorkController } from "./remote-work.controller.js";
import type { RemoteWorkGatewayService } from "./remote-work-gateway.service.js";
import type { WorkerRankGatewayService } from "./worker-rank-gateway.service.js";
import type { WorkerNodeService } from "./worker-node.service.js";

const nodeId = "01900000-0000-7000-8000-000000000013";
test("combined claim admits rank and other work independently", async () => {
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
  assert.deepEqual(budgets, [2_500], "rank admission has a finite bounded window");
});

test("slow rank admission does not postpone the first non-rank SQL claim", async () => {
  let releaseRank!: () => void;
  let workStarted = false;
  const rankWait = new Promise<readonly []>((resolve) => { releaseRank = () => resolve([]); });
  const controller = new RemoteWorkController(
    { claim: async () => { workStarted = true; return []; }, cancelled: async () => [] } as unknown as RemoteWorkGatewayService,
    { claimBatch: async () => rankWait } as unknown as WorkerRankGatewayService,
    { authorizeCombinedWork: async () => ({ capabilities: ["RANK", "WORDSTAT"] }) } as unknown as WorkerNodeService
  );
  const pending = controller.claim(
    { httpSlots: 128, cpuSlots: 2, capabilitySlots: { RANK: 128, WORDSTAT: 10 } },
    { "x-worker-id": nodeId, authorization: `Bearer wn_${"a".repeat(43)}` },
    { id: "request-2" } as FastifyRequest
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(workStarted, true);
  releaseRank();
  assert.deepEqual((await pending).data, { work: [], ranks: [], cancelled: [] });
});

test("unused rank reservation is filled by a second bounded work batch", async () => {
  const workSlots: number[] = [];
  const controller = new RemoteWorkController(
    { claim: async (_id: string, _token: string, input: { httpSlots: number }) => {
      workSlots.push(input.httpSlots);
      return Array.from({ length: input.httpSlots }, () => ({ resource: "HTTP", capability: "WORDSTAT" }));
    }, cancelled: async () => [] } as unknown as RemoteWorkGatewayService,
    { claimBatch: async () => [{ ticket: "rank" }] } as unknown as WorkerRankGatewayService,
    { authorizeCombinedWork: async () => ({ capabilities: ["RANK", "WORDSTAT"] }) } as unknown as WorkerNodeService
  );
  const result = await controller.claim(
    { httpSlots: 128, cpuSlots: 2, capabilitySlots: { RANK: 128, WORDSTAT: 128 } },
    { "x-worker-id": nodeId, authorization: `Bearer wn_${"a".repeat(43)}` },
    { id: "request-3" } as FastifyRequest
  );
  assert.deepEqual(workSlots, [64, 63]);
  assert.equal(result.data.ranks.length, 1);
  assert.equal(result.data.work.length, 127);
});
