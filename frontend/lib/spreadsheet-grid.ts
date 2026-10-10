import { parseDelimitedRows, serializeDelimitedRows } from "./project-note-files.ts";

export type SheetRows = readonly (readonly string[])[];
export interface SheetCell { readonly row: number; readonly column: number; }
export type SheetSelection =
  | { readonly kind: "cells"; readonly anchor: SheetCell; readonly focus: SheetCell }
  | { readonly kind: "rows" | "columns"; readonly anchor: number; readonly indices: readonly number[] };
export const singleSheetCell = (cell: SheetCell): SheetSelection => ({ kind: "cells", anchor: cell, focus: cell });
export const sheetSequence = (start: number, end: number): number[] => Array.from({ length: Math.abs(end - start) + 1 }, (_, index) => Math.min(start, end) + index);
export function sheetDimensions(rows: SheetRows) { return { rows: Math.max(1, rows.length), columns: rows.reduce((max, row) => Math.max(max, row.length), 1) }; }
export function sheetRectangle(rows: SheetRows, rowCount = rows.length, columnCount = sheetDimensions(rows).columns): string[][] {
  return Array.from({ length: Math.max(1, rowCount) }, (_, row) => Array.from({ length: Math.max(1, columnCount) }, (_, column) => rows[row]?.[column] ?? ""));
}
export function boundSheetCell(cell: SheetCell, size: ReturnType<typeof sheetDimensions>): SheetCell {
  return { row: Math.max(0, Math.min(size.rows - 1, cell.row)), column: Math.max(0, Math.min(size.columns - 1, cell.column)) };
}
export function boundSheetSelection(selection: SheetSelection, size: ReturnType<typeof sheetDimensions>): SheetSelection {
  if (selection.kind === "cells") return { kind: "cells", anchor: boundSheetCell(selection.anchor, size), focus: boundSheetCell(selection.focus, size) };
  const limit = selection.kind === "rows" ? size.rows : size.columns;
  const indices = [...new Set(selection.indices.filter(index => index >= 0 && index < limit))].sort((a, b) => a - b);
  return { ...selection, anchor: Math.min(selection.anchor, limit - 1), indices: indices.length ? indices : [Math.min(selection.anchor, limit - 1)] };
}
export function sheetSelectionAxes(selection: SheetSelection, size: ReturnType<typeof sheetDimensions>) {
  const bounded = boundSheetSelection(selection, size);
  if (bounded.kind === "cells") return { rows: sheetSequence(bounded.anchor.row, bounded.focus.row), columns: sheetSequence(bounded.anchor.column, bounded.focus.column) };
  return { rows: bounded.kind === "rows" ? bounded.indices : sheetSequence(0, size.rows - 1), columns: bounded.kind === "columns" ? bounded.indices : sheetSequence(0, size.columns - 1) };
}
export function sheetHeaderSelection(current: SheetSelection, kind: "rows" | "columns", index: number, shift: boolean, additive: boolean): SheetSelection {
  const anchor = current.kind === kind ? current.anchor : index;
  const range = shift ? sheetSequence(anchor, index) : [index];
  const previous = current.kind === kind ? current.indices : [];
  const indices = additive ? shift ? [...previous, ...range] : previous.includes(index) ? previous.filter(value => value !== index) : [...previous, index] : range;
  return { kind, anchor: shift ? anchor : index, indices: [...new Set(indices.length ? indices : [index])].sort((a, b) => a - b) };
}
export function sheetCopy(rows: SheetRows, selection: SheetSelection): string {
  const axes = sheetSelectionAxes(selection, sheetDimensions(rows));
  const single = rows[axes.rows[0]!]?.[axes.columns[0]!] ?? "";
  if (axes.rows.length === 1 && axes.columns.length === 1 && !/[\t\r\n]/u.test(single)) return single;
  return serializeDelimitedRows(axes.rows.map(row => axes.columns.map(column => rows[row]?.[column] ?? "")), "\t");
}
export function sheetClear(rows: SheetRows, selection: SheetSelection): string[][] {
  const next = sheetRectangle(rows), axes = sheetSelectionAxes(selection, sheetDimensions(rows));
  for (const row of axes.rows) for (const column of axes.columns) next[row]![column] = "";
  return next;
}
export function sheetPaste(rows: SheetRows, selection: SheetSelection, text: string): { rows: string[][]; selection: SheetSelection } {
  const pasted = /[\t\r\n]/u.test(text) ? parseDelimitedRows(text, "\t") : [[text]];
  const size = sheetDimensions(rows), axes = sheetSelectionAxes(selection, size), source = sheetDimensions(pasted);
  if (source.rows === 1 && source.columns === 1) {
    const next = sheetRectangle(rows);
    for (const row of axes.rows) for (const column of axes.columns) next[row]![column] = pasted[0]![0]!;
    return { rows: next, selection };
  }
  const destinations = (selected: readonly number[], length: number, preserve: boolean) => Array.from({ length }, (_, index) => preserve && index < selected.length ? selected[index]! : preserve ? selected.at(-1)! + index - selected.length + 1 : selected[0]! + index);
  const rowIds = destinations(axes.rows, source.rows, selection.kind === "rows"), columnIds = destinations(axes.columns, source.columns, selection.kind === "columns");
  const next = sheetRectangle(rows, Math.max(size.rows, rowIds.at(-1)! + 1), Math.max(size.columns, columnIds.at(-1)! + 1));
  rowIds.forEach((row, y) => columnIds.forEach((column, x) => { next[row]![column] = pasted[y]?.[x] ?? ""; }));
  const nextSelection: SheetSelection = selection.kind === "rows" ? { kind: "rows", anchor: rowIds[0]!, indices: rowIds } : selection.kind === "columns" ? { kind: "columns", anchor: columnIds[0]!, indices: columnIds } : { kind: "cells", anchor: { row: rowIds[0]!, column: columnIds[0]! }, focus: { row: rowIds.at(-1)!, column: columnIds.at(-1)! } };
  return { rows: next, selection: nextSelection };
}
export function sheetInsert(rows: SheetRows, kind: "rows" | "columns", index: number, count = 1): string[][] {
  const next = sheetRectangle(rows);
  if (kind === "rows") next.splice(index, 0, ...Array.from({ length: count }, () => Array<string>(next[0]!.length).fill("")));
  else next.forEach(row => row.splice(index, 0, ...Array<string>(count).fill("")));
  return next;
}
export function sheetDelete(rows: SheetRows, kind: "rows" | "columns", indices: readonly number[]): string[][] {
  const deleted = new Set(indices), next = sheetRectangle(rows);
  if (kind === "rows") return sheetRectangle(next.filter((_, row) => !deleted.has(row)), Math.max(1, next.length - deleted.size), next[0]!.length);
  return sheetRectangle(next.map(row => row.filter((_, column) => !deleted.has(column))));
}
