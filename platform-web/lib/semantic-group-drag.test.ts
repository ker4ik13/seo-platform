import assert from "node:assert/strict";
import test from "node:test";
import { semanticGroupDropPlacement } from "./semantic-group-drag.ts";

test("uses row edges for manual folder ordering and the center for nesting", () => {
  assert.equal(semanticGroupDropPlacement(101, 100, 40), "before");
  assert.equal(semanticGroupDropPlacement(120, 100, 40), "inside");
  assert.equal(semanticGroupDropPlacement(139, 100, 40), "after");
});

test("fails safe to nesting for invalid row geometry", () => {
  assert.equal(semanticGroupDropPlacement(10, 0, 0), "inside");
});
