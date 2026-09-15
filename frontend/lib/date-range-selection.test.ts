import assert from "node:assert/strict";
import test from "node:test";
import {
  dateRangePreset,
  selectDateRangeDay
} from "./date-range-selection.ts";

test("first date click selects one day and second click completes a range", () => {
  const first = selectDateRangeDay({
    from: "2026-09-01",
    to: "2026-09-10",
    selectingEnd: false
  }, "2026-09-08");
  assert.deepEqual(first, {
    from: "2026-09-08",
    to: "2026-09-08",
    selectingEnd: true
  });
  assert.deepEqual(selectDateRangeDay(first, "2026-09-03"), {
    from: "2026-09-03",
    to: "2026-09-08",
    selectingEnd: false
  });
});

test("quick ranges end on the latest available day and clamp to history", () => {
  assert.deepEqual(
    dateRangePreset({ from: "2026-09-01", to: "2026-09-14" }, 7),
    { from: "2026-09-08", to: "2026-09-14" }
  );
  assert.deepEqual(
    dateRangePreset({ from: "2026-09-10", to: "2026-09-14" }, 90),
    { from: "2026-09-10", to: "2026-09-14" }
  );
});
