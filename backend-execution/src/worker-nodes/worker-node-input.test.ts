import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  workerNodeConfiguration,
  workerNodeHeartbeat,
  workerNodeId
} from "./worker-node-input.js";

test("worker registration and heartbeat accept only bounded exact inputs", () => {
  assert.deepEqual(workerNodeConfiguration({
    name: "  office-one  ",
    capabilities: ["RANK", "INSPECTION"],
    maxHttpSlots: 32,
    maxCpuSlots: 4
  }), {
    name: "office-one",
    capabilities: ["RANK", "INSPECTION"],
    maxHttpSlots: 32,
    maxCpuSlots: 4
  });
  assert.deepEqual(workerNodeHeartbeat({
    protocolVersion: 1,
    httpSlots: 16,
    rankSlots: 8,
    cpuSlots: 2,
    memoryBytes: "68719476736",
    activeWorkItems: 3
  }), {
    protocolVersion: 1,
    httpSlots: 16,
    rankSlots: 8,
    cpuSlots: 2,
    memoryBytes: 68_719_476_736n,
    activeWorkItems: 3,
    capabilitySlots: { RANK: 8 }
  });
  assert.throws(() => workerNodeConfiguration({
    name: "node", capabilities: ["RANK", "RANK"], maxHttpSlots: 1, maxCpuSlots: 1
  }), BadRequestException);
  assert.throws(() => workerNodeConfiguration({
    name: "node", capabilities: ["EMAIL"], maxHttpSlots: 1, maxCpuSlots: 1
  }), BadRequestException);
  assert.throws(() => workerNodeHeartbeat({
    protocolVersion: 1, httpSlots: 1, rankSlots: 1, cpuSlots: 1,
    memoryBytes: "1", activeWorkItems: 0, apiKey: "forbidden"
  }), BadRequestException);
  assert.equal(workerNodeHeartbeat({
    protocolVersion: 1, httpSlots: 1, rankSlots: 1, cpuSlots: 1,
    memoryBytes: "1", activeWorkItems: 0, buildHash: "a".repeat(64)
  }).buildHash, "a".repeat(64));
  assert.throws(() => workerNodeHeartbeat({
    protocolVersion: 1, httpSlots: 1, rankSlots: 1, cpuSlots: 1,
    memoryBytes: "1", activeWorkItems: 0, buildHash: "unknown"
  }), BadRequestException);
  assert.throws(() => workerNodeId("not-an-id"), BadRequestException);
});
