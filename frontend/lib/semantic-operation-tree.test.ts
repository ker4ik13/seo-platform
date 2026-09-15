import assert from "node:assert/strict";
import test from "node:test";
import {
  expandedAncestorIds,
  resolvedFolderSelectionIds,
  treeIdsWithDescendants,
  visibleFolderRows
} from "./semantic-operation-tree.ts";

interface Group {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
}

const groups: readonly Group[] = [
  group("01900000-0000-7000-8000-000000000001", "Каталог"),
  group(
    "01900000-0000-7000-8000-000000000002",
    "Трубы",
    "01900000-0000-7000-8000-000000000001"
  ),
  group(
    "01900000-0000-7000-8000-000000000003",
    "Бесшовные",
    "01900000-0000-7000-8000-000000000002"
  ),
  group("01900000-0000-7000-8000-000000000004", "Статьи")
];

test("keeps collapsed descendants hidden instead of duplicating them as roots", () => {
  assert.deepEqual(
    visibleFolderRows(groups, new Set()).map(({ group, depth }) => [group.name, depth]),
    [["Каталог", 0], ["Статьи", 0]]
  );
  assert.deepEqual(
    visibleFolderRows(
      groups,
      new Set([
        "01900000-0000-7000-8000-000000000001",
        "01900000-0000-7000-8000-000000000002"
      ])
    ).map(({ group, depth }) => [group.name, depth]),
    [["Каталог", 0], ["Трубы", 1], ["Бесшовные", 2], ["Статьи", 0]]
  );
});

test("resolves selected folders through descendants without duplicate ids", () => {
  const groups = [
    { id: "root" },
    { id: "child", parentId: "root" },
    { id: "leaf", parentId: "child" },
    { id: "other" }
  ];

  assert.deepEqual(
    treeIdsWithDescendants(groups, new Set(["root", "child"])),
    ["child", "leaf", "root"]
  );
  assert.deepEqual(
    [...expandedAncestorIds(groups, ["leaf"])].sort(),
    ["child", "root"]
  );
});

test("keeps folder selection direct until descendants are explicitly enabled", () => {
  const folders = [
    { id: "root" },
    { id: "child", parentId: "root" },
    { id: "leaf", parentId: "child" }
  ];
  const selected = new Set(["root"]);

  assert.deepEqual(resolvedFolderSelectionIds(folders, selected), ["root"]);
  assert.deepEqual(
    resolvedFolderSelectionIds(folders, selected, new Set(["root"])),
    ["child", "leaf", "root"]
  );
  assert.deepEqual(
    resolvedFolderSelectionIds(
      folders,
      new Set(["root", "child"]),
      new Set(["child"])
    ),
    ["child", "leaf", "root"]
  );
});

function group(id: string, name: string, parentId?: string): Group {
  return {
    id,
    name,
    ...(parentId ? { parentId } : {})
  };
}
