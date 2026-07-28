import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { notificationListQuery } from "./notification-center-query.js";

test("parses notification center query", () => {
  assert.deepEqual(
    notificationListQuery({ limit: "20", unreadOnly: "true" }),
    { limit: 20, unreadOnly: true }
  );
});

test("rejects unbounded or ambiguous notification center query", () => {
  assert.throws(
    () => notificationListQuery({ limit: "101" }),
    DomainError
  );
  assert.throws(
    () => notificationListQuery({ unreadOnly: ["true", "false"] }),
    DomainError
  );
});
