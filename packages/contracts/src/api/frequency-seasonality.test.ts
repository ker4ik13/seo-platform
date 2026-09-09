import assert from "node:assert/strict";
import test from "node:test";
import { parseFrequencySeasonalityRequest } from "./frequency-collections.js";

test("accepts full calendar months, weeks and bounded daily seasonality", () => {
  assert.equal(parseFrequencySeasonalityRequest({ granularity: "MONTH", observedFrom: "2026-01-01", observedThrough: "2026-03-31" }).granularity, "MONTH");
  assert.equal(parseFrequencySeasonalityRequest({ granularity: "WEEK", observedFrom: "2026-08-03", observedThrough: "2026-08-23" }).granularity, "WEEK");
  assert.equal(parseFrequencySeasonalityRequest({ granularity: "DAY", observedFrom: "2026-08-01", observedThrough: "2026-08-30" }).granularity, "DAY");
  assert.equal(parseFrequencySeasonalityRequest({ granularity: "MONTH", observedFrom: "2018-01-01", observedThrough: "2026-08-31" }).observedFrom, "2018-01-01");
});

test("rejects partial calendar periods and more than sixty daily points", () => {
  assert.throws(() => parseFrequencySeasonalityRequest({ granularity: "MONTH", observedFrom: "2026-01-02", observedThrough: "2026-03-31" }));
  assert.throws(() => parseFrequencySeasonalityRequest({ granularity: "WEEK", observedFrom: "2026-08-04", observedThrough: "2026-08-23" }));
  assert.throws(() => parseFrequencySeasonalityRequest({ granularity: "DAY", observedFrom: "2026-01-01", observedThrough: "2026-03-31" }));
});
