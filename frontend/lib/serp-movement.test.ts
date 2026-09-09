import assert from "node:assert/strict";
import test from "node:test";
import { serpMovementKey, serpMovements } from "./serp-movement.ts";

test("compares each current site with its best position in the previous SERP", () => {
  const movements = serpMovements([
    {
      snapshotId: "newest",
      results: [
        { position: 2, url: "https://example.test/new-page" },
        { position: 8, url: "https://new.test/" }
      ]
    },
    {
      snapshotId: "older",
      results: [
        { position: 7, url: "https://www.example.test/old-page" },
        { position: 12, url: "https://example.test/another-page" }
      ]
    }
  ]);

  assert.deepEqual(
    movements.get(serpMovementKey("newest", "https://example.test/new-page")),
    { previousPosition: 7, urlChanged: true }
  );
  assert.deepEqual(
    movements.get(serpMovementKey("newest", "https://new.test/")),
    {}
  );
  assert.equal(
    movements.get(serpMovementKey("older", "https://example.test/old-page")),
    undefined
  );
});

test("keeps an unchanged page URL separate from a changed URL on the same domain", () => {
  const movements = serpMovements([
    {
      snapshotId: "newest",
      results: [
        { position: 1, url: "https://example.test/stable" },
        { position: 3, url: "https://example.test/new" }
      ]
    },
    {
      snapshotId: "older",
      results: [{ position: 2, url: "https://www.example.test/stable" }]
    }
  ]);

  assert.deepEqual(
    movements.get(serpMovementKey("newest", "https://example.test/stable")),
    { previousPosition: 2 }
  );
  assert.deepEqual(
    movements.get(serpMovementKey("newest", "https://example.test/new")),
    { previousPosition: 2, urlChanged: true }
  );
});
