import assert from "node:assert/strict";
import test from "node:test";
import { parseDelimitedRows, serializeDelimitedRows, noteDelimiter } from "./project-note-files.ts";
import { sheetClear, sheetCopy, sheetDelete, sheetHeaderSelection, sheetInsert, sheetPaste, singleSheetCell } from "./spreadsheet-grid.ts";

test("Excel clipboard grows both axes at the selected cell and preserves cells outside its destination", () => {
  const rows = [["keep", "001"], ["keep too", ""]];
  const result = sheetPaste(rows, singleSheetCell({ row: 1, column: 1 }), '0007\t"two\nlines"\t"a,b"\nsecond\tthird\tfourth\r\n');
  assert.deepEqual(result.rows, [["keep", "001", "", ""], ["keep too", "0007", "two\nlines", "a,b"], ["", "second", "third", "fourth"]]);
  assert.deepEqual(parseDelimitedRows(serializeDelimitedRows(result.rows)), result.rows);
  assert.deepEqual(sheetPaste([[""]], singleSheetCell({ row: 0, column: 0 }), sheetCopy([["\"quote"]], singleSheetCell({ row: 0, column: 0 }))).rows, [['"quote']]);
});

test("row/column selections support shift, nonadjacent control selection, copy and safe bulk changes", () => {
  const rows = [["A", "B", "C"], ["1", "2", "3"], ["4", "5", "6"]];
  const first = sheetHeaderSelection(singleSheetCell({ row: 0, column: 0 }), "columns", 0, false, false);
  const selected = sheetHeaderSelection(first, "columns", 2, false, true);
  assert.equal(sheetCopy(rows, selected), "A\tC\n1\t3\n4\t6");
  assert.deepEqual(sheetPaste(rows, selected, "x\ty\tz\n7\t8\t9").rows, [["x", "B", "y", "z"], ["7", "2", "8", "9"], ["4", "5", "6", ""]]);
  assert.deepEqual(sheetClear(rows, selected), [["", "B", ""], ["", "2", ""], ["", "5", ""]]);
  const range = sheetHeaderSelection(sheetHeaderSelection(first, "rows", 1, false, false), "rows", 2, true, false);
  assert.deepEqual(sheetDelete(rows, "rows", [1, 2]), [["A", "B", "C"]]);
  assert.deepEqual(sheetPaste(rows, range, "same").rows, [["A", "B", "C"], ["same", "same", "same"], ["same", "same", "same"]]);
  assert.deepEqual(sheetInsert(rows, "columns", 1, 2)[1], ["1", "", "", "2", "3"]);
  assert.deepEqual(sheetDelete(rows, "columns", [0, 1, 2]), [[""], [""], [""]]);
});

test("single-column CSV cells containing semicolons cannot silently become extra columns", () => {
  const text = serializeDelimitedRows([["a;b"]]);
  assert.deepEqual(parseDelimitedRows(text, noteDelimiter(text, "CSV")), [["a;b"]]);
});
