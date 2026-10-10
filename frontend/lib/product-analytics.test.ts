import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsSection,
  hasAnalyticsResult,
  isAnalyticsEngaged,
  analyticsLatencyBin,
  isAnalyticsCommand,
} from "./product-analytics.ts";
test("background/idle tabs do not add human activity and result views require persisted data", () => {
  assert.equal(isAnalyticsEngaged(true, true, 1000, 120000), true);
  assert.equal(isAnalyticsEngaged(true, true, 1000, 121000), false);
  assert.equal(isAnalyticsEngaged(false, true, 1000, 2000), false);
  assert.equal(isAnalyticsEngaged(true, false, 1000, 2000), false);
  assert.equal(
    hasAnalyticsResult("/app/api/projects/id/keywords/id/insights", {
      data: { positions: [], positionHistory: [], frequencies: [] },
    }),
    false,
  );
  assert.equal(
    hasAnalyticsResult("/app/api/projects/id/keywords/id/insights", {
      data: { positionHistory: [{ found: false }] },
    }),
    true,
  );
  assert.equal(
    hasAnalyticsResult("/app/api/projects/id/rank-history", { data: [] }),
    false,
  );
  assert.equal(
    hasAnalyticsResult("/app/api/projects/id/rank-history", {
      data: [{ found: false }],
    }),
    true,
  );
});
test("feature classification is bounded and never exports URLs or phrase text", () => {
  assert.equal(
    isAnalyticsCommand("/app/api/me/preferences", "PATCH", false),
    false,
  );
  assert.equal(
    isAnalyticsCommand("/app/api/projects/id/keywords/list", "POST", true),
    false,
  );
  assert.equal(
    isAnalyticsCommand("/app/api/projects/id/keywords/bulk", "POST", false),
    true,
  );
  assert.equal(
    analyticsSection("/app/api/projects/id/frequency-collections"),
    "WORDSTAT",
  );
  assert.equal(
    analyticsSection("/app/api/projects/id/ai-answer-collections"),
    "AI",
  );
  assert.equal(analyticsSection("/app/settings/billing"), "BILLING");
  assert.equal(analyticsLatencyBin(250), 2);
  assert.equal(analyticsLatencyBin(60001), 10);
});
