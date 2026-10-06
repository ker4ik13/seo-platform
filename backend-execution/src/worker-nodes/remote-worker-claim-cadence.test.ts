import assert from "node:assert/strict";
import test from "node:test";
import { remoteWorkerClaimDelayMs,remoteWorkerFamilyHttpSlots } from "./remote-worker-claim-cadence.js";

test("independent rank and non-rank polls share the free HTTP capacity",()=>{
  assert.equal(remoteWorkerFamilyHttpSlots(128,128),64);
  assert.equal(remoteWorkerFamilyHttpSlots(63,10),32);
  assert.equal(remoteWorkerFamilyHttpSlots(1,10),1);
  assert.equal(remoteWorkerFamilyHttpSlots(128,0),128);
  assert.equal(remoteWorkerFamilyHttpSlots(0,10),0);
  assert.throws(()=>remoteWorkerFamilyHttpSlots(-1,10),TypeError);
});

test("one worker polls every five seconds idle and promptly after batch completion", () => {
  assert.equal(remoteWorkerClaimDelayMs(0,0,0,1_000),0);
  assert.equal(remoteWorkerClaimDelayMs(1_000,0,0,2_000),4_000);
  assert.equal(remoteWorkerClaimDelayMs(1_000,0,3,1_050),0);
  assert.equal(remoteWorkerClaimDelayMs(1_000,0,3,1_100),0);
  assert.equal(remoteWorkerClaimDelayMs(2_000,3,3,2_500),4_500);
});

test("a recent task keeps one server poll warm for bounded refill attempts", () => {
  assert.equal(remoteWorkerClaimDelayMs(1_000,1,1,1_050,4),50);
  assert.equal(remoteWorkerClaimDelayMs(2_000,1,1,2_100,3),150);
  assert.equal(remoteWorkerClaimDelayMs(3_000,1,1,3_250,2),250);
  assert.equal(remoteWorkerClaimDelayMs(4_000,1,1,4_500,1),500);
  assert.equal(remoteWorkerClaimDelayMs(5_000,1,1,5_500,0),4_500);
});
