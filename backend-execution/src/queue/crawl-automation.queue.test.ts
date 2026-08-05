import assert from "node:assert/strict";
import test from "node:test";
import {
  crawlAutomationSchedulerId,
  crawlScheduledOccurrence
} from "./crawl-automation.queue.js";

test("builds a stable isolated crawl scheduler identifier", () => {
  assert.equal(
    crawlAutomationSchedulerId(
      "01900000-0000-7000-8000-000000000001"
    ),
    "crawl-automation-01900000-0000-7000-8000-000000000001"
  );
});

test("uses the exact crawl scheduler occurrence from BullMQ", () => {
  const timestamp = Date.parse("2026-07-31T10:00:00.000Z");
  const scheduled = Date.parse("2026-08-01T02:00:00.000Z");
  const occurrence = crawlScheduledOccurrence({
    id: `repeat:scheduler:${scheduled}`,
    timestamp
  } as never);
  assert.equal(occurrence.toISOString(), "2026-08-01T02:00:00.000Z");
});
