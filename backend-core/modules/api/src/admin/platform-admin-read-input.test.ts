import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  adminOperationQuery,
  adminProjectQuery
} from "./platform-admin-read-input.js";

test("normalizes project and operation administration filters", () => {
  assert.deepEqual(adminProjectQuery({ q: "  Нейролюб  ", status: " active " }), {
    search: "Нейролюб",
    status: "ACTIVE"
  });
  assert.deepEqual(adminProjectQuery({ status: "ALL" }), { search: "" });
  assert.deepEqual(
    adminOperationQuery({
      status: "completed",
      type: "manual_rank_check",
      cursor: "01900000-0000-7000-8000-000000000010",
      limit: "20"
    }),
    {
      statusGroup: "COMPLETED",
      type: "MANUAL_RANK_CHECK",
      cursor: "01900000-0000-7000-8000-000000000010",
      limit: 20
    }
  );
});

test("rejects malformed platform administration filters", () => {
  for (const call of [
    () => adminProjectQuery({ status: "UNKNOWN" }),
    () => adminOperationQuery({ status: "UNKNOWN" }),
    () => adminOperationQuery({ type: "rank check" }),
    () => adminOperationQuery({ cursor: "invalid" }),
    () => adminOperationQuery({ limit: "500" })
  ]) {
    assert.throws(call, DomainError);
  }
});
