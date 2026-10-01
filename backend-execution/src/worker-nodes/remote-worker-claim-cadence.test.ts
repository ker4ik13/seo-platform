import assert from "node:assert/strict";
import test from "node:test";
import { remoteWorkerClaimDelayMs } from "./remote-worker-claim-cadence.js";

test("one worker polls every five seconds idle and promptly after batch completion", () => {
  assert.equal(remoteWorkerClaimDelayMs(0,0,0,1_000),0);
  assert.equal(remoteWorkerClaimDelayMs(1_000,0,0,2_000),4_000);
  assert.equal(remoteWorkerClaimDelayMs(1_000,0,3,1_500),500);
  assert.equal(remoteWorkerClaimDelayMs(1_000,0,3,2_000),0);
  assert.equal(remoteWorkerClaimDelayMs(2_000,3,3,2_500),4_500);
});
