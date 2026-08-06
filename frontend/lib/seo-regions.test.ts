import assert from "node:assert/strict";
import test from "node:test";
import { seoRegions } from "./seo-regions.ts";

test("keeps Russia, Moscow and Saint Petersburg first in frequency region choices", () => {
  assert.deepEqual(
    seoRegions.slice(0, 3).map(({ name, wordstatCode }) => ({
      name,
      wordstatCode
    })),
    [
      { name: "Россия", wordstatCode: "225" },
      { name: "Москва", wordstatCode: "213" },
      { name: "Санкт-Петербург", wordstatCode: "2" }
    ]
  );
});
