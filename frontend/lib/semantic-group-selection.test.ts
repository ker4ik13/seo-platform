import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticAllRegularGroupIds,
  semanticGroupRangeSelection,
  semanticVisiblePresenceGroupId
} from "./semantic-group-selection.ts";

test("selects only rows visible between the group range endpoints", () => {
  assert.deepEqual(
    [...(semanticGroupRangeSelection(
      ["parent", "visible-child", "next-parent"],
      "parent",
      "next-parent"
    ) ?? [])],
    ["parent", "visible-child", "next-parent"]
  );
  assert.equal(
    semanticGroupRangeSelection(
      ["parent", "next-parent"],
      "collapsed-child",
      "next-parent"
    ),
    undefined
  );
});

test("select all includes collapsed descendants but excludes system groups", () => {
  assert.deepEqual(
    semanticAllRegularGroupIds([
      { id: "parent" },
      { id: "collapsed-child" },
      { id: "trash", systemKind: "TRASH" }
    ]),
    ["parent", "collapsed-child"]
  );
});

test("presence highlights only the selected child when it is visible", () => {
  const groups = [
    { id: "root" },
    { id: "child", parentId: "root" },
    { id: "grandchild", parentId: "child" }
  ];
  assert.equal(
    semanticVisiblePresenceGroupId(
      ["grandchild"],
      groups,
      ["root", "child", "grandchild"]
    ),
    "grandchild"
  );
});

test("presence rolls up to the nearest visible collapsed ancestor", () => {
  const groups = [
    { id: "root" },
    { id: "child", parentId: "root" },
    { id: "grandchild", parentId: "child" }
  ];
  assert.equal(
    semanticVisiblePresenceGroupId(
      ["grandchild"],
      groups,
      ["root", "child"]
    ),
    "child"
  );
});
