"use client";
import { semanticColumnPresenceKey } from "../lib/semantic-column-presence";

import type {
  AriaAttributes,
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react";
import { useEffect, useState } from "react";
import { useUiLocale } from "./ui-locale";


export interface KeywordDataGridColumn<Row> {
  readonly key: string;
  readonly header: ReactNode;
  readonly cell: (row: Row) => ReactNode;
  readonly ariaSort?: AriaAttributes["aria-sort"];
  readonly headerClassName?: string;
  readonly cellClassName?: string | ((row: Row) => string | undefined);
  readonly width?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly resizeLabel?: string;
  readonly onResize?: (width: number) => void;
  readonly onResizeEnd?: (width: number) => void;
}

export interface KeywordDataGridRowPresence {
  readonly colorIndex: number;
  readonly kind: "SELECTED" | "HIGHLIGHTED";
  readonly label: string;
  readonly avatarUrl?: string;
  readonly initials: string;
}

const EMPTY_ROW_PRESENCE: ReadonlyMap<
  string,
  KeywordDataGridRowPresence
> = new Map();

export function KeywordDataGrid<Row extends Readonly<{ id: string }>>({
  actions,
  allRowsSelected,
  ariaLabel,
  columns,
  density = "COMFORTABLE",
  draggable = false,
  emptyContent,
  focusedId,
  highlightedIds = new Set<string>(),
  onContextMenu,
  onDragStart,
  onRowClick,
  onToggleAll,
  onToggleHighlighted,
  onToggleRow,
  paddingBottom = 0,
  paddingTop = 0,
  presenceByRowId = EMPTY_ROW_PRESENCE,
  rowNumberOffset = 0,
  rows,
  selectedIds,
  showRowNumbers = false,
  tableClassName = "semantic-table",
  toggleAllDisabled = false
}: Readonly<{
  actions?: (row: Row) => ReactNode;
  allRowsSelected?: boolean;
  ariaLabel: string;
  columns: readonly KeywordDataGridColumn<Row>[];
  density?: "COMFORTABLE" | "COMPACT";
  draggable?: boolean;
  emptyContent?: ReactNode;
  focusedId?: string | undefined;
  highlightedIds?: ReadonlySet<string>;
  onContextMenu?: (event: MouseEvent<HTMLTableRowElement>, row: Row) => void;
  onDragStart?: (event: DragEvent<HTMLTableRowElement>, row: Row) => void;
  onRowClick?: (row: Row, event: MouseEvent<HTMLTableRowElement>) => void;
  onToggleAll: () => void;
  onToggleHighlighted?: () => void;
  onToggleRow: (row: Row, event: MouseEvent<HTMLInputElement>) => void;
  paddingBottom?: number;
  paddingTop?: number;
  presenceByRowId?: ReadonlyMap<string, KeywordDataGridRowPresence>;
  rowNumberOffset?: number;
  rows: readonly Row[];
  selectedIds: ReadonlySet<string>;
  showRowNumbers?: boolean;
  tableClassName?: string;
  toggleAllDisabled?: boolean;
}>) {
  const { t: uiText } = useUiLocale();
  const allSelected =
    allRowsSelected ??
    (rows.length > 0 && rows.every(({ id }) => selectedIds.has(id)));
  const allHighlightedSelected =
    highlightedIds.size > 0 &&
    [...highlightedIds].every((id) => selectedIds.has(id));
  const rowNumberColumnWidth = 42;
  const selectionColumnWidth = onToggleHighlighted ? 62 : 38;
  const columnCount =
    columns.length + 1 + (showRowNumbers ? 1 : 0) + (actions ? 1 : 0);
  const hasSizedColumns = columns.some(({ width }) => width !== undefined);
  const tableWidth = hasSizedColumns
    ? (showRowNumbers ? rowNumberColumnWidth : 0) +
      selectionColumnWidth +
      columns.reduce((sum, column) => sum + (column.width ?? 132), 0) +
      (actions ? 40 : 0)
    : undefined;

  function startColumnResize(
    event: ReactPointerEvent<HTMLSpanElement>,
    column: KeywordDataGridColumn<Row>
  ): void {
    if (column.width === undefined || !column.onResize) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = column.width;
    let nextWidth = startWidth;
    let finished = false;
    const onPointerMove = (moveEvent: PointerEvent) => {
      nextWidth = clampedWidth(
        startWidth + moveEvent.clientX - startX,
        column.minWidth,
        column.maxWidth
      );
      column.onResize?.(nextWidth);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      handle.removeEventListener("lostpointercapture", finish);
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      document.body.classList.remove("semantic-column-resizing");
      column.onResizeEnd?.(nextWidth);
    };
    document.body.classList.add("semantic-column-resizing");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    window.addEventListener("blur", finish, { once: true });
    handle.addEventListener("lostpointercapture", finish, { once: true });
    handle.setPointerCapture(pointerId);
  }

  function resizeColumnFromKeyboard(
    event: KeyboardEvent<HTMLSpanElement>,
    column: KeywordDataGridColumn<Row>
  ): void {
    if (column.width === undefined || !column.onResize) return;
    const direction =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const nextWidth = clampedWidth(
      column.width + direction * (event.shiftKey ? 32 : 8),
      column.minWidth,
      column.maxWidth
    );
    column.onResize(nextWidth);
    column.onResizeEnd?.(nextWidth);
  }

  return (
    <table
      aria-label={ariaLabel}
      className={`${tableClassName} density-${density.toLowerCase()}${hasSizedColumns ? " has-sized-columns" : ""}${onToggleHighlighted ? " has-highlight-selector" : ""}${showRowNumbers ? " has-row-numbers" : ""}`}
      data-presence-key="semantic-keyword-table"
      style={
        tableWidth
          ? { minWidth: tableWidth, width: tableWidth }
          : undefined
      }
    >
      {hasSizedColumns && (
        <colgroup>
          {showRowNumbers && <col style={{ width: rowNumberColumnWidth }} />}
          <col style={{ width: selectionColumnWidth }} />
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width ?? 132 }} />
          ))}
          {actions && <col style={{ width: 40 }} />}
        </colgroup>
      )}
      <thead>
        <tr>
          {showRowNumbers && (
            <th
              aria-label={uiText("Позиция строки")}
              className="semantic-row-number-cell"
              scope="col"
            >
              №
            </th>
          )}
          <th className="semantic-select-cell semantic-select-header">
            <span className="semantic-header-selection-controls">
              <input
                aria-label={uiText("Выбрать все запросы текущего фильтра")}
                checked={allSelected}
                disabled={toggleAllDisabled}
                onChange={onToggleAll}
                title={toggleAllDisabled ? uiText("Загружаем все запросы для выбора") : uiText("Выбрать все запросы текущего фильтра")}
                type="checkbox"
              />
              {onToggleHighlighted && (
                <input
                  aria-label={uiText("Выбрать подсвеченные запросы ({0})", [String(highlightedIds.size)])}
                  checked={allHighlightedSelected}
                  className="semantic-highlight-selector"
                  disabled={highlightedIds.size === 0}
                  onChange={onToggleHighlighted}
                  title={uiText("Перенести подсвеченные строки в массовый выбор")}
                  type="checkbox"
                />
              )}
            </span>
          </th>
          {columns.map((column) => (
            <th
              aria-sort={column.ariaSort}
              className={`${column.headerClassName ?? ""}${column.onResize ? " semantic-resizable-column" : ""}`.trim() || undefined}
              key={column.key}
            >
              {column.header}
              {column.width !== undefined && column.onResize && (
                <span
                  aria-label={uiText("Изменить ширину колонки {0}", [String(column.resizeLabel ?? plainHeader(column.header, column.key))])}
                  aria-orientation="vertical"
                  aria-valuemax={column.maxWidth}
                  aria-valuemin={column.minWidth}
                  aria-valuenow={column.width}
                  className="semantic-column-resizer"
                  onKeyDown={(event) => resizeColumnFromKeyboard(event, column)}
                  onPointerDown={(event) => startColumnResize(event, column)}
                  role="separator"
                  tabIndex={0}
                  title={uiText("Потяните для изменения ширины. Стрелки — с клавиатуры")}
                />
              )}
            </th>
          ))}
          {actions && <th aria-label={uiText("Действия")} />}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && emptyContent && (
          <tr className="semantic-data-grid-empty-row">
            <td colSpan={columnCount}>{emptyContent}</td>
          </tr>
        )}
        {paddingTop > 0 && (
          <tr aria-hidden="true" className="semantic-virtual-spacer">
            <td colSpan={columnCount} style={{ height: paddingTop }} />
          </tr>
        )}
        {rows.map((row, index) => {
          const selected = selectedIds.has(row.id);
          const highlighted = highlightedIds.has(row.id);
          const presence = presenceByRowId.get(row.id);
          const previousPresence = presenceByRowId.get(
            rows[index - 1]?.id ?? ""
          );
          const nextPresence = presenceByRowId.get(
            rows[index + 1]?.id ?? ""
          );
          const joinedPrevious =
            selected && selectedIds.has(rows[index - 1]?.id ?? "");
          const joinedNext =
            selected && selectedIds.has(rows[index + 1]?.id ?? "");
          const highlightedPrevious =
            highlighted && highlightedIds.has(rows[index - 1]?.id ?? "");
          const highlightedNext =
            highlighted && highlightedIds.has(rows[index + 1]?.id ?? "");
          return (
            <tr
              className={[
                focusedId === row.id ? "focused" : "",
                highlighted ? "highlighted" : "",
                highlightedPrevious ? "highlighted-previous" : "",
                highlightedNext ? "highlighted-next" : "",
                selected ? "selected" : "",
                joinedPrevious ? "joined-previous" : "",
                joinedNext ? "joined-next" : "",
                presence
                  ? `remote-presence-${presence.kind.toLowerCase()}`
                  : "",
                presence ? `presence-color-${presence.colorIndex}` : "",
                sameRowPresence(presence, previousPresence)
                  ? "remote-presence-previous"
                  : "",
                sameRowPresence(presence, nextPresence)
                  ? "remote-presence-next"
                  : ""
              ]
                .filter(Boolean)
                .join(" ") || undefined}
              draggable={draggable}
              data-presence-cursor-anchor="true"
              data-presence-key={`keyword:${row.id}`}
              data-presence-row-id={row.id}
              key={row.id}
              onClick={(event) => onRowClick?.(row, event)}
              onContextMenu={(event) => onContextMenu?.(event, row)}
              onDragStart={(event) => onDragStart?.(event, row)}
              title={presence?.label}
            >
              {showRowNumbers && (
                <td
                  aria-label={uiText("Позиция строки {0}", [String(rowNumberOffset + index + 1)])}
                  className="semantic-row-number-cell"
                  data-presence-cursor-anchor="true"
                  data-presence-key={`keyword:${row.id}:column:position`}
                >
                  <span>{rowNumberOffset + index + 1}</span>
                  {presence && <PresenceRowAvatar presence={presence} />}
                </td>
              )}
              <td
                className="semantic-select-cell"
                data-presence-cursor-anchor="true"
                data-presence-key={`keyword:${row.id}:column:selection`}
              >
                <input
                  aria-label={uiText("Выбрать запрос {0}", [String(row.id)])}
                  checked={selected}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleRow(row, event);
                  }}
                  readOnly
                  type="checkbox"
                />
              </td>
              {columns.map((column) => (
                <td
                  className={
                    typeof column.cellClassName === "function"
                      ? column.cellClassName(row)
                      : column.cellClassName
                  }
                  data-presence-cursor-anchor="true"
                  data-presence-column-id={column.key}
                  data-presence-key={`keyword:${row.id}:column:${semanticColumnPresenceKey(column.key)}`}
                  data-presence-row-id={row.id}
                  key={column.key}
                >
                  {column.cell(row)}
                </td>
              ))}
              {actions && (
                <td
                  data-presence-cursor-anchor="true"
                  data-presence-key={`keyword:${row.id}:column:actions`}
                >
                  {actions(row)}
                </td>
              )}
            </tr>
          );
        })}
        {paddingBottom > 0 && (
          <tr aria-hidden="true" className="semantic-virtual-spacer">
            <td colSpan={columnCount} style={{ height: paddingBottom }} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function PresenceRowAvatar({
  presence
}: Readonly<{ presence: KeywordDataGridRowPresence }>) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [presence.avatarUrl]);
  return (
    <span
      aria-hidden="true"
      className={`semantic-row-presence-avatar presence-color-${presence.colorIndex}`}
      title={presence.label}
    >
      {presence.avatarUrl && !imageFailed ? (
        <img
          alt=""
          decoding="async"
          onError={() => setImageFailed(true)}
          src={presence.avatarUrl}
        />
      ) : (
        presence.initials
      )}
    </span>
  );
}

function sameRowPresence(
  left: KeywordDataGridRowPresence | undefined,
  right: KeywordDataGridRowPresence | undefined
): boolean {
  return Boolean(
    left &&
      right &&
      left.colorIndex === right.colorIndex &&
      left.kind === right.kind &&
      left.label === right.label
  );
}

function clampedWidth(
  width: number,
  minWidth = 64,
  maxWidth = 640
): number {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

function plainHeader(header: ReactNode, fallback: string): string {
  return typeof header === "string" || typeof header === "number"
    ? String(header)
    : fallback;
}
