import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEmptyCrawlAutomationInput,
  createCrawlAutomationInput
} from "./crawl-automation.input.js";

test("normalizes a complete public crawl automation command", () => {
  const input = createCrawlAutomationInput({
    name: " Еженедельный аудит ",
    timezone: "Europe/Moscow",
    schedule: {
      cadence: "WEEKLY",
      hour: 7,
      minute: 15,
      weekdays: [1, 5]
    },
    allowedWindow: { startMinute: 360, endMinute: 1_440 },
    config: {
      startUrls: ["https://EXAMPLE.com"],
      sitemapUrls: [],
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 250,
      maxDepth: 4,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 20,
      obeyRobots: true
    },
    failureThreshold: 3,
    enabled: true
  });

  assert.equal(input.name, "Еженедельный аудит");
  assert.equal(input.config.startUrls[0], "https://example.com/");
  assert.deepEqual(input.allowedWindow, {
    startMinute: 360,
    endMinute: 1_440
  });
});

test("rejects extensible commands and non-empty action bodies", () => {
  assert.throws(
    () =>
      createCrawlAutomationInput({
        name: "audit",
        timezone: "UTC",
        schedule: { cadence: "DAILY", hour: 1, minute: 0 },
        allowedWindow: { startMinute: 0, endMinute: 1_440 },
        config: {},
        failureThreshold: 3,
        enabled: false,
        extra: true
      }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "VALIDATION_FAILED"
  );
  assert.doesNotThrow(() => assertEmptyCrawlAutomationInput({}));
  assert.throws(
    () => assertEmptyCrawlAutomationInput({ force: true }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "VALIDATION_FAILED"
  );
});
