import assert from "node:assert/strict";
import test from "node:test";
import type { RankOperationResult } from "@seo-platform/contracts";
import { rankOperationCounts } from "./rank-operation-counts.ts";

test("keeps rank counters independent from a 200-row result page", () => {
  const value = {
    counts: { foundCount: 922, notFoundCount: 2_811 },
    job: {
      progress: { current: "3736", total: "4694", unit: "KEYWORD" }
    }
  } as Pick<RankOperationResult, "counts" | "job">;

  assert.deepEqual(rankOperationCounts(value), {
    found: 922,
    notFound: 2_811,
    failed: 3
  });
});

test("uses the terminal receipt as the final rank counter source", () => {
  const value = {
    counts: { foundCount: 10, notFoundCount: 20 },
    job: {
      progress: { current: "30", total: "33", unit: "KEYWORD" },
      result: {
        foundCount: "11",
        notFoundCount: "19",
        failedCount: "3"
      }
    }
  } as Pick<RankOperationResult, "counts" | "job">;

  assert.deepEqual(rankOperationCounts(value), {
    found: 11,
    notFound: 19,
    failed: 3
  });
});
