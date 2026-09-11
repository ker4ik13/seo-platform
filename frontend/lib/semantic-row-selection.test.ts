import assert from "node:assert/strict";
import test from "node:test";
import {
  initialSemanticCreateGroupId,
  semanticBulkSelectionBatches,
  semanticClipboardText,
  semanticHighlightAllRows,
  semanticHighlightAfterRowClick,
  semanticSelectionAfterDeletion,
  semanticSelectionScopeSignature,
  toggleSemanticHighlightedSelection
} from "./semantic-row-selection.ts";

const ids = ["one", "two", "three", "four"] as const;

test("plain row click highlights one row without creating bulk selection state", () => {
  const result = semanticHighlightAfterRowClick(
    ids,
    "one",
    "three",
    new Set(["one"]),
    { additive: false, extendRange: false }
  );
  assert.equal(result.anchorId, "three");
  assert.deepEqual([...result.highlightedIds], ["three"]);
});

test("shift row click creates an ordered copy range from the focus anchor", () => {
  const result = semanticHighlightAfterRowClick(
    ids,
    "two",
    "four",
    new Set(["two"]),
    { additive: false, extendRange: true }
  );
  assert.equal(result.anchorId, "two");
  assert.deepEqual([...result.highlightedIds], ["two", "three", "four"]);
});

test("ctrl or command row click toggles non-contiguous highlights", () => {
  const added = semanticHighlightAfterRowClick(
    ids,
    "one",
    "three",
    new Set(["one"]),
    { additive: true, extendRange: false }
  );
  assert.equal(added.anchorId, "three");
  assert.deepEqual([...added.highlightedIds], ["one", "three"]);

  const removed = semanticHighlightAfterRowClick(
    ids,
    added.anchorId,
    "one",
    added.highlightedIds,
    { additive: true, extendRange: false }
  );
  assert.equal(removed.anchorId, "one");
  assert.deepEqual([...removed.highlightedIds], ["three"]);
});

test("ctrl or command plus shift adds a range to existing highlights", () => {
  const result = semanticHighlightAfterRowClick(
    ids,
    "two",
    "four",
    new Set(["one"]),
    { additive: true, extendRange: true }
  );
  assert.equal(result.anchorId, "two");
  assert.deepEqual([...result.highlightedIds], ["one", "two", "three", "four"]);
});

test("select all creates only the ordered visual highlight scope", () => {
  const result = semanticHighlightAllRows(ids, "three");
  assert.equal(result.anchorId, "three");
  assert.deepEqual([...result.highlightedIds], ids);

  const empty = semanticHighlightAllRows([], "missing");
  assert.equal(empty.anchorId, undefined);
  assert.deepEqual([...empty.highlightedIds], []);
});

test("clipboard uses the supplied row set in table order", () => {
  const rows = ids.map((id) => ({ id, textOriginal: `query ${id}` }));
  assert.equal(
    semanticClipboardText(rows, new Set(["four", "two"])),
    "query two\nquery four"
  );
  assert.equal(semanticClipboardText(rows, new Set()), "");
});

test("header control promotes highlighted rows to bulk selection and toggles them off", () => {
  const highlighted = new Set(["two", "three"]);
  const selected = toggleSemanticHighlightedSelection(
    new Set(["one"]),
    highlighted
  );
  assert.deepEqual([...selected], ["one", "two", "three"]);
  assert.deepEqual(
    [...toggleSemanticHighlightedSelection(selected, highlighted)],
    ["one"]
  );
});

test("deleting highlighted rows preserves the independent checkbox selection", () => {
  const result = semanticSelectionAfterDeletion(
    new Set(["one", "two"]),
    new Set(["three"]),
    "three",
    new Set(["three"])
  );

  assert.deepEqual([...result.selectedIds], ["one", "two"]);
  assert.deepEqual([...result.highlightedIds], []);
  assert.equal(result.anchorId, undefined);
});

test("deleting checked rows preserves other highlighted rows", () => {
  const result = semanticSelectionAfterDeletion(
    new Set(["one"]),
    new Set(["two", "three", "four"]),
    "three",
    new Set(["one"])
  );

  assert.deepEqual([...result.selectedIds], []);
  assert.deepEqual([...result.highlightedIds], ["two", "three", "four"]);
  assert.equal(result.anchorId, "three");
});

test("partial deletion removes only successfully deleted keyword ids", () => {
  const result = semanticSelectionAfterDeletion(
    new Set(["one", "two", "three"]),
    new Set(["two", "three", "four"]),
    "two",
    new Set(["two"])
  );

  assert.deepEqual([...result.selectedIds], ["one", "three"]);
  assert.deepEqual([...result.highlightedIds], ["three", "four"]);
  assert.equal(result.anchorId, "three");
});

test("new keyword inherits the open active folder but never trash", () => {
  const groups = [
    { id: "regular" },
    { id: "ungrouped", systemKind: "UNGROUPED" as const },
    { id: "trash", systemKind: "TRASH" as const }
  ];
  assert.equal(initialSemanticCreateGroupId(undefined, groups), "ungrouped");
  assert.equal(initialSemanticCreateGroupId("regular", groups), "regular");
  assert.equal(initialSemanticCreateGroupId("ungrouped", groups), "ungrouped");
  assert.equal(initialSemanticCreateGroupId("trash", groups), "ungrouped");
  assert.equal(initialSemanticCreateGroupId("missing", groups), "ungrouped");
});

test("bulk editor keeps all 457 selected rows while respecting the 200-row API batch", () => {
  const selections = Array.from({ length: 457 }, (_, index) => index);
  assert.deepEqual(
    semanticBulkSelectionBatches(selections, 200).map((batch) => batch.length),
    [200, 200, 57]
  );
});

test("background reload and sorting do not change the keyword selection scope", () => {
  const scope = {
    projectId: "project-1",
    filters: { groupId: "group-1", isFavorite: true },
    groupIds: ["group-3", "group-2"]
  } as const;

  assert.equal(
    semanticSelectionScopeSignature(scope),
    semanticSelectionScopeSignature({
      ...scope,
      groupIds: ["group-2", "group-3", "group-2"]
    })
  );
});

test("a genuinely different keyword scope gets a different selection signature", () => {
  const current = semanticSelectionScopeSignature({
    projectId: "project-1",
    filters: { groupId: "group-1" }
  });

  assert.notEqual(
    current,
    semanticSelectionScopeSignature({
      projectId: "project-1",
      filters: { groupId: "group-2" }
    })
  );
  assert.notEqual(
    current,
    semanticSelectionScopeSignature({
      projectId: "project-2",
      filters: { groupId: "group-1" }
    })
  );
});
