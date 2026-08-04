"use client";

import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import {
  semanticGroupDropPlacement,
  type SemanticGroupDropPlacement
} from "../lib/semantic-group-drag";
import { ContextMenu, type ContextMenuItem } from "./context-menu";

export interface SemanticGroupTreeItem {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly color?: string;
  readonly position: number;
  readonly keywordCount: number;
  readonly systemKind?: "UNGROUPED" | "TRASH";
  readonly version: number;
}

interface FlatGroup {
  readonly group: SemanticGroupTreeItem;
  readonly depth: number;
  readonly hasChildren: boolean;
}

export type SemanticGroupTreeDropTarget =
  | Readonly<{ placement: "root" }>
  | Readonly<{
      group: SemanticGroupTreeItem;
      placement: SemanticGroupDropPlacement;
    }>;

export function SemanticGroupTree({
  activeGroupId,
  expandedIds,
  groups,
  onCreate,
  onDelete,
  onExport,
  onDropMove,
  onMoveRequest,
  onReorder,
  onKeywordDrop,
  onRename,
  onSelect,
  onExpandedIdsChange,
  total
}: Readonly<{
  activeGroupId?: string;
  expandedIds: ReadonlySet<string> | null;
  groups: readonly SemanticGroupTreeItem[];
  onCreate: (parentId?: string) => void;
  onDelete: (groups: readonly SemanticGroupTreeItem[]) => void;
  onExport: (group: SemanticGroupTreeItem) => void;
  onDropMove: (
    groups: readonly SemanticGroupTreeItem[],
    target: SemanticGroupTreeDropTarget
  ) => void;
  onMoveRequest: (groups: readonly SemanticGroupTreeItem[]) => void;
  onReorder: (group: SemanticGroupTreeItem, position: number) => void;
  onKeywordDrop: (keywordIds: readonly string[], targetId?: string) => void;
  onRename: (group: SemanticGroupTreeItem) => void;
  onSelect: (groupId?: string) => void;
  onExpandedIdsChange: (expandedIds: ReadonlySet<string>) => void;
  total?: number;
}>) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [draggingIds, setDraggingIds] = useState<readonly string[]>([]);
  const [dragTarget, setDragTarget] = useState<SemanticGroupTreeDropTarget>();
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<Readonly<{
    x: number;
    y: number;
    group: SemanticGroupTreeItem;
  }>>();
  const effectiveExpandedIds = useMemo<ReadonlySet<string>>(
    () =>
      expandedIds ??
      new Set(
        groups
          .filter(({ systemKind }) => !systemKind)
          .map(({ id }) => id)
      ),
    [expandedIds, groups]
  );
  const flatGroups = useMemo(
    () =>
      flattenGroups(
        groups.filter(({ systemKind }) => !systemKind),
        effectiveExpandedIds,
        search
      ),
    [effectiveExpandedIds, groups, search]
  );
  const systemGroups = useMemo(() => {
    const normalizedSearch = normalizeGroupSearch(search);
    return groups
      .filter(
        (group) =>
          group.systemKind &&
          (!normalizedSearch ||
            group.name
              .normalize("NFKC")
              .toLocaleLowerCase("ru")
              .includes(normalizedSearch))
      )
      .sort(
        (left, right) =>
          systemGroupOrder(left.systemKind) - systemGroupOrder(right.systemKind)
      );
  }, [groups, search]);
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

  function drop(target: SemanticGroupTreeDropTarget): void {
    const moving = groups.filter(({ id }) => draggingIds.includes(id));
    setDraggingIds([]);
    setDragTarget(undefined);
    if (
      moving.length === 0 ||
      ("group" in target && moving.some(({ id }) => id === target.group.id))
    ) return;
    onDropMove(moving, target);
  }

  const contextGroups = contextMenu
    ? selectedIds.has(contextMenu.group.id) && selectedGroups.length > 0
      ? selectedGroups
      : [contextMenu.group]
    : [];
  const contextSiblings = contextMenu
    ? groups
        .filter(({ parentId }) => parentId === contextMenu.group.parentId)
        .sort(compareGroupPosition)
    : [];
  const contextIndex = contextMenu
    ? contextSiblings.findIndex(({ id }) => id === contextMenu.group.id)
    : -1;
  const contextItems: readonly ContextMenuItem[] = contextMenu
    ? contextMenu.group.systemKind
      ? [
          {
            id: "open-system-group",
            label:
              contextMenu.group.systemKind === "TRASH"
                ? "Открыть корзину"
                : "Открыть без группы",
            onSelect: () => onSelect(contextMenu.group.id)
          }
        ]
      : [
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
          onSelect: () => onMoveRequest(contextGroups)
        },
        {
          id: "move-up",
          label: "Поднять выше",
          disabled: contextGroups.length !== 1 || contextIndex <= 0,
          onSelect: () => onReorder(contextMenu.group, contextIndex - 1)
        },
        {
          id: "move-down",
          label: "Опустить ниже",
          disabled:
            contextGroups.length !== 1 ||
            contextIndex < 0 ||
            contextIndex >= contextSiblings.length - 1,
          onSelect: () => onReorder(contextMenu.group, contextIndex + 1)
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

  function renderGroupRow({
    depth,
    group,
    hasChildren
  }: FlatGroup) {
    const selected = selectedIds.has(group.id);
    return (
      <div
        className={`semantic-group-tree-row${activeGroupId === group.id ? " active" : ""}${selected ? " selected" : ""}${group.systemKind ? ` system ${group.systemKind.toLowerCase()}` : ""}${dragTarget && "group" in dragTarget && dragTarget.group.id === group.id ? ` drag-${dragTarget.placement}` : ""}`}
        draggable={!group.systemKind}
        key={group.id}
        onContextMenu={(event) => openContextMenu(event, group)}
        onDragEnd={() => {
          setDraggingIds([]);
          setDragTarget(undefined);
        }}
        onDragStart={(event) => startDrag(event, group)}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (group.systemKind === "TRASH") return;
          setDragTarget({
            group,
            placement: semanticGroupDropPlacement(
              event.clientY,
              event.currentTarget.getBoundingClientRect().top,
              event.currentTarget.getBoundingClientRect().height
            )
          });
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const keywordIds = draggedKeywordIds(event);
          if (keywordIds.length > 0) {
            if (group.systemKind === "TRASH") return;
            onKeywordDrop(keywordIds, group.id);
            setDragTarget(undefined);
            return;
          }
          if (group.systemKind) return;
          const placement = semanticGroupDropPlacement(
            event.clientY,
            event.currentTarget.getBoundingClientRect().top,
            event.currentTarget.getBoundingClientRect().height
          );
          drop({ group, placement });
        }}
        style={{
          minWidth: `${180 + depth * 10}px`,
          paddingLeft: `${4 + depth * 10}px`
        }}
      >
        <button
          aria-label={
            hasChildren
              ? effectiveExpandedIds.has(group.id)
                ? `Свернуть ${group.name}`
                : `Развернуть ${group.name}`
              : undefined
          }
          className="semantic-group-toggle"
          disabled={!hasChildren}
          onClick={() =>
            onExpandedIdsChange(toggleId(effectiveExpandedIds, group.id))
          }
          type="button"
        >
          {hasChildren && (
            <svg
              aria-hidden="true"
              className={effectiveExpandedIds.has(group.id) ? undefined : "collapsed"}
              viewBox="0 0 20 20"
            >
              <path d="m5.5 7.5 4.5 4.5 4.5-4.5 1.4 1.4-5.9 5.9-5.9-5.9 1.4-1.4Z" />
            </svg>
          )}
        </button>
        <button
          className="semantic-group-name"
          onClick={(event) => chooseGroup(event, group)}
          title={`${group.path}. Ctrl/Cmd+клик — множественный выбор`}
          type="button"
        >
          <i style={{ background: group.color ?? "#a8a5b8" }} />
          {group.systemKind && (
            <span aria-hidden="true" className="semantic-system-group-icon">
              {group.systemKind === "TRASH" ? "⌫" : "∅"}
            </span>
          )}
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
  }

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
        className={`semantic-group-root${dragTarget?.placement === "root" ? " drag-target" : ""}`}
        onClick={() => {
          setSelectedIds(new Set());
          onSelect();
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragTarget({ placement: "root" });
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
          drop({ placement: "root" });
        }}
        type="button"
      >
        <span aria-hidden="true">▤</span>
        <strong>Все запросы</strong>
        <small>{total === undefined ? "—" : formatInteger(total)}</small>
      </button>
      <div
        className={`semantic-group-tree-list${dragTarget?.placement === "root" ? " root-drop-target" : ""}`}
        onDragOver={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          setDragTarget({ placement: "root" });
        }}
        onDrop={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          const keywordIds = draggedKeywordIds(event);
          if (keywordIds.length > 0) {
            onKeywordDrop(keywordIds);
            setDragTarget(undefined);
            return;
          }
          drop({ placement: "root" });
        }}
      >
        {flatGroups.map(renderGroupRow)}
      </div>
      {systemGroups.length > 0 && (
        <div className="semantic-system-groups">
          {systemGroups.map((group) =>
            renderGroupRow({ group, depth: 0, hasChildren: false })
          )}
        </div>
      )}
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
  const normalizedSearch = normalizeGroupSearch(search);
  const byParent = new Map<string | undefined, SemanticGroupTreeItem[]>();
  for (const group of groups) {
    const bucket = byParent.get(group.parentId) ?? [];
    bucket.push(group);
    byParent.set(group.parentId, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort(compareGroupPosition);
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

function normalizeGroupSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ru");
}

function systemGroupOrder(kind: SemanticGroupTreeItem["systemKind"]): number {
  if (kind === "UNGROUPED") return 0;
  if (kind === "TRASH") return 1;
  return 2;
}

function compareGroupPosition(
  left: SemanticGroupTreeItem,
  right: SemanticGroupTreeItem
): number {
  return left.position - right.position || left.id.localeCompare(right.id);
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
