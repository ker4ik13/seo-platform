import assert from "node:assert/strict";
import test from "node:test";
import {
  automationSchedulerId,
  cronPattern,
  scheduledOccurrence,
  upsertRankAutomationScheduler
} from "./rank-automation.queue.js";

test("builds stable scheduler identifiers and timezone-neutral cron", () => {
  assert.equal(
    automationSchedulerId("01900000-0000-7000-8000-000000000001"),
    "rank-automation-01900000-0000-7000-8000-000000000001"
  );
  assert.equal(
    cronPattern({ cadence: "DAILY", hour: 2, minute: 7 }),
    "7 2 * * *"
  );
  assert.equal(
    cronPattern({
      cadence: "WEEKLY",
      hour: 23,
      minute: 59,
      weekdays: [1, 5, 7]
    }),
    "59 23 * * 1,5,0"
  );
});

test("uses the BullMQ scheduler occurrence encoded in the job id", () => {
  const timestamp = Date.parse("2026-07-31T10:00:00.000Z");
  const scheduled = Date.parse("2026-08-01T02:00:00.000Z");
  const occurrence = scheduledOccurrence({
    id: `repeat:scheduler:${scheduled}`,
    timestamp
  } as never);
  assert.equal(occurrence.toISOString(), "2026-08-01T02:00:00.000Z");
});

test("falls back to the accepted job timestamp for a malformed id", () => {
  const timestamp = Date.parse("2026-07-31T10:00:00.000Z");
  const occurrence = scheduledOccurrence({
    id: "repeat:scheduler:not-a-timestamp",
    timestamp
  } as never);
  assert.equal(occurrence.toISOString(), "2026-07-31T10:00:00.000Z");
});

test("uses the delayed occurrence for a one-time automation", () => {
  const timestamp = Date.parse("2026-07-31T10:00:00.000Z");
  const occurrence = scheduledOccurrence({
    id: "rank-automation-once-01900000-0000-7000-8000-000000000001",
    timestamp,
    delay: 16 * 60 * 60 * 1_000
  } as never);
  assert.equal(occurrence.toISOString(), "2026-08-01T02:00:00.000Z");
});

test("enqueues an idempotent delayed job for one-time rank schedules", async () => {
  const added: unknown[] = [];
  const runAt = new Date(Date.now() + 60_000).toISOString();
  const queue = {
    removeJobScheduler: async () => false,
    getJob: async () => undefined,
    add: async (...input: unknown[]) => {
      added.push(input);
      return {};
    }
  };

  const scheduled = await upsertRankAutomationScheduler(queue as never, {
    automationId: "01900000-0000-7000-8000-000000000001",
    automationVersion: 4,
    schedule: { cadence: "ONCE", runAt },
    timezone: "Europe/Moscow"
  });

  assert.equal(scheduled.toISOString(), runAt);
  assert.equal(added.length, 1);
  const options = (added[0] as unknown[])[2] as Readonly<Record<string, unknown>>;
  assert.equal(
    options.jobId,
    "rank-automation-once-01900000-0000-7000-8000-000000000001"
  );
  assert.ok(Number(options.delay) > 0);
  assert.ok(Number(options.delay) <= 60_000);
});
