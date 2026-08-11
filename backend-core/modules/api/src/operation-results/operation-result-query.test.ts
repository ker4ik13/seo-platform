import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { operationResultPageQuery } from "./operation-result-query.js";

test("normalizes the supported operation result page sizes and cursor", () => {
  assert.deepEqual(operationResultPageQuery(undefined, undefined, 14_999), {
    limit: 200
  });
  assert.deepEqual(operationResultPageQuery("500", "1000", 14_999), {
    limit: 500,
    cursor: "1000"
  });
});

test("rejects unsupported page sizes and out-of-range cursors", () => {
  for (const [limit, cursor] of [
    ["1000", undefined],
    ["201", undefined],
    ["200", "15000"],
    ["200", "01"]
  ] as const) {
    assert.throws(
      () => operationResultPageQuery(limit, cursor, 14_999),
      (error: unknown) =>
        error instanceof DomainError && error.code === "VALIDATION_FAILED"
    );
  }
});
