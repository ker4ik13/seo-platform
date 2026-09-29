import assert from "node:assert/strict";
import test from "node:test";
import { adminOperationRefreshSeconds } from "./admin-operation-refresh.ts";

test("admin refresh interval restores only supported URL seconds", () => {
  for (const seconds of [3, 5, 10, 15]) {
    assert.equal(adminOperationRefreshSeconds(String(seconds)), seconds);
  }
  for (const value of [null, "", "0", "2", "20", "5.5", "5foo"]) {
    assert.equal(adminOperationRefreshSeconds(value), 15);
  }
});
