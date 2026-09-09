import assert from "node:assert/strict";
import test from "node:test";
import { rankWorkbenchReportDates } from "./rank-workbench.service.js";

test("returns only observed days for a short ranking range", () => {
  assert.deepEqual(
    rankWorkbenchReportDates(
      31,
      [
        new Date("2026-09-01T12:00:00.000Z"),
        new Date("2026-09-04T12:00:00.000Z")
      ]
    ),
    ["2026-09-04", "2026-09-01"]
  );
});

test("returns no columns when the selected range has no position snapshots", () => {
  assert.deepEqual(
    rankWorkbenchReportDates(
      31,
      []
    ),
    []
  );
});

test("samples observed days across a long ranking range", () => {
  const observed = Array.from({ length: 53 }, (_, index) =>
    new Date(Date.UTC(2025, 8, 1 + index * 7))
  );
  const dates = rankWorkbenchReportDates(
    31,
    observed
  );

  assert.equal(dates.length, 31);
  assert.equal(dates[0], "2026-08-31");
  assert.equal(dates.at(-1), "2025-09-01");
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.equal(new Set(dates).size, dates.length);
});

test("uses observed days directly when a long range has no more than the limit", () => {
  const dates = rankWorkbenchReportDates(
    31,
    [new Date("2025-10-10T12:00:00.000Z"), new Date("2026-08-08T12:00:00.000Z")]
  );

  assert.deepEqual(dates, ["2026-08-08", "2025-10-10"]);
});
