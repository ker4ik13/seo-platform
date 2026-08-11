import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { platformAdminOperationQuery } from "./platform-admin-operation-input.js";

test("normalizes a bounded platform operation query", () => {
  assert.deepEqual(
    platformAdminOperationQuery({
      status: " active ",
      type: " manual_rank_check ",
      cursor: "01900000-0000-7000-8000-000000000010",
      limit: "100"
    }),
    {
      statusGroup: "ACTIVE",
      type: "MANUAL_RANK_CHECK",
      cursor: "01900000-0000-7000-8000-000000000010",
      limit: 100
    }
  );
  assert.deepEqual(platformAdminOperationQuery({}), {
    statusGroup: "ALL",
    limit: 50
  });
});

test("rejects unbounded or malformed platform operation queries", () => {
  for (const input of [
    { status: "UNKNOWN" },
    { type: "rank check" },
    { cursor: "not-a-uuid" },
    { limit: "500" }
  ]) {
    assert.throws(
      () => platformAdminOperationQuery(input),
      BadRequestException
    );
  }
});
