import assert from "node:assert/strict";
import test from "node:test";
import type { OutboxEvent } from "../generated/prisma/client.js";
import { crawlNotificationPayload } from "./crawl-notification-dispatcher.service.js";

const crawlId = "01900000-0000-7000-8000-000000000004";

test("validates tenant-bound terminal crawl notification outbox payloads", () => {
  const event = outboxEvent();
  assert.equal(crawlNotificationPayload(event).crawlId, crawlId);
  assert.equal(
    crawlNotificationPayload(event).purpose,
    "TECHNICAL_AUDIT"
  );
  assert.equal(
    crawlNotificationPayload({
      ...event,
      payload: {
        ...event.payload as object,
        purpose: "HTTP_STATUS_CHECK"
      }
    }).purpose,
    "HTTP_STATUS_CHECK"
  );
  assert.throws(() =>
    crawlNotificationPayload({
      ...event,
      payload: { ...event.payload as object, projectId: "wrong" }
    })
  );
});

function outboxEvent(): OutboxEvent {
  const workspaceId = "01900000-0000-7000-8000-000000000001";
  const projectId = "01900000-0000-7000-8000-000000000002";
  return {
    id: "01900000-0000-7000-8000-000000000006",
    eventType: "technical-crawl.notification.requested.v1",
    aggregateId: crawlId,
    workspaceId,
    projectId,
    payload: {
      workspaceId,
      projectId,
      actorId: "01900000-0000-7000-8000-000000000003",
      crawlId,
      status: "COMPLETED",
      processedUrls: 1,
      issueCount: 0,
      idempotencyKey: `crawl-notification:${crawlId}`
    },
    metadata: { schemaVersion: 1 },
    status: "PENDING",
    attempts: 0,
    availableAt: new Date(),
    publishedAt: null,
    createdAt: new Date()
  };
}

test("delivers the final notification for a full 5,000-page crawl", () => {
  const event = outboxEvent();
  for (const processedUrls of [1_001, 5_000]) {
    assert.equal(crawlNotificationPayload({
      ...event,
      payload: { ...event.payload as object, processedUrls, issueCount: 525000 }
    }).processedUrls, processedUrls);
  }
  for (const processedUrls of [-1, 5_001, 1.5]) {
    assert.throws(() => crawlNotificationPayload({
      ...event,
      payload: { ...event.payload as object, processedUrls }
    }));
  }
});
