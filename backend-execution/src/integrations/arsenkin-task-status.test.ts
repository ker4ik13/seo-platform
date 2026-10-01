import assert from "node:assert/strict";
import test from "node:test";
import { arsenkinTaskLifecycle,arsenkinPollTimeoutMs } from "./arsenkin-task-status.js";

test("Arsenkin task reads allow slow check/get without extending paid submit", () => {
  assert.equal(arsenkinPollTimeoutMs(10_000),30_000);
  assert.equal(arsenkinPollTimeoutMs(45_000),45_000);
});

test("keeps every bounded Arsenkin queue status pending", () => {
  for (const status of ["queue", "queued", "wait", "waiting", "pending"]) {
    assert.equal(arsenkinTaskLifecycle(status, 0), "PENDING");
    assert.equal(arsenkinTaskLifecycle(status, undefined), "PENDING");
  }
  assert.equal(arsenkinTaskLifecycle("process", "42%"), "PENDING");
  assert.equal(arsenkinTaskLifecycle("finish", 100), "FINISHED");
});

test("rejects contradictory or unknown Arsenkin task lifecycles", () => {
  for (const [status, progress] of [
    ["finish", 99],
    ["process", 100],
    ["failed", 0],
    ["unknown", 10],
    ["finish", "done"]
  ] as const) {
    assert.equal(arsenkinTaskLifecycle(status, progress), undefined);
  }
});
