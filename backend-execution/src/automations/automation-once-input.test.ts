import assert from "node:assert/strict";
import test from "node:test";
import { automationSchedule, rankAutomationSchedule } from "./automation-input.js";

test("accepts an exact one-time rank schedule without widening crawl schedules", () => {
  assert.deepEqual(
    rankAutomationSchedule({
      cadence: "ONCE",
      runAt: "2030-09-05T08:30:00Z"
    }),
    { cadence: "ONCE", runAt: "2030-09-05T08:30:00.000Z" }
  );
  assert.throws(() =>
    automationSchedule({
      cadence: "ONCE",
      runAt: "2030-09-05T08:30:00.000Z"
    })
  );
});

test("rejects malformed or over-specified one-time schedules", () => {
  assert.throws(() =>
    rankAutomationSchedule({ cadence: "ONCE", runAt: "tomorrow" })
  );
  assert.throws(() =>
    rankAutomationSchedule({
      cadence: "ONCE",
      runAt: "2030-09-05T08:30:00.000Z",
      timezone: "UTC"
    })
  );
});
