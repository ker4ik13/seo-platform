import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { crawlNotificationInput } from "./crawl-notification.input.js";

const crawlId = "01900000-0000-7000-8000-000000000004";

test("accepts an exact terminal crawl notification command", () => {
  const input = crawlNotificationInput(validInput());
  assert.equal(input.crawlId, crawlId);
  assert.equal(input.status, "PARTIALLY_COMPLETED");
});

test("rejects mismatched idempotency and non-terminal status", () => {
  assert.throws(
    () =>
      crawlNotificationInput({
        ...validInput(),
        idempotencyKey:
          "crawl-notification:01900000-0000-7000-8000-000000000005"
      }),
    BadRequestException
  );
  assert.throws(
    () => crawlNotificationInput({ ...validInput(), status: "RUNNING" }),
    BadRequestException
  );
});

function validInput() {
  return {
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    actorId: "01900000-0000-7000-8000-000000000003",
    crawlId,
    status: "PARTIALLY_COMPLETED",
    processedUrls: 3,
    issueCount: 2,
    idempotencyKey: `crawl-notification:${crawlId}`
  };
}
