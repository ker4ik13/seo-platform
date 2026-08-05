import assert from "node:assert/strict";
import test from "node:test";
import {
  internalCreateCrawlAutomationInput,
  internalRunCrawlAutomationInput
} from "./crawl-automation-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const automationId = "01900000-0000-7000-8000-000000000004";

test("parses one exact versioned crawl schedule command", () => {
  const input = internalCreateCrawlAutomationInput(createCommand());

  assert.equal(input.timezone, "Europe/Moscow");
  assert.deepEqual(input.schedule, {
    cadence: "WEEKLY",
    hour: 6,
    minute: 30,
    weekdays: [1, 3, 5]
  });
  assert.deepEqual(input.allowedWindow, {
    startMinute: 360,
    endMinute: 1_380
  });
  assert.equal(input.config.maxRuntimeSeconds, 3_600);
});

test("rejects unknown fields, invalid windows and unsafe crawl scope", () => {
  assert.throws(
    () =>
      internalCreateCrawlAutomationInput({
        ...createCommand(),
        extra: true
      }),
    /Invalid crawl automation field: body/u
  );
  assert.throws(
    () =>
      internalCreateCrawlAutomationInput({
        ...createCommand(),
        allowedWindow: { startMinute: 600, endMinute: 600 }
      }),
    /allowedWindow/u
  );
  assert.throws(
    () =>
      internalCreateCrawlAutomationInput({
        ...createCommand(),
        config: {
          ...createCommand().config,
          startUrls: [
            "https://example.com/",
            "https://other.example/"
          ]
        }
      }),
    /technical crawl field/u
  );
});

test("parses a bounded manual run identity", () => {
  assert.deepEqual(
    internalRunCrawlAutomationInput({
      workspaceId,
      projectId,
      actorId,
      automationId,
      expectedVersion: 3,
      idempotencyKey: "crawl-automation-manual-001"
    }),
    {
      workspaceId,
      projectId,
      actorId,
      automationId,
      expectedVersion: 3,
      idempotencyKey: "crawl-automation-manual-001"
    }
  );
});

function createCommand() {
  return {
    name: "Ночной аудит",
    timezone: "Europe/Moscow",
    schedule: {
      cadence: "WEEKLY",
      hour: 6,
      minute: 30,
      weekdays: [1, 3, 5]
    },
    allowedWindow: { startMinute: 360, endMinute: 1_380 },
    config: {
      startUrls: ["https://example.com/"],
      sitemapUrls: [],
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 100,
      maxDepth: 3,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 30,
      obeyRobots: true
    },
    failureThreshold: 3,
    enabled: true,
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "crawl-automation-create-001",
    entitlement: {
      planCode: "TRIAL",
      planVersion: 1,
      scheduledAutomations: 5
    }
  };
}
