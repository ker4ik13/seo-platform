import assert from "node:assert/strict";
import test from "node:test";
import {
  initialSemanticCreateGroupId,
  semanticBulkSelectionBatches,
  semanticClipboardText,
  semanticHighlightAfterRowClick,
  toggleSemanticHighlightedSelection
} from "./semantic-row-selection.ts";

const ids = ["one", "two", "three", "four"] as const;

test("plain row click highlights one row without creating bulk selection state", () => {
  const result = semanticHighlightAfterRowClick(ids, "one", "three", false);
  assert.equal(result.anchorId, "three");
  assert.deepEqual([...result.highlightedIds], ["three"]);
});

test("shift row click creates an ordered copy range from the focus anchor", () => {
  const result = semanticHighlightAfterRowClick(ids, "two", "four", true);
  assert.equal(result.anchorId, "two");
  assert.deepEqual([...result.highlightedIds], ["two", "three", "four"]);
});

test("clipboard uses highlighted rows in table order and ignores checked rows", () => {
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
