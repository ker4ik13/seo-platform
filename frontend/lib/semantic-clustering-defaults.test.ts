import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSemanticClusteringFrequencyTypes,
  defaultSemanticClusteringMethod,
  semanticClusteringMethodOptions
} from "./semantic-clustering-defaults.ts";

test("starts clustering with hard grouping on the left and frequencies off", () => {
  assert.equal(defaultSemanticClusteringMethod, "HARD");
  assert.equal(semanticClusteringMethodOptions[0]?.value, "HARD");
  assert.deepEqual(defaultSemanticClusteringFrequencyTypes, []);
});
