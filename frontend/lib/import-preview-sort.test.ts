import assert from "node:assert/strict";
import test from "node:test";
import { sortImportPreviewRows } from "./import-preview-sort.ts";

test("sorts import preview columns as numbers, dates and text with empty cells last", () => {
  const rows = [
    ["Груша", "10", "2026-09-03"],
    ["яблоко", "2", "2026-09-01"],
    ["", "", ""],
    ["Абрикос", "30", "2026-09-02"]
  ] as const;

  assert.deepEqual(
    sortImportPreviewRows(rows, { columnIndex: 0, direction: "ASC" })
      .map((row) => row[0]),
    ["Абрикос", "Груша", "яблоко", ""]
  );
  assert.deepEqual(
    sortImportPreviewRows(rows, { columnIndex: 1, direction: "DESC" })
      .map((row) => row[1]),
    ["30", "10", "2", ""]
  );
  assert.deepEqual(
    sortImportPreviewRows(rows, { columnIndex: 2, direction: "ASC" })
      .map((row) => row[2]),
    ["2026-09-01", "2026-09-02", "2026-09-03", ""]
  );
});
