import assert from "node:assert/strict";
import test from "node:test";
import { moveSemanticColumn } from "./semantic-column-order.ts";

test("moves exactly one column before or after the visible drop target", () => {
  const order = ["query", "frequency", "tags", "source"] as const;
  assert.deepEqual(
    moveSemanticColumn(order, "frequency", "source", "before"),
    ["query", "tags", "frequency", "source"]
  );
  assert.deepEqual(
    moveSemanticColumn(order, "frequency", "source", "after"),
    ["query", "tags", "source", "frequency"]
  );
  assert.deepEqual(
    moveSemanticColumn(order, "source", "frequency", "before"),
    ["query", "source", "frequency", "tags"]
  );
});

test("keeps the original order for an invalid or identical target", () => {
  const order = ["query", "frequency", "tags"] as const;
  assert.equal(
    moveSemanticColumn(order, "tags", "tags", "after"),
    order
  );
  assert.deepEqual(
    moveSemanticColumn(order, "tags", "missing" as "tags", "before"),
    order
  );
});
