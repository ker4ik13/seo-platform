"use client";

import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import { ContextMenu, type ContextMenuItem } from "./context-menu";

export interface SemanticGroupTreeItem {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly color?: string;
  readonly keywordCount: number;
  readonly version: number;
}

interface FlatGroup {
  readonly group: SemanticGroupTreeItem;
  readonly depth: number;
  readonly hasChildren: boolean;
}

export function SemanticGroupTree({
  activeGroupId,
  groups,
  onCreate,
  onDelete,
  onExport,
  onMove,
  onKeywordDrop,
  onRename,
  onSelect,
  total
}: Readonly<{
  activeGroupId?: string;
  groups: readonly SemanticGroupTreeItem[];
  onCreate: (parentId?: string) => void;
  onDelete: (groups: readonly SemanticGroupTreeItem[]) => void;
  onExport: (group: SemanticGroupTreeItem) => void;
  onMove: (groups: readonly SemanticGroupTreeItem[], targetId?: string) => void;
  onKeywordDrop: (keywordIds: readonly string[], targetId?: string) => void;
  onRename: (group: SemanticGroupTreeItem) => void;
  onSelect: (groupId?: string) => void;
  total?: number;
}>) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(groups.map(({ id }) => id))
  );
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [draggingIds, setDraggingIds] = useState<readonly string[]>([]);
  const [dragTarget, setDragTarget] = useState<string | "ROOT">();
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<Readonly<{
    x: number;
    y: number;
    group: SemanticGroupTreeItem;
  }>>();
  const flatGroups = useMemo(
    () => flattenGroups(groups, expandedIds, search),
    [expandedIds, groups, search]
  );
  useEffect(() => {
    const clearDragTarget = () => setDragTarget(undefined);
    document.addEventListener("dragend", clearDragTarget);
    return () => document.removeEventListener("dragend", clearDragTarget);
  }, []);
  const selectedGroups = groups.filter(({ id }) => selectedIds.has(id));

  function chooseGroup(
    event: MouseEvent,
    group: SemanticGroupTreeItem
  ): void {
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(group.id)) next.delete(group.id);
        else next.add(group.id);
        return next;
      });
      return;
    }
    setSelectedIds(new Set([group.id]));
    onSelect(group.id);
  }

  function openContextMenu(
    event: MouseEvent,
    group: SemanticGroupTreeItem
  ): void {
    event.preventDefault();
    if (!selectedIds.has(group.id)) setSelectedIds(new Set([group.id]));
    setContextMenu({ x: event.clientX, y: event.clientY, group });
  }

  function startDrag(
    event: DragEvent,
    group: SemanticGroupTreeItem
  ): void {
    const ids = selectedIds.has(group.id)
      ? [...selectedIds]
      : [group.id];
    setDraggingIds(ids);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ids.join(","));
  }

  function drop(targetId?: string): void {
    const moving = groups.filter(({ id }) => draggingIds.includes(id));
    setDraggingIds([]);
    setDragTarget(undefined);
    if (moving.length === 0 || moving.some(({ id }) => id === targetId)) return;
    onMove(moving, targetId);
  }

  const contextGroups = contextMenu
    ? selectedIds.has(contextMenu.group.id) && selectedGroups.length > 0
      ? selectedGroups
      : [contextMenu.group]
    : [];
  const contextItems: readonly ContextMenuItem[] = contextMenu
    ? [
        {
          id: "create",
          label: "Создать подгруппу",
          onSelect: () => onCreate(contextMenu.group.id)
        },
        {
          id: "rename",
          label: "Переименовать",
          disabled: contextGroups.length !== 1,
          onSelect: () => onRename(contextMenu.group)
        },
        {
          id: "move",
          label:
            contextGroups.length > 1
              ? `Переместить группы (${contextGroups.length})…`
              : "Переместить…",
          onSelect: () => onMove(contextGroups)
        },
        {
          id: "export",
          label: "Экспортировать группу",
          disabled: contextGroups.length !== 1,
          onSelect: () => onExport(contextMenu.group)
        },
        {
          id: "delete",
          label:
            contextGroups.length > 1
              ? `Удалить группы (${contextGroups.length})`
              : "Удалить группу",
          danger: true,
          dividerBefore: true,
          onSelect: () => onDelete(contextGroups)
        }
      ]
    : [];

  return (
    <nav aria-label="Группы семантического ядра" className="semantic-group-tree">
      <header>
        <strong>Группы</strong>
        <div>
          {selectedIds.size > 0 && <span>{selectedIds.size}</span>}
          <button
            aria-label="Создать корневую группу"
            onClick={() => onCreate()}
            title="Создать группу"
            type="button"
          >
            +
          </button>
        </div>
      </header>
      <label className="semantic-group-search">
        <span className="visually-hidden">Поиск по группам</span>
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по группам"
          type="search"
          value={search}
        />
      </label>
      <button
        aria-current={!activeGroupId ? "true" : undefined}
        className={`semantic-group-root${dragTarget === "ROOT" ? " drag-target" : ""}`}
        onClick={() => {
          setSelectedIds(new Set());
          onSelect();
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragTarget("ROOT");
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const keywordIds = draggedKeywordIds(event);
          if (keywordIds.length > 0) {
            onKeywordDrop(keywordIds);
            setDragTarget(undefined);
            return;
          }
          drop();
        }}
        type="button"
      >
        <span aria-hidden="true">▤</span>
        <strong>Все запросы</strong>
        <small>{total === undefined ? "—" : formatInteger(total)}</small>
      </button>
      <div className="semantic-group-tree-list">
        {flatGroups.map(({ depth, group, hasChildren }) => {
          const selected = selectedIds.has(group.id);
          return (
            <div
              className={`semantic-group-tree-row${activeGroupId === group.id ? " active" : ""}${selected ? " selected" : ""}${dragTarget === group.id ? " drag-target" : ""}`}
              draggable
              key={group.id}
              onContextMenu={(event) => openContextMenu(event, group)}
              onDragEnd={() => {
                setDraggingIds([]);
                setDragTarget(undefined);
              }}
              onDragStart={(event) => startDrag(event, group)}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragTarget(group.id);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const keywordIds = draggedKeywordIds(event);
                if (keywordIds.length > 0) {
                  onKeywordDrop(keywordIds, group.id);
                  setDragTarget(undefined);
                  return;
                }
                drop(group.id);
              }}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
              <button
                aria-label={
                  hasChildren
                    ? expandedIds.has(group.id)
                      ? `Свернуть ${group.name}`
                      : `Развернуть ${group.name}`
                    : undefined
                }
                className="semantic-group-toggle"
                disabled={!hasChildren}
                onClick={() =>
                  setExpandedIds((current) => toggleId(current, group.id))
                }
                type="button"
              >
                {hasChildren ? (expandedIds.has(group.id) ? "⌄" : "›") : ""}
              </button>
              <button
                className="semantic-group-name"
                onClick={(event) => chooseGroup(event, group)}
                title={`${group.path}. Ctrl/Cmd+клик — множественный выбор`}
                type="button"
              >
                <i style={{ background: group.color ?? "#a8a5b8" }} />
                <span>{group.name}</span>
              </button>
              <small>{formatInteger(group.keywordCount)}</small>
              <button
                aria-label={`Действия с группой ${group.name}`}
                className="semantic-group-more"
                onClick={(event) =>
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    group
                  })
                }
                type="button"
              >
                ⋮
              </button>
            </div>
          );
        })}
      </div>
      <p className="semantic-group-hint">
        Ctrl/Cmd+клик — выбрать несколько · перетащите для переноса
      </p>
      {contextMenu && (
        <ContextMenu
          items={contextItems}
          label={`Действия с группой ${contextMenu.group.name}`}
          onClose={() => setContextMenu(undefined)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}
    </nav>
  );
}

