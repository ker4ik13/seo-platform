"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { ProjectNoteFormat } from "@seo-platform/contracts";
import { noteDelimiter, parseDelimitedRows, serializeDelimitedRows, spreadsheetColumnName } from "../lib/project-note-files";
import { boundSheetCell, boundSheetSelection, sheetClear, sheetCopy, sheetDelete, sheetDimensions, sheetHeaderSelection, sheetInsert, sheetPaste, sheetRectangle, sheetSelectionAxes, sheetSequence, singleSheetCell, type SheetCell, type SheetSelection } from "../lib/spreadsheet-grid";
import { copyText } from "../lib/clipboard";
import { useSpreadsheetHistory } from "../lib/use-spreadsheet-history";
import { useVirtualWindow } from "../lib/use-virtual-window";
import { ContextMenu, type ContextMenuItem } from "./context-menu";
import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";
import styles from "./spreadsheet-editor.module.css";

type SheetDrag = ({ kind: "cells"; anchor: SheetCell } | { kind: "rows" | "columns"; anchor: number; base: readonly number[] }) & { x: number; y: number };
export function SpreadsheetEditor({ content, format, delimiter, readOnly = false, onChange }: Readonly<{ content: string; format: ProjectNoteFormat; delimiter?: string | undefined; readOnly?: boolean; onChange?: (content: string) => void }>) {
  const { t } = useUiLocale();
  const gridRef = useRef<HTMLDivElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<SheetDrag | undefined>(undefined), editing = useRef<{ cell: SheetCell; original: string } | undefined>(undefined);
  const pendingCaret = useRef<{ cell: SheetCell; position: number } | undefined>(undefined);
  const [selectionState, setSelection] = useState<SheetSelection>(() => singleSheetCell({ row: 0, column: 0 }));
  const [activeState, setActive] = useState<SheetCell>({ row: 0, column: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [error, setError] = useState<string>();
  const contentRef = useRef(content), mounted = useRef(true), readOnlyRef = useRef(readOnly);
  contentRef.current = content; readOnlyRef.current = readOnly;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [widths, setWidths] = useState<Readonly<Record<number, number>>>({});
  const parsed = useMemo(() => {
    try { return { rows: parseDelimitedRows(content, noteDelimiter(content, format, delimiter)), error: undefined }; }
    catch (caught) { return { rows: [[""]], error: caught instanceof Error ? caught.message : "Не удалось разобрать таблицу." }; }
  }, [content, format, delimiter]);
  const rows = parsed.rows;
  const { rows: rowCount, columns: columnCount } = sheetDimensions(rows);
  const size = useMemo(() => ({ rows: rowCount, columns: columnCount }), [rowCount, columnCount]);
  const active = boundSheetCell(activeState, size);
  const selection = useMemo(() => boundSheetSelection(selectionState, size), [selectionState, size]), selectionRef = useRef(selection), activeRef = useRef(active);
  selectionRef.current = selection; activeRef.current = active;
  const axes = useMemo(() => sheetSelectionAxes(selection, size), [selection, size]);
  const selectedRows = useMemo(() => new Set(axes.rows), [axes]), selectedColumns = useMemo(() => new Set(axes.columns), [axes]);
  const viewport = useVirtualWindow(scrollRef, rows.length, 34, 34, 16);
  const history = useSpreadsheetHistory(content, onChange);
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending) return;
    const field = scrollRef.current?.querySelector<HTMLTextAreaElement>(`[data-cell="${pending.cell.row}:${pending.cell.column}"]`);
    if (field) {
      pendingCaret.current = undefined;
      field.focus({ preventScroll: true });
      field.setSelectionRange(pending.position, pending.position);
    } else if (scrollRef.current) scrollRef.current.scrollTop = pending.cell.row * 34;
  });
  const columnWidth = (column: number) => widths[column] ?? 140;
  const commit = (next: readonly (readonly string[])[], group?: string) => { if (!readOnly) history.commit(serializeDelimitedRows(next, noteDelimiter(contentRef.current, format, delimiter)), group); };
  function select(next: SheetSelection, cell: SheetCell) { selectionRef.current = next; activeRef.current = cell; setSelection(next); setActive(cell); }
  function finishEdit() { editing.current = undefined; history.finish(); }
  function focusGrid() { gridRef.current?.focus({ preventScroll: true }); }
  function focusCell(cell: SheetCell, selectText = false) {
    const scroll = scrollRef.current;
    if (scroll && (cell.row < viewport.start || cell.row >= viewport.end)) scroll.scrollTop = cell.row * 34;
    let attempt = 0;
    const focus = () => {
      const input = scroll?.querySelector<HTMLTextAreaElement>(`[data-cell="${cell.row}:${cell.column}"]`);
      if (input) { input.focus({ preventScroll: true }); input.scrollIntoView({ block: "nearest", inline: "nearest" }); if (selectText) input.select(); }
      else if (attempt++ < 5) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }
  const closeMenu = useCallback(() => { setMenu(undefined); requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true })); }, []);
  function changeCell(cell: SheetCell, value: string) {
    const next = sheetRectangle(rows); next[cell.row]![cell.column] = value; commit(next, `cell:${cell.row}:${cell.column}`);
  }
  function beginEdit(cell: SheetCell, replace?: string) {
    if (readOnly) return;
    editing.current = { cell, original: rows[cell.row]?.[cell.column] ?? "" };
    select(singleSheetCell(cell), cell);
    if (replace !== undefined) changeCell(cell, replace);
    focusCell(cell, replace === undefined);
  }
  function startCellDrag(event: PointerEvent, cell: SheetCell) {
    if (readOnly || event.button !== 0) return;
    if (editing.current?.cell.row === cell.row && editing.current.cell.column === cell.column && !event.shiftKey) return;
    event.preventDefault(); finishEdit();
    const anchor = event.shiftKey && selectionRef.current.kind === "cells" ? selectionRef.current.anchor : cell;
    select({ kind: "cells", anchor, focus: cell }, cell); drag.current = { kind: "cells", anchor, x: event.clientX, y: event.clientY };
    gridRef.current?.setPointerCapture(event.pointerId); focusGrid();
  }
  function selectHeader(kind: "rows" | "columns", index: number, shift = false, additive = false) {
    finishEdit();
    const next = sheetHeaderSelection(selectionRef.current, kind, index, shift, additive);
    select(next, kind === "rows" ? { row: index, column: 0 } : { row: 0, column: index }); focusGrid();
  }
  function startHeaderDrag(event: PointerEvent, kind: "rows" | "columns", index: number) {
    if (event.button !== 0) return;
    const previous = selectionRef.current;
    const base = (event.ctrlKey || event.metaKey) && previous.kind === kind ? previous.indices.filter(value => value !== index) : [];
    event.preventDefault(); selectHeader(kind, index, event.shiftKey, event.ctrlKey || event.metaKey);
    const current = selectionRef.current;
    drag.current = { kind, anchor: current.kind === kind ? current.anchor : index, base, x: event.clientX, y: event.clientY };
    gridRef.current?.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent) {
    const current = drag.current; if (!current || Math.abs(event.clientX - current.x) + Math.abs(event.clientY - current.y) < 4) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-sheet-row], [data-sheet-column]");
    if (!target || !scrollRef.current?.contains(target)) return;
    const row = Number(target.dataset.sheetRow), column = Number(target.dataset.sheetColumn);
    if (current.kind === "cells" && Number.isInteger(row) && Number.isInteger(column)) {
      select({ kind: "cells", anchor: current.anchor, focus: { row, column } }, { row, column });
    } else if (current.kind !== "cells") {
      const index = current.kind === "rows" ? row : column;
      if (Number.isInteger(index)) select({ kind: current.kind, anchor: current.anchor, indices: [...new Set([...current.base, ...sheetSequence(current.anchor, index)])].sort((a, b) => a - b) }, current.kind === "rows" ? { row: index, column: 0 } : { row: 0, column: index });
    }
    const box = scrollRef.current.getBoundingClientRect();
    scrollRef.current.scrollBy({ top: event.clientY > box.bottom - 22 ? 34 : event.clientY < box.top + 34 ? -34 : 0, left: event.clientX > box.right - 22 ? 60 : event.clientX < box.left + 46 ? -60 : 0 });
  }
  function openMenu(event: MouseEvent, kind: "cells" | "rows" | "columns", cell: SheetCell) {
    if (readOnly) return;
    event.preventDefault(); finishEdit();
    const selected = sheetSelectionAxes(selectionRef.current, size);
    if (kind === "rows" || kind === "columns") {
      const index = kind === "rows" ? cell.row : cell.column;
      if (selectionRef.current.kind !== kind || !selectionRef.current.indices.includes(index)) selectHeader(kind, index);
    } else if (!selected.rows.includes(cell.row) || !selected.columns.includes(cell.column)) select(singleSheetCell(cell), cell);
    setMenu({ x: event.clientX, y: event.clientY });
  }
  function pasteText(text: string, target = selectionRef.current) {
    try {
      const latestRows = parseDelimitedRows(contentRef.current, noteDelimiter(contentRef.current, format, delimiter));
      const pasted = sheetPaste(latestRows, target, text); finishEdit(); commit(pasted.rows);
      const nextAxes = sheetSelectionAxes(pasted.selection, sheetDimensions(pasted.rows));
      select(pasted.selection, { row: nextAxes.rows[0]!, column: nextAxes.columns[0]! }); setError(undefined); focusGrid();
    } catch { setError("Не удалось вставить таблицу: проверьте кавычки в исходном тексте."); }
  }
  function paste(event: ClipboardEvent) {
    if (readOnly) return;
    const text = event.clipboardData.getData("text/plain");
    if (editing.current) return;
    event.preventDefault(); pasteText(text);
  }
  function copy(event: ClipboardEvent, cut = false) {
    if (editing.current) return;
    event.preventDefault(); event.clipboardData.setData("text/plain", sheetCopy(rows, selectionRef.current));
    if (cut && !readOnly) commit(sheetClear(rows, selectionRef.current));
  }
  async function copySelection(cut = false) {
    const target = selectionRef.current, snapshot = contentRef.current;
    if (!await copyText(sheetCopy(rows, target))) { setError("Не удалось скопировать выделение."); return; }
    if (!mounted.current) return;
    if (cut && !readOnlyRef.current) {
      if (snapshot !== contentRef.current) setError("Данные изменились. Выделение скопировано без удаления.");
      else commit(sheetClear(rows, target));
    }
  }
  async function pasteClipboard() {
    const target = selectionRef.current;
    try { const text = await navigator.clipboard.readText(); if (!mounted.current) return; if (readOnlyRef.current) { setError("Файл сейчас недоступен для редактирования."); return; } pasteText(text, target); }
    catch { setError("Не удалось прочитать буфер обмена. Используйте Ctrl+V."); }
  }
  function insert(kind: "rows" | "columns", after: boolean) {
    const selected = sheetSelectionAxes(selectionRef.current, size)[kind];
    const index = (after ? selected.at(-1)! + 1 : selected[0]!);
    const count = selectionRef.current.kind === kind ? selected.length : 1;
    finishEdit(); commit(sheetInsert(rows, kind, index, count));
    if (kind === "columns") setWidths({});
    select({ kind, anchor: index, indices: sheetSequence(index, index + count - 1) }, kind === "rows" ? { row: index, column: 0 } : { row: 0, column: index });
  }
  function remove(kind: "rows" | "columns") {
    const selected = sheetSelectionAxes(selectionRef.current, size)[kind];
    const next = sheetDelete(rows, kind, selected); finishEdit(); commit(next); if (kind === "columns") setWidths({});
    const cell = boundSheetCell(activeRef.current, sheetDimensions(next)); select(singleSheetCell(cell), cell); focusGrid();
  }
  function resizeColumn(event: PointerEvent<HTMLSpanElement>, column: number) {
    event.preventDefault(); event.stopPropagation();
    const initial = columnWidth(column), start = event.clientX, element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (pointer: globalThis.PointerEvent) => setWidths(old => ({ ...old, [column]: Math.max(64, Math.min(640, initial + pointer.clientX - start)) }));
    const stop = () => { element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", stop); element.removeEventListener("pointercancel", stop); };
    element.addEventListener("pointermove", move); element.addEventListener("pointerup", stop, { once: true }); element.addEventListener("pointercancel", stop, { once: true });
  }
  function navigate(event: KeyboardEvent) {
    if (readOnly) return;
    const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (modifier && (key === "z" || key === "y")) { event.preventDefault(); finishEdit(); if (key === "y" || event.shiftKey) history.redo(); else history.undo(); return; }
    if (modifier && key === "a" && !editing.current) { event.preventDefault(); select({ kind: "cells", anchor: { row: 0, column: 0 }, focus: { row: size.rows - 1, column: size.columns - 1 } }, active); return; }
    if (event.key === "Escape") {
      if (editing.current) { const previous = editing.current; changeCell(previous.cell, previous.original); finishEdit(); }
      else select(singleSheetCell(active), active);
      focusGrid(); return;
    }
    if (event.altKey && event.key === "Enter") {
      event.preventDefault();
      const cell = editing.current?.cell ?? active;
      const field = event.target instanceof HTMLTextAreaElement ? event.target : undefined;
      const value = field?.value ?? rows[cell.row]?.[cell.column] ?? "";
      const start = field?.selectionStart ?? value.length, end = field?.selectionEnd ?? value.length;
      if (!editing.current) editing.current = { cell, original: value };
      select(singleSheetCell(cell), cell);
      pendingCaret.current = { cell, position: start + 1 };
      changeCell(cell, value.slice(0, start) + "\n" + value.slice(end));
      return;
    }
    if (event.key === "F2" || (event.key === "Enter" && !editing.current && event.target === gridRef.current)) { event.preventDefault(); beginEdit(active); return; }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const box = scrollRef.current?.getBoundingClientRect(); setMenu({ x: (box?.left ?? 0) + 46, y: (box?.top ?? 0) + 34 }); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && !editing.current) { event.preventDefault(); history.finish(); commit(sheetClear(rows, selectionRef.current)); return; }
    if (!modifier && !event.altKey && event.key.length === 1 && !editing.current) { event.preventDefault(); beginEdit(active, event.key); return; }
    if (editing.current && !["Enter", "Tab"].includes(event.key)) return;
    let cell: SheetCell | undefined;
    const from = event.shiftKey && selectionRef.current.kind === "cells" ? selectionRef.current.focus : active;
    if (event.key.startsWith("Arrow")) cell = { row: from.row + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0), column: from.column + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0) };
    if (event.key === "Enter") cell = { row: active.row + (event.shiftKey ? -1 : 1), column: active.column };
    if (event.key === "Tab") { const position = active.row * size.columns + active.column + (event.shiftKey ? -1 : 1); cell = { row: Math.floor(Math.max(0, position) / size.columns), column: Math.max(0, position) % size.columns }; }
    if (event.key === "Home") cell = { row: modifier ? 0 : active.row, column: 0 };
    if (event.key === "End") cell = { row: modifier ? size.rows - 1 : active.row, column: size.columns - 1 };
    if (event.key === "PageDown" || event.key === "PageUp") cell = { row: active.row + (event.key === "PageDown" ? 1 : -1) * Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 340) / 34) - 1), column: active.column };
    if (!cell) return;
    event.preventDefault(); finishEdit();
    if ((event.key === "Tab" || event.key === "Enter") && cell.row >= size.rows) commit(sheetInsert(rows, "rows", size.rows));
    else cell = boundSheetCell(cell, size);
    const next: SheetSelection = event.shiftKey && event.key !== "Tab" && event.key !== "Enter" ? { kind: "cells", anchor: selectionRef.current.kind === "cells" ? selectionRef.current.anchor : active, focus: cell } : singleSheetCell(cell);
    select(next, cell); focusCell(cell);
  }
  const menuItems: ContextMenuItem[] = [
    { id: "copy", label: "Копировать", icon: <Icon name="copy" />, onSelect: () => void copySelection() },
    { id: "cut", label: "Вырезать", icon: <Icon name="cut" />, onSelect: () => void copySelection(true) },
    { id: "paste", label: "Вставить", icon: <Icon name="paste" />, onSelect: () => void pasteClipboard() },
    { id: "clear", label: "Очистить содержимое", dividerBefore: true, onSelect: () => { finishEdit(); commit(sheetClear(rows, selectionRef.current)); } },
    ...(selection.kind !== "columns" ? [
      { id: "row-before", label: "Вставить строки выше", dividerBefore: true, onSelect: () => insert("rows", false) },
      { id: "row-after", label: "Вставить строки ниже", onSelect: () => insert("rows", true) },
      { id: "row-delete", label: "Удалить строки", danger: true, onSelect: () => remove("rows") }
    ] : []),
    ...(selection.kind !== "rows" ? [
      { id: "column-before", label: "Вставить колонки слева", dividerBefore: true, onSelect: () => insert("columns", false) },
      { id: "column-after", label: "Вставить колонки справа", onSelect: () => insert("columns", true) },
      { id: "column-delete", label: "Удалить колонки", danger: true, onSelect: () => remove("columns") }
    ] : [])
  ];
  const coordinate = (cell: SheetCell) => `${spreadsheetColumnName(cell.column)}${cell.row + 1}`;
  const selectionLabel = selection.kind === "cells" ? `${coordinate(selection.anchor)}${coordinate(selection.anchor) === coordinate(selection.focus) ? "" : `:${coordinate(selection.focus)}`}` : selection.kind === "rows" ? axes.rows.slice(0, 4).map(row => row + 1).join(", ") + (axes.rows.length > 4 ? "…" : "") : axes.columns.slice(0, 4).map(spreadsheetColumnName).join(", ") + (axes.columns.length > 4 ? "…" : "");
  return <div className={styles.sheet} onPaste={paste} onCopy={event => copy(event)} onCut={event => copy(event, true)}>
    {!readOnly && !parsed.error && <div className={styles.toolbar}>
      <button className="secondary-button" type="button" onClick={() => { finishEdit(); commit(sheetInsert(rows, "rows", size.rows)); }}><Icon name="plus" /><UiText text="Строка" /></button>
      <button className="secondary-button" type="button" onClick={() => { finishEdit(); commit(sheetInsert(rows, "columns", size.columns)); }}><Icon name="plus" /><UiText text="Колонка" /></button>
      <button className="secondary-button" type="button" aria-label={t("Отменить действие")} title={t("Отменить действие") + " · Ctrl+Z"} disabled={!history.canUndo} onClick={() => { finishEdit(); history.undo(); }}><Icon name="undo" /></button>
      <button className="secondary-button" type="button" aria-label={t("Повторить действие")} title={t("Повторить действие") + " · Ctrl+Shift+Z"} disabled={!history.canRedo} onClick={() => { finishEdit(); history.redo(); }}><Icon name="redo" /></button>
      <button className="secondary-button" type="button" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); finishEdit(); setMenu({ x: box.left, y: box.bottom }); }}><UiText text="Действия" /><Icon name="chevronDown" /></button>
      <span aria-live="polite">{selectionLabel.length > 60 ? `${selectionLabel.slice(0, 57)}…` : selectionLabel}</span>
    </div>}
    {error && <p className={styles.error} role="alert">{t(error)}</p>}
    {parsed.error ? <div className={styles.error} role="alert">{t(parsed.error)}</div> : <div className={styles.scroll} ref={scrollRef}>
      <div className={styles.grid} ref={gridRef} role="grid" aria-label={t("Таблица файла")} aria-rowcount={size.rows + 1} aria-colcount={size.columns + 1} aria-readonly={readOnly} tabIndex={readOnly ? -1 : 0} onKeyDown={navigate} onDoubleClick={event => {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-sheet-row][data-sheet-column]");
        if (target && scrollRef.current?.contains(target)) beginEdit({ row: Number(target.dataset.sheetRow), column: Number(target.dataset.sheetColumn) });
      }} onPointerMove={moveDrag} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
      <table className={styles.table} role="presentation" style={{ width: 46 + Array.from({ length: size.columns }, (_, column) => columnWidth(column)).reduce((sum, value) => sum + value, 0) }}>
        <colgroup><col style={{ width: 46 }} />{Array.from({ length: size.columns }, (_, column) => <col key={column} style={{ width: columnWidth(column) }} />)}</colgroup>
        <thead role="rowgroup"><tr role="row"><th className={styles.rowNumber} role="columnheader">{readOnly ? "#" : <button aria-label={t("Выделить всю таблицу")} type="button" onClick={() => { finishEdit(); select({ kind: "cells", anchor: { row: 0, column: 0 }, focus: { row: size.rows - 1, column: size.columns - 1 } }, { row: 0, column: 0 }); focusGrid(); }}>#</button>}</th>{Array.from({ length: size.columns }, (_, column) => <th key={column} role="columnheader" data-sheet-column={column} className={!readOnly && selection.kind === "columns" && selectedColumns.has(column) ? styles.selectedHeader : undefined} aria-selected={!readOnly && selection.kind === "columns" && selectedColumns.has(column)}>
          {readOnly ? spreadsheetColumnName(column) : <><button type="button" aria-label={t("Выделить колонку {0}", [spreadsheetColumnName(column)])} onPointerDown={event => startHeaderDrag(event, "columns", column)} onClick={event => { if (event.detail === 0) selectHeader("columns", column, event.shiftKey, event.ctrlKey || event.metaKey); }} onContextMenu={event => openMenu(event, "columns", { row: 0, column })}>{spreadsheetColumnName(column)}</button><span className={styles.resize} role="separator" aria-orientation="vertical" aria-label={t("Ширина колонки {0}", [spreadsheetColumnName(column)])} aria-valuemin={64} aria-valuemax={640} aria-valuenow={columnWidth(column)} tabIndex={0} onPointerDown={event => resizeColumn(event, column)} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); setWidths(old => ({ ...old, [column]: Math.max(64, Math.min(640, columnWidth(column) + (event.key === "ArrowRight" ? 12 : -12))) })); } }} /></>}
        </th>)}</tr></thead>
        <tbody role="rowgroup">
          {viewport.paddingTop > 0 && <tr aria-hidden="true"><td colSpan={size.columns + 1} style={{ height: viewport.paddingTop, padding: 0 }} /></tr>}
          {rows.slice(viewport.start, viewport.end).map((row, offset) => {
            const rowIndex = viewport.start + offset;
            return <tr key={rowIndex} role="row" aria-rowindex={rowIndex + 2}><th className={`${styles.rowNumber}${!readOnly && selection.kind === "rows" && selectedRows.has(rowIndex) ? ` ${styles.selectedHeader}` : ""}`} role="rowheader" data-sheet-row={rowIndex} aria-selected={!readOnly && selection.kind === "rows" && selectedRows.has(rowIndex)}>{readOnly ? rowIndex + 1 : <button type="button" aria-label={t("Выделить строку {0}", [String(rowIndex + 1)])} onPointerDown={event => startHeaderDrag(event, "rows", rowIndex)} onClick={event => { if (event.detail === 0) selectHeader("rows", rowIndex, event.shiftKey, event.ctrlKey || event.metaKey); }} onContextMenu={event => openMenu(event, "rows", { row: rowIndex, column: 0 })}>{rowIndex + 1}</button>}</th>{Array.from({ length: size.columns }, (_, column) => {
              const cell = { row: rowIndex, column }, selected = !readOnly && selectedRows.has(rowIndex) && selectedColumns.has(column), focused = !readOnly && active.row === rowIndex && active.column === column;
              return <td key={column} role="gridcell" aria-selected={selected} className={`${selected ? styles.selected : ""}${focused ? ` ${styles.active}` : ""}`} data-sheet-row={rowIndex} data-sheet-column={column} onPointerDown={event => startCellDrag(event, cell)} onContextMenu={event => openMenu(event, "cells", cell)}>
                {readOnly ? <span>{row[column] ?? ""}</span> : <textarea rows={1} spellCheck={false} aria-label={t("Ячейка {0}{1}", [spreadsheetColumnName(column), String(rowIndex + 1)])} data-cell={`${rowIndex}:${column}`} tabIndex={focused ? 0 : -1} value={row[column] ?? ""} onFocus={() => { const current = sheetSelectionAxes(selectionRef.current, size); if (!current.rows.includes(rowIndex) || !current.columns.includes(column)) select(singleSheetCell(cell), cell); }} onBlur={() => finishEdit()} onChange={event => changeCell(cell, event.target.value)} />}
              </td>;
            })}</tr>;
          })}
          {viewport.paddingBottom > 0 && <tr aria-hidden="true"><td colSpan={size.columns + 1} style={{ height: viewport.paddingBottom, padding: 0 }} /></tr>}
        </tbody>
      </table></div>
    </div>}
    {menu && !readOnly && <ContextMenu x={menu.x} y={menu.y} label={t("Действия с выделением")} items={menuItems} onClose={closeMenu} />}
  </div>;
}
