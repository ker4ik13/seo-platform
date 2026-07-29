import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { notificationListQuery } from "./notification-center-query.js";

test("parses bounded notification list filters", () => {
  assert.deepEqual(
    notificationListQuery({ limit: "50", unreadOnly: "true" }),
    { limit: 50, unreadOnly: true }
  );
  assert.deepEqual(notificationListQuery({}), {
    limit: 30,
    unreadOnly: false
  });
});

test("rejects duplicate and invalid notification filters", () => {
  assert.throws(
    () => notificationListQuery({ limit: ["10", "20"] }),
    BadRequestException
  );
  assert.throws(
    () => notificationListQuery({ unreadOnly: "yes" }),
    BadRequestException
  );
});
