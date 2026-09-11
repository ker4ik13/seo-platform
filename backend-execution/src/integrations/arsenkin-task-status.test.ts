import assert from "node:assert/strict";
import test from "node:test";
import { arsenkinTaskLifecycle } from "./arsenkin-task-status.js";

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
