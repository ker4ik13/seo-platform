import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyRankAutomationDraft,
  rankAutomationInput,
  rankAutomationsApiPath,
  rankAutomationsReturnTo,
  rankAutomationScheduleLabel,
  validateRankAutomationDraft
} from "./rank-automations.ts";

test("builds a normalized weekly automation input", () => {
  const draft = {
    ...emptyRankAutomationDraft("Europe/Moscow"),
    name: "  Ночной съём  ",
    trackingContextId: "01900123-4567-7abc-8def-0123456789ab",
    cadence: "WEEKLY" as const,
    hour: "3",
    minute: "5",
    weekdays: [5, 1],
    maxItems: "250",
    failureThreshold: "4",
    enabled: true
  };

  assert.deepEqual(validateRankAutomationDraft(draft), {});
  assert.deepEqual(rankAutomationInput(draft), {
    name: "Ночной съём",
    trackingContextId: "01900123-4567-7abc-8def-0123456789ab",
    timezone: "Europe/Moscow",
    schedule: {
      cadence: "WEEKLY",
      hour: 3,
      minute: 5,
      weekdays: [1, 5]
    },
    maxItems: 250,
    failureThreshold: 4,
    enabled: true
  });
});

test("rejects invalid automation boundaries", () => {
  const errors = validateRankAutomationDraft({
    ...emptyRankAutomationDraft("Invalid/Zone"),
    cadence: "WEEKLY",
    hour: "24",
    minute: "60",
    weekdays: [],
    maxItems: "0",
    failureThreshold: "11"
  });

  assert.ok(errors.name);
  assert.ok(errors.trackingContextId);
  assert.ok(errors.timezone);
  assert.ok(errors.time);
  assert.ok(errors.weekdays);
  assert.ok(errors.maxItems);
  assert.ok(errors.failureThreshold);
});

test("builds encoded API and application routes", () => {
  assert.equal(
    rankAutomationsApiPath("project/one"),
    "/app/api/projects/project%2Fone/automations"
  );
  assert.equal(
    rankAutomationsReturnTo("project one"),
    "/app/projects/project%20one/rankings/automations"
  );
  assert.equal(
    rankAutomationScheduleLabel(
      { cadence: "WEEKLY", hour: 2, minute: 7, weekdays: [1, 7] },
      "Europe/Moscow"
    ),
    "Пн, Вс в 02:07 · Europe/Moscow"
  );
});
