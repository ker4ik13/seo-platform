import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCreatedWorkerNode,
  parseWorkerNodeConfiguration,
  parseWorkerNodeView
  ,parseWorkerNodeRemovalInput, parseRemovedWorkerNode
} from "./worker-nodes.js";

const node = {
  id: "01900000-0000-7000-8000-000000000001",
  name: "office-one",
  enabled: true,
  draining: false,
  capabilities: ["RANK", "INSPECTION"],
  maxHttpSlots: 24,
  maxCpuSlots: 4,
  reportedHttpSlots: 16,
  reportedRankSlots: 8,
  reportedCpuSlots: 2,
  reportedMemoryBytes: "68719476736",
  activeWorkItems: 3,
  online: true,
  lastHeartbeatAt: "2026-09-29T12:00:00.000Z",
  protocolVersion: 1
};

test("worker contracts accept exact safe views and reject secret extensions", () => {
  assert.deepEqual(parseWorkerNodeView(node), node);
  assert.equal(parseWorkerNodeView({
    ...node,
    activeAssignments: [{
      jobId: node.id,
      capability: "RANK",
      searchEngine: "YANDEX",
      activeTasks: 3
    }]
  }).activeAssignments?.[0]?.activeTasks, 3);
  assert.equal(parseCreatedWorkerNode({
    node, token: `wn_${"a".repeat(43)}`
  }).node.id, node.id);
  assert.equal(parseWorkerNodeView({ ...node, activeAssignments: [{ jobId: node.id, capability: "RANK", searchEngine: null, activeTasks: 0 }] }).activeAssignments?.[0]?.activeTasks, 0);
  assert.throws(() => parseWorkerNodeView({ ...node, apiKey: "secret" }));
  assert.throws(() => parseWorkerNodeView({
    ...node, capabilities: ["EMAIL"]
  }));
  assert.deepEqual(parseWorkerNodeConfiguration({
    name: " office-one ", capabilities: ["RANK"],
    maxHttpSlots: 16, maxCpuSlots: 2
  }), {
    name: "office-one", capabilities: ["RANK"],
    maxHttpSlots: 16, maxCpuSlots: 2
  });
});

test("worker deletion requires explicit confirmation and a secret-free receipt", () => {
  assert.deepEqual(parseWorkerNodeRemovalInput({ confirmed: true }), { confirmed: true });
  for (const input of [{}, { confirmed: false }, { confirmed: true, token: "forbidden" }]) assert.throws(() => parseWorkerNodeRemovalInput(input));
  const removed = { id: node.id, deletedAt: new Date().toISOString() };
  assert.deepEqual(parseRemovedWorkerNode(removed), removed);
  assert.throws(() => parseRemovedWorkerNode({ ...removed, token: "forbidden" }));
});
