import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectPositionHistoryPoint } from "@seo-platform/contracts";
import {
  projectPositionHistoryAvailableRange,
  projectPositionHistoryDateKey,
  projectPositionTopValue,
  visibleProjectPositionHistory,
  visibleProjectPositionHistoryInRange
} from "./project-position-history.ts";

test("filters daily position aggregates and samples the complete interval", () => {
  const points = Array.from({ length: 40 }, (_, index) => point(index));
  const visible = visibleProjectPositionHistory(
    points,
    "30D",
    new Date("2026-09-05T12:00:00.000Z"),
    5
  );

  assert.equal(visible.length, 5);
  assert.equal(visible[0]?.id, "slice-9");
  assert.equal(visible.at(-1)?.id, "slice-39");
});

test("keeps at most the requested 30 calendar days for all time", () => {
  const visible = visibleProjectPositionHistory(
    Array.from({ length: 100 }, (_, index) => point(index)),
    "ALL",
    new Date("2026-09-05T12:00:00.000Z"),
    30
  );

  assert.equal(visible.length, 30);
  assert.equal(visible[0]?.id, "slice-0");
  assert.equal(visible.at(-1)?.id, "slice-99");
  assert.equal(new Set(visible.map(({ id }) => id)).size, 30);
});

test("filters a custom calendar range inclusively and keeps its edges", () => {
  const visible = visibleProjectPositionHistoryInRange(
    Array.from({ length: 20 }, (_, index) => point(index)),
    { from: "2026-08-01", to: "2026-08-10" },
    4
  );

  assert.equal(visible.length, 4);
  assert.equal(visible[0]?.id, "slice-4");
  assert.equal(visible.at(-1)?.id, "slice-13");
});

test("derives the available calendar range regardless of response order", () => {
  assert.deepEqual(
    projectPositionHistoryAvailableRange([point(9), point(2), point(15)]),
    { from: "2026-07-30", to: "2026-08-12" }
  );
  assert.equal(
    projectPositionHistoryDateKey(new Date(2026, 8, 5, 12).toISOString()),
    "2026-09-05"
  );
  assert.equal(
    projectPositionHistoryDateKey("2026-09-05T23:30:00.000Z"),
    "2026-09-05"
  );
});

test("rejects an inverted or impossible custom calendar range", () => {
  assert.throws(
    () => visibleProjectPositionHistoryInRange(
      [point(1)],
      { from: "2026-09-10", to: "2026-09-01" },
      30
    ),
    /date range must be valid/u
  );
  assert.throws(
    () => visibleProjectPositionHistoryInRange(
      [point(1)],
      { from: "2026-02-30", to: "2026-03-01" },
      30
    ),
    /date range must be valid/u
  );
});

test("maps every supported TOP threshold to its exact cumulative count", () => {
  const value = point(1);
  assert.deepEqual(
    ([3, 5, 10, 30, 50] as const).map((threshold) =>
      projectPositionTopValue(value, threshold)
    ),
    [1, 2, 3, 4, 5]
  );
});

function point(index: number): ProjectPositionHistoryPoint {
  return {
    id: `slice-${index}`,
    date: new Date(Date.UTC(2026, 6, 28 + index, 12))
      .toISOString()
      .slice(0, 10),
    observedAt: new Date(Date.UTC(2026, 6, 28 + index, 12)).toISOString(),
    measuredKeywordCount: 10,
    positionedKeywordCount: 5,
    top3KeywordCount: 1,
    top5KeywordCount: 2,
    top10KeywordCount: 3,
    top30KeywordCount: 4,
    top50KeywordCount: 5
  };
}
