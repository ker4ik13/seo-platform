import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { keepHeartbeatUntilDrained } from "./remote-worker-lifecycle.js";

test("a draining worker keeps heartbeats alive until its running task completes", async () => {
  const heartbeatController = new AbortController();
  const claimController = new AbortController();
  let beats = 0;
  const heartbeat = (async () => {
    while (!heartbeatController.signal.aborted) {
      beats++;
      await delay(5);
    }
  })();
  let finishTask!: () => void;
  const task = new Promise<void>((resolve) => { finishTask = resolve; });
  const lifecycle = keepHeartbeatUntilDrained(heartbeatController, heartbeat, async () => {
    while (!claimController.signal.aborted) await delay(1);
    await task;
  });

  claimController.abort();
  const beforeDrain = beats;
  await delay(20);
  assert.ok(beats > beforeDrain, "heartbeat must continue after claims stop");
  assert.equal(heartbeatController.signal.aborted, false);
  finishTask();
  await lifecycle;
  assert.equal(heartbeatController.signal.aborted, true);
});
