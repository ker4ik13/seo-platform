import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticAllRegularGroupIds,
  semanticGroupIdsWithDescendants,
  semanticGroupRangeSelection,
  semanticKeywordSearchPlaceholder,
  semanticVisiblePresenceGroupId
} from "./semantic-group-selection.ts";

test("adds every nested regular group for one or several selected roots", () => {
  assert.deepEqual(
    semanticGroupIdsWithDescendants(
      [
        { id: "first" },
        { id: "first-child", parentId: "first" },
        { id: "first-grandchild", parentId: "first-child" },
        { id: "second" },
        { id: "second-child", parentId: "second" },
        { id: "trash", parentId: "first", systemKind: "TRASH" }
      ],
      ["first", "second"]
    ),
    ["first", "first-child", "first-grandchild", "second", "second-child"]
  );
});

test("descendant selection stays bounded when stored parent links contain a cycle", () => {
  assert.deepEqual(
    semanticGroupIdsWithDescendants(
      [
        { id: "one", parentId: "two" },
        { id: "two", parentId: "one" }
      ],
      ["one"]
    ),
    ["one", "two"]
  );
});

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

test("describes every keyword search scope in the placeholder", () => {
  assert.equal(
    semanticKeywordSearchPlaceholder({
      activeGroup: { name: "Города" },
      activeGroupId: "cities",
      multiGroupIds: []
    }),
    "Поиск по: Города"
  );
  assert.equal(
    semanticKeywordSearchPlaceholder({
      activeGroup: { name: "Системное имя", systemKind: "UNGROUPED" },
      activeGroupId: "ungrouped",
      multiGroupIds: []
    }),
    "Поиск по: Без группы"
  );
  assert.equal(
    semanticKeywordSearchPlaceholder({
      activeGroup: { name: "Системное имя", systemKind: "TRASH" },
      activeGroupId: "trash",
      multiGroupIds: []
    }),
    "Поиск по: Корзина"
  );
  assert.equal(
    semanticKeywordSearchPlaceholder({ multiGroupIds: [] }),
    "Поиск по: Весь проект"
  );
  assert.equal(
    semanticKeywordSearchPlaceholder({
      activeGroup: { name: "Не должна попасть в подпись" },
      activeGroupId: "first",
      multiGroupIds: ["first", "second", "second", "third"]
    }),
    "Поиск по: 3 группы"
  );
  assert.equal(
    semanticKeywordSearchPlaceholder({
      multiGroupIds: ["1", "2", "3", "4", "5"]
    }),
    "Поиск по: 5 групп"
  );
  assert.equal(
    semanticKeywordSearchPlaceholder({
      activeGroupId: "still-loading",
      multiGroupIds: []
    }),
    "Поиск по: Выбранная группа"
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
