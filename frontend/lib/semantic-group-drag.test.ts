import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticGroupCanonicalDropTarget,
  semanticGroupDropPlacement
} from "./semantic-group-drag.ts";

test("uses row edges for manual folder ordering and the center for nesting", () => {
  assert.equal(semanticGroupDropPlacement(101, 100, 40), "before");
  assert.equal(semanticGroupDropPlacement(114, 100, 40), "before");
  assert.equal(semanticGroupDropPlacement(120, 100, 40), "inside");
  assert.equal(semanticGroupDropPlacement(126, 100, 40), "after");
  assert.equal(semanticGroupDropPlacement(139, 100, 40), "after");
});

test("fails safe to nesting for invalid row geometry", () => {
  assert.equal(semanticGroupDropPlacement(10, 0, 0), "inside");
});

test("maps both sides of one visual gap to the same lower-row target", () => {
  const parent = { id: "parent" };
  const firstChild = { id: "first-child" };

  assert.deepEqual(
    semanticGroupCanonicalDropTarget(
      139,
      100,
      40,
      { group: parent, depth: 0 },
      { group: firstChild, depth: 1 }
    ),
    { group: firstChild, placement: "before" }
  );
  assert.deepEqual(
    semanticGroupCanonicalDropTarget(141, 140, 40, {
      group: firstChild,
      depth: 1
    }),
    { group: firstChild, placement: "before" }
  );
});

test("maps a same-level gap to one exact sibling position", () => {
  const grinch = { id: "grinch" };
  const nlStudio = { id: "nl-studio" };

  assert.deepEqual(
    semanticGroupCanonicalDropTarget(
      139,
      100,
      40,
      { group: grinch, depth: 0 },
      { group: nlStudio, depth: 0 }
    ),
    { group: nlStudio, placement: "before" }
  );
  assert.deepEqual(
    semanticGroupCanonicalDropTarget(141, 140, 40, {
      group: nlStudio,
      depth: 0
    }),
    { group: nlStudio, placement: "before" }
  );
});

test("keeps both explicit levels when a visible subtree ends", () => {
  const lastNested = { id: "last-nested" };
  const nextRoot = { id: "next-root" };

  assert.deepEqual(
    semanticGroupCanonicalDropTarget(
      139,
      100,
      40,
      { group: lastNested, depth: 1 },
      { group: nextRoot, depth: 0 }
    ),
    { group: lastNested, placement: "after" }
  );
  assert.deepEqual(
    semanticGroupCanonicalDropTarget(141, 140, 40, {
      group: nextRoot,
      depth: 0
    }),
    { group: nextRoot, placement: "before" }
  );
});

test("keeps the final visible row's bottom edge as an after target", () => {
  const last = { id: "last" };
  assert.deepEqual(
    semanticGroupCanonicalDropTarget(139, 100, 40, {
      group: last,
      depth: 0
    }),
    { group: last, placement: "after" }
  );
});

test("keeps row center as an explicit nesting target", () => {
  const group = { id: "group" };
  const next = { id: "next" };
  assert.deepEqual(
    semanticGroupCanonicalDropTarget(
      120,
      100,
      40,
      { group, depth: 0 },
      { group: next, depth: 0 }
    ),
    { group, placement: "inside" }
  );
});
