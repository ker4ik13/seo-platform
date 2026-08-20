"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import {
  semanticGroupDropPlacement,
  type SemanticGroupDropPlacement
} from "../lib/semantic-group-drag";
import { semanticGroupColors } from "../lib/semantic-group-colors";
import { ContextMenu, type ContextMenuItem } from "./context-menu";
import { Icon } from "./icon";

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

export interface SemanticGroupRemotePresence {
  readonly userId: string;
  readonly displayName: string;
  readonly colorIndex: number;
  readonly groupIds: readonly string[];
}

interface FlatGroup {
  readonly group: SemanticGroupTreeItem;
  readonly depth: number;
  readonly hasChildren: boolean;
}

const EMPTY_GROUP_IDS: readonly string[] = [];
const EMPTY_REMOTE_PRESENCE: readonly SemanticGroupRemotePresence[] = [];
const ROOT_PRESENCE_KEY = "root";
export type SemanticGroupTreeDropTarget =
  | Readonly<{ placement: "root" }>
  | Readonly<{
      group: SemanticGroupTreeItem;
      placement: SemanticGroupDropPlacement;
    }>;

export function SemanticGroupTree({
  activeGroupId,
  activeGroupIds = EMPTY_GROUP_IDS,
  expandedIds,
  groups,
  onCreate,
  onDelete,
  onExport,
  onColorChange,
  onDropMove,
  onMoveRequest,
  onOpenSelection,
  onReorder,
  onKeywordDrop,
  onRename,
  onSelect,
  onExpandedIdsChange,
  remotePresence = EMPTY_REMOTE_PRESENCE,
  total
}: Readonly<{
  activeGroupId?: string;
  activeGroupIds?: readonly string[];
  expandedIds: ReadonlySet<string> | null;
  groups: readonly SemanticGroupTreeItem[];
  onCreate: (parentId?: string) => void;
  onDelete: (groups: readonly SemanticGroupTreeItem[]) => void;
  onExport: (group: SemanticGroupTreeItem) => void;
  onColorChange: (
    groups: readonly SemanticGroupTreeItem[],
    color: string
  ) => void;
  onDropMove: (
    groups: readonly SemanticGroupTreeItem[],
    target: SemanticGroupTreeDropTarget
  ) => void;
  onMoveRequest: (groups: readonly SemanticGroupTreeItem[]) => void;
  onOpenSelection: (groupIds: readonly string[]) => void;
  onReorder: (group: SemanticGroupTreeItem, position: number) => void;
  onKeywordDrop: (keywordIds: readonly string[], targetId?: string) => void;
  onRename: (group: SemanticGroupTreeItem) => void;
  onSelect: (groupId?: string) => void;
  onExpandedIdsChange: (expandedIds: ReadonlySet<string>) => void;
  remotePresence?: readonly SemanticGroupRemotePresence[];
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
  const hadActiveMultiGroupRef = useRef(false);
  const activeGroupIdSet = useMemo(
    () => new Set(activeGroupIds),
    [activeGroupIds]
  );
  const selectableActiveGroupId = useMemo(
    () =>
      activeGroupId &&
      groups.some(({ id, systemKind }) => id === activeGroupId && !systemKind)
        ? activeGroupId
        : undefined,
    [activeGroupId, groups]
  );
  const effectiveSelectedIds = useMemo(() => {
    const next = new Set(selectedIds);
    if (selectableActiveGroupId) next.add(selectableActiveGroupId);
    return next;
  }, [selectableActiveGroupId, selectedIds]);
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
  const remotePresenceByGroupId = useMemo(() => {
    const result = new Map<string, SemanticGroupRemotePresence[]>();
    for (const participant of remotePresence) {
      const groupIds =
        participant.groupIds.length > 0
          ? participant.groupIds
          : [ROOT_PRESENCE_KEY];
      for (const groupId of groupIds) {
        const current = result.get(groupId) ?? [];
        current.push(participant);
        result.set(groupId, current);
      }
    }
    return result;
  }, [remotePresence]);
  useEffect(() => {
    const clearDragTarget = () => setDragTarget(undefined);
    document.addEventListener("dragend", clearDragTarget);
    return () => document.removeEventListener("dragend", clearDragTarget);
  }, []);
  useEffect(() => {
    if (activeGroupIds.length > 1) {
      hadActiveMultiGroupRef.current = true;
      setSelectedIds(new Set(activeGroupIds));
    } else if (hadActiveMultiGroupRef.current) {
      hadActiveMultiGroupRef.current = false;
      setSelectedIds(new Set());
    }
  }, [activeGroupIds]);
  const selectedGroups = groups.filter(
    ({ id, systemKind }) => !systemKind && effectiveSelectedIds.has(id)
  );

  function chooseGroup(
    event: MouseEvent,
    group: SemanticGroupTreeItem
  ): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (selectableActiveGroupId) next.add(selectableActiveGroupId);
        if (next.has(group.id)) next.delete(group.id);
        else next.add(group.id);
        return next;
      });
      return;
    }
    setSelectedIds(new Set());
    onSelect(group.id);
  }

  function openContextMenu(
    event: MouseEvent,
    group: SemanticGroupTreeItem
  ): void {
    event.preventDefault();
    if (!effectiveSelectedIds.has(group.id)) {
      setSelectedIds(new Set());
      onSelect(group.id);
    }
    setContextMenu({ x: event.clientX, y: event.clientY, group });
  }

  function startDrag(
    event: DragEvent,
    group: SemanticGroupTreeItem
  ): void {
    const ids = effectiveSelectedIds.has(group.id)
      ? [...effectiveSelectedIds]
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
    ? effectiveSelectedIds.has(contextMenu.group.id) && selectedGroups.length > 0
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
            icon: <Icon name={contextMenu.group.systemKind === "TRASH" ? "trash" : "inbox"} />,
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
          icon: <Icon name="folderPlus" />,
          label: "Создать подгруппу",
          onSelect: () => onCreate(contextMenu.group.id)
        },
        {
          id: "rename",
          icon: <Icon name="edit" />,
          label: "Переименовать",
          disabled: contextGroups.length !== 1,
          onSelect: () => onRename(contextMenu.group)
        },
        {
          id: "move",
          icon: <Icon name="move" />,
          label:
            contextGroups.length > 1
              ? `Переместить группы (${contextGroups.length})…`
              : "Переместить…",
          onSelect: () => onMoveRequest(contextGroups)
        },
        {
          id: "move-up",
          icon: <Icon name="arrowUp" />,
          label: "Поднять выше",
          disabled: contextGroups.length !== 1 || contextIndex <= 0,
          onSelect: () => onReorder(contextMenu.group, contextIndex - 1)
        },
        {
          id: "move-down",
          icon: <Icon name="arrowDown" />,
          label: "Опустить ниже",
          disabled:
            contextGroups.length !== 1 ||
            contextIndex < 0 ||
            contextIndex >= contextSiblings.length - 1,
          onSelect: () => onReorder(contextMenu.group, contextIndex + 1)
        },
        {
          id: "export",
          icon: <Icon name="export" />,
          label: "Экспортировать группу",
          disabled: contextGroups.length !== 1,
          onSelect: () => onExport(contextMenu.group)
        },
        {
          id: "delete",
          icon: <Icon name="trash" />,
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
    const selected = effectiveSelectedIds.has(group.id);
    const groupPresence = remotePresenceByGroupId.get(group.id) ?? [];
    const primaryPresence = groupPresence[0];
    return (
      <div
        className={`semantic-group-tree-row${depth === 0 && !group.systemKind ? " top-level" : ""}${activeGroupId === group.id || activeGroupIdSet.has(group.id) ? " active" : ""}${selected ? " selected" : ""}${group.systemKind ? ` system ${group.systemKind.toLowerCase()}` : ""}${primaryPresence ? ` remote-presence presence-color-${primaryPresence.colorIndex}` : ""}${dragTarget && "group" in dragTarget && dragTarget.group.id === group.id ? ` drag-${dragTarget.placement}` : ""}`}
        data-presence-key={`semantic-group:${group.id}`}
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
              <Icon name={group.systemKind === "TRASH" ? "trash" : "inbox"} />
            </span>
          )}
          <span>{group.name}</span>
        </button>
        <RemotePresenceDots participants={groupPresence} />
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
          {selectedGroups.length > 0 && <span>{selectedGroups.length}</span>}
          <button
            aria-label="Открыть выбранные группы вместе"
            className="semantic-group-multi-open"
            disabled={selectedGroups.length < 2}
            onClick={() =>
              onOpenSelection(selectedGroups.map(({ id }) => id).sort())
            }
            title={
              selectedGroups.length < 2
                ? "Выберите минимум две группы с Ctrl/Cmd или Shift"
                : `Открыть вместе: ${selectedGroups.length}`
            }
            type="button"
          >
            <Icon name="multiGroup" />
          </button>
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
        className={`semantic-group-root${remotePresenceByGroupId.has(ROOT_PRESENCE_KEY) ? ` remote-presence presence-color-${remotePresenceByGroupId.get(ROOT_PRESENCE_KEY)?.[0]?.colorIndex ?? 0}` : ""}${dragTarget?.placement === "root" ? " drag-target" : ""}`}
        data-presence-key="semantic-group:root"
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
        <Icon aria-hidden="true" name="list" />
        <strong>Все запросы</strong>
        <RemotePresenceDots
          participants={remotePresenceByGroupId.get(ROOT_PRESENCE_KEY) ?? []}
        />
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
          afterItemId="export"
          items={contextItems}
          label={`Действия с группой ${contextMenu.group.name}`}
          onClose={() => setContextMenu(undefined)}
          x={contextMenu.x}
          y={contextMenu.y}
        >
          {!contextMenu.group.systemKind && (
            <div
              aria-label={
                contextGroups.length > 1
                  ? `Цвет выбранных групп: ${contextGroups.length}`
                  : "Цвет группы"
              }
              className="semantic-group-color-palette"
              role="group"
            >
              {semanticGroupColors.map(({ value, label }) => (
                <button
                  aria-label={label}
                  aria-pressed={contextGroups.every(
                    (group) => (group.color ?? "#a8a5b8").toLowerCase() === value
                  )}
                  key={value}
                  onClick={() => {
                    onColorChange(contextGroups, value);
                    setContextMenu(undefined);
                  }}
                  style={{ backgroundColor: value }}
                  title={label}
                  type="button"
                />
              ))}
            </div>
          )}
        </ContextMenu>
      )}
    </nav>
  );
}

function RemotePresenceDots({
  participants
}: Readonly<{
  participants: readonly SemanticGroupRemotePresence[];
}>) {
  if (participants.length === 0) return null;
  const names = participants.map(({ displayName }) => displayName).join(", ");
  return (
    <span
      aria-label={`Сейчас здесь: ${names}`}
      className="semantic-group-remote-presence"
      title={`Сейчас здесь: ${names}`}
    >
      {participants.slice(0, 3).map((participant) => (
        <i
          className={`presence-color-${participant.colorIndex}`}
          key={participant.userId}
        />
      ))}
      {participants.length > 3 && <b>+{participants.length - 3}</b>}
    </span>
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