function flattenGroups(
  groups: readonly SemanticGroupTreeItem[],
  expandedIds: ReadonlySet<string>,
  search: string
): readonly FlatGroup[] {
  const normalizedSearch = search.normalize("NFKC").trim().toLocaleLowerCase("ru");
  const byParent = new Map<string | undefined, SemanticGroupTreeItem[]>();
  for (const group of groups) {
    const bucket = byParent.get(group.parentId) ?? [];
    bucket.push(group);
    byParent.set(group.parentId, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }
  const result: FlatGroup[] = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const group of byParent.get(parentId) ?? []) {
      const children = byParent.get(group.id) ?? [];
      const visible =
        !normalizedSearch ||
        group.path.normalize("NFKC").toLocaleLowerCase("ru").includes(normalizedSearch);
      if (visible) result.push({ group, depth, hasChildren: children.length > 0 });
      if (children.length > 0 && (expandedIds.has(group.id) || normalizedSearch)) {
        walk(group.id, depth + 1);
      }
    }
  };
  walk(undefined, 0);
  return result;
}

function toggleId(
  current: ReadonlySet<string>,
  id: string
): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function draggedKeywordIds(event: DragEvent): readonly string[] {
  const value = event.dataTransfer.getData("application/x-seo-keyword-ids");
  return value ? [...new Set(value.split(",").filter(Boolean))] : [];
}
