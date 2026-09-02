"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import { createPortal } from "react-dom";
import type { SemanticGroupColorLegend } from "@seo-platform/contracts";
import {
  semanticGroupCanonicalDropTarget,
  type SemanticGroupDropPlacement
} from "../lib/semantic-group-drag";
import { semanticGroupColors } from "../lib/semantic-group-colors";
import { normalizeSemanticGroupName } from "../lib/semantic-group-name-batch";
import {
  semanticAllRegularGroupIds,
  semanticGroupIdsWithDescendants,
  semanticGroupRangeSelection,
  semanticVisiblePresenceGroupId
} from "../lib/semantic-group-selection";
import { ContextMenu, type ContextMenuItem } from "./context-menu";
import { Icon } from "./icon";
import { SemanticGroupColorLegendControl } from "./semantic-group-color-legend";

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

interface SemanticGroupDragFeedback {
  readonly x: number;
  readonly y: number;
  readonly kind: "group" | "keyword";
}

const EMPTY_GROUP_IDS: readonly string[] = [];
const EMPTY_REMOTE_PRESENCE: readonly SemanticGroupRemotePresence[] = [];
const KEYWORD_DRAG_TYPE = "application/x-seo-keyword-ids";
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
  onDuplicate,
  onExport,
  onColorChange,
  onDropMove,
  onInlineRename,
  onMoveRequest,
  onOpenSelection,
  onReorder,
  onKeywordDrop,
  onRename,
  onSelect,
  onExpandedIdsChange,
  projectId,
  refreshVersion,
  remotePresence = EMPTY_REMOTE_PRESENCE,
  total
}: Readonly<{
  activeGroupId?: string;
  activeGroupIds?: readonly string[];
  expandedIds: ReadonlySet<string> | null;
  groups: readonly SemanticGroupTreeItem[];
  onCreate: (parentId?: string, position?: number) => void;
  onDelete: (groups: readonly SemanticGroupTreeItem[]) => void;
  onDuplicate: (group: SemanticGroupTreeItem) => void;
  onExport: (group: SemanticGroupTreeItem) => void;
  onColorChange: (
    groups: readonly SemanticGroupTreeItem[],
    color: string
  ) => void;
  onDropMove: (
    groups: readonly SemanticGroupTreeItem[],
    target: SemanticGroupTreeDropTarget
  ) => void;
  onInlineRename: (
    group: SemanticGroupTreeItem,
    name: string
  ) => Promise<boolean>;
  onMoveRequest: (groups: readonly SemanticGroupTreeItem[]) => void;
  onOpenSelection: (groupIds: readonly string[]) => void;
  onReorder: (group: SemanticGroupTreeItem, position: number) => void;
  onKeywordDrop: (keywordIds: readonly string[], targetId?: string) => void;
  onRename: (group: SemanticGroupTreeItem) => void;
  onSelect: (groupId?: string) => void;
  onExpandedIdsChange: (expandedIds: ReadonlySet<string>) => void;
  projectId: string;
  refreshVersion: number;
  remotePresence?: readonly SemanticGroupRemotePresence[];
  total?: number;
}>) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [draggingIds, setDraggingIds] = useState<readonly string[]>([]);
  const [dragTarget, setDragTarget] = useState<SemanticGroupTreeDropTarget>();
  const [dragFeedback, setDragFeedback] = useState<SemanticGroupDragFeedback>();
  const dragTargetRef = useRef<SemanticGroupTreeDropTarget | undefined>(
    undefined
  );
  const [search, setSearch] = useState("");
  const [colorLegend, setColorLegend] = useState<SemanticGroupColorLegend>();
  const [contextMenu, setContextMenu] = useState<Readonly<{
    x: number;
    y: number;
    group: SemanticGroupTreeItem;
  }>>();
  const [inlineRename, setInlineRename] = useState<Readonly<{
    groupId: string;
    value: string;
    saving: boolean;
    error?: string;
  }>>();
  const hadActiveMultiGroupRef = useRef(false);
  const inlineRenameCancelIdRef = useRef<string | undefined>(undefined);
  const inlineRenameCommitIdRef = useRef<string | undefined>(undefined);
  const inlineRenameInputRef = useRef<HTMLInputElement>(null);
  const selectionAnchorIdRef = useRef<string | undefined>(undefined);
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
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group] as const)),
    [groups]
  );
  const dragTargetLabel = dragFeedback && dragTarget
    ? semanticGroupDragTargetLabel(dragTarget, dragFeedback.kind, groupById)
    : undefined;
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
    const visibleGroupIds = flatGroups.map(({ group }) => group.id);
    for (const participant of remotePresence) {
      const groupId = participant.groupIds.length > 0
        ? semanticVisiblePresenceGroupId(
            participant.groupIds,
            groups,
            visibleGroupIds
          )
        : ROOT_PRESENCE_KEY;
      if (!groupId) continue;
      const current = result.get(groupId) ?? [];
      current.push(participant);
      result.set(groupId, current);
    }
    return result;
  }, [flatGroups, groups, remotePresence]);
  useEffect(() => {
    const clearDragTarget = () => {
      dragTargetRef.current = undefined;
      setDragTarget(undefined);
      setDragFeedback(undefined);
    };
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

  function updateDragTarget(
    target: SemanticGroupTreeDropTarget | undefined,
    feedback?: SemanticGroupDragFeedback
  ): void {
    dragTargetRef.current = target;
    setDragTarget(target);
    if (!target) setDragFeedback(undefined);
    else if (feedback) setDragFeedback(feedback);
  }

  function startInlineRename(
    event: MouseEvent,
    group: SemanticGroupTreeItem
  ): void {
    if (group.systemKind) return;
    event.preventDefault();
    event.stopPropagation();
    inlineRenameCancelIdRef.current = undefined;
    setContextMenu(undefined);
    setInlineRename({
      groupId: group.id,
      value: group.name,
      saving: false
    });
    requestAnimationFrame(() => {
      inlineRenameInputRef.current?.focus();
      inlineRenameInputRef.current?.select();
    });
  }

  async function commitInlineRename(
    group: SemanticGroupTreeItem
  ): Promise<void> {
    const current = inlineRename;
    if (
      !current ||
      current.groupId !== group.id ||
      current.saving ||
      inlineRenameCommitIdRef.current
    ) {
      return;
    }
    let name: string;
    try {
      name = normalizeSemanticGroupName(current.value);
    } catch (error) {
      setInlineRename({
        ...current,
        error: error instanceof Error
          ? error.message
          : "Проверьте название папки."
      });
      requestAnimationFrame(() => inlineRenameInputRef.current?.focus());
      return;
    }
    if (name === group.name) {
      setInlineRename(undefined);
      return;
    }

    inlineRenameCommitIdRef.current = group.id;
    setInlineRename({
      groupId: group.id,
      value: name,
      saving: true
    });
    let saved = false;
    try {
      saved = await onInlineRename(group, name);
    } catch {
      saved = false;
    } finally {
      inlineRenameCommitIdRef.current = undefined;
    }
    if (saved) {
      setInlineRename((latest) =>
        latest?.groupId === group.id ? undefined : latest
      );
      return;
    }
    setInlineRename((latest) =>
      latest?.groupId === group.id
        ? {
            ...latest,
            saving: false,
            error: "Не удалось сохранить название. Повторите попытку."
          }
        : latest
    );
    requestAnimationFrame(() => inlineRenameInputRef.current?.focus());
  }

  function chooseGroup(
    event: MouseEvent,
    group: SemanticGroupTreeItem
  ): void {
    if (event.shiftKey) {
      const visibleIds = flatGroups.map(({ group: item }) => item.id);
      const anchorId =
        selectionAnchorIdRef.current ?? selectableActiveGroupId ?? group.id;
      const range = semanticGroupRangeSelection(
        visibleIds,
        anchorId,
        group.id
      );
      if (range) {
        setSelectedIds(range);
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      selectionAnchorIdRef.current = group.id;
      setSelectedIds((current) => {
        const next = new Set(current);
        if (selectableActiveGroupId) next.add(selectableActiveGroupId);
        if (next.has(group.id)) next.delete(group.id);
        else next.add(group.id);
        return next;
      });
      return;
    }
    selectionAnchorIdRef.current = group.id;
    setSelectedIds(new Set());
    onSelect(group.id);
  }

  function handleTreeKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.key.toLocaleLowerCase("en") !== "a" ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const allGroupIds = semanticAllRegularGroupIds(groups);
    setSelectedIds(new Set(allGroupIds));
    selectionAnchorIdRef.current ??= selectableActiveGroupId ?? allGroupIds[0];
  }

  function openContextMenu(
    event: MouseEvent,
    group: SemanticGroupTreeItem
  ): void {
    event.preventDefault();
    if (!effectiveSelectedIds.has(group.id)) {
      setSelectedIds(new Set());
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
    updateDragTarget(undefined);
    if (
      moving.length === 0 ||
      ("group" in target &&
        moving.some(
          ({ id, path }) =>
            id === target.group.id ||
            target.group.path.startsWith(`${path} / `)
        ))
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
        .filter(
          ({ parentId, systemKind }) =>
            !systemKind && parentId === contextMenu.group.parentId
        )
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
          label: "Создать внутри…",
          onSelect: () => onCreate(contextMenu.group.id)
        },
        {
          id: "create-sibling",
          icon: <Icon name="folderPlus" />,
          label: "Создать рядом…",
          onSelect: () =>
            onCreate(contextMenu.group.parentId, contextIndex + 1)
        },
        {
          id: "duplicate",
          icon: <Icon name="copy" />,
          label: "Дублировать…",
          disabled: contextGroups.length !== 1,
          onSelect: () => onDuplicate(contextMenu.group)
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
          inlineGroup: "order",
          label: "Выше",
          disabled: contextGroups.length !== 1 || contextIndex <= 0,
          onSelect: () => onReorder(contextMenu.group, contextIndex - 1)
        },
        {
          id: "move-down",
          icon: <Icon name="arrowDown" />,
          inlineGroup: "order",
          label: "Ниже",
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
  const contextColorNote = contextMenu && !contextMenu.group.systemKind
    ? colorLegend?.entries.find(
        ({ color }) =>
          color === (contextMenu.group.color ?? "#a8a5b8").toLowerCase()
      )?.note
    : undefined;

  function renderGroupRow({
    depth,
    group,
    hasChildren
  }: FlatGroup, flatIndex?: number) {
    const selected = effectiveSelectedIds.has(group.id);
    const groupPresence = remotePresenceByGroupId.get(group.id) ?? [];
    const primaryPresence = groupPresence[0];
    const nextVisibleRow = flatIndex === undefined
      ? undefined
      : flatGroups[flatIndex + 1];
    const rowDragPlacement =
      dragTarget && "group" in dragTarget && dragTarget.group.id === group.id
        ? dragTarget.placement
        : undefined;
    return (
      <div
        className={`semantic-group-tree-row${depth === 0 && !group.systemKind ? " top-level" : ""}${activeGroupId === group.id || activeGroupIdSet.has(group.id) ? " active" : ""}${selected ? " selected" : ""}${group.systemKind ? ` system ${group.systemKind.toLowerCase()}` : ""}${primaryPresence ? ` remote-presence presence-color-${primaryPresence.colorIndex}` : ""}${rowDragPlacement ? ` drag-${rowDragPlacement}` : ""}`}
        data-presence-cursor-anchor="true"
        data-presence-key={`semantic-group:${group.id}`}
        draggable={!group.systemKind && inlineRename?.groupId !== group.id}
        key={group.id}
        onContextMenu={(event) => openContextMenu(event, group)}
        onDragEnd={() => {
          setDraggingIds([]);
          updateDragTarget(undefined);
        }}
        onDragStart={(event) => startDrag(event, group)}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const feedback = dragFeedbackFromEvent(event);
          if (group.systemKind) {
            updateDragTarget(
              feedback.kind === "keyword" && group.systemKind !== "TRASH"
                ? { group, placement: "inside" }
                : undefined,
              feedback
            );
            return;
          }
          const row = event.currentTarget.getBoundingClientRect();
          updateDragTarget(
            feedback.kind === "keyword"
              ? { group, placement: "inside" }
              : semanticGroupCanonicalDropTarget(
                  event.clientY,
                  row.top,
                  row.height,
                  { group, depth },
                  nextVisibleRow
                ),
            feedback
          );
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const keywordIds = draggedKeywordIds(event);
          if (keywordIds.length > 0) {
            if (group.systemKind === "TRASH") {
              updateDragTarget(undefined);
              return;
            }
            onKeywordDrop(keywordIds, group.id);
            updateDragTarget(undefined);
            return;
          }
          if (group.systemKind) {
            updateDragTarget(undefined);
            return;
          }
          const row = event.currentTarget.getBoundingClientRect();
          drop(
            dragTargetRef.current ??
              semanticGroupCanonicalDropTarget(
                event.clientY,
                row.top,
                row.height,
                { group, depth },
                nextVisibleRow
              )
          );
        }}
        style={{
          "--semantic-group-drop-inset": `${5 + depth * 10}px`,
          minWidth: `${180 + depth * 10}px`,
          paddingLeft: `${4 + depth * 10}px`
        } as CSSProperties}
      >
        {depth > 0 && (
          <span
            aria-hidden="true"
            className="semantic-group-depth-guides"
            style={{ width: `${depth * 10}px` }}
          />
        )}
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
        {inlineRename?.groupId === group.id ? (
          <div className="semantic-group-name semantic-group-name-editing">
            <i style={{ background: group.color ?? "#a8a5b8" }} />
            <input
              aria-label={`Новое название папки ${group.name}`}
              aria-invalid={inlineRename.error ? "true" : undefined}
              autoFocus
              disabled={inlineRename.saving}
              maxLength={255}
              onBlur={() => {
                if (inlineRenameCancelIdRef.current === group.id) {
                  inlineRenameCancelIdRef.current = undefined;
                  return;
                }
                void commitInlineRename(group);
              }}
              onChange={(event) =>
                setInlineRename({
                  groupId: group.id,
                  value: event.target.value,
                  saving: false
                })
              }
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  inlineRenameCancelIdRef.current = group.id;
                  setInlineRename(undefined);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitInlineRename(group);
                }
              }}
              onMouseDown={(event) => event.stopPropagation()}
              ref={inlineRenameInputRef}
              spellCheck={false}
              title={inlineRename.error}
              value={inlineRename.value}
            />
          </div>
        ) : (
          <button
            className="semantic-group-name"
            onClick={(event) => chooseGroup(event, group)}
            onDoubleClick={group.systemKind
              ? undefined
              : (event) => startInlineRename(event, group)}
            title={group.systemKind
              ? group.path
              : `${group.path}. Двойной клик — переименовать; Ctrl/Cmd+клик — множественный выбор`}
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
        )}
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
    <nav
      aria-label="Группы семантического ядра"
      className="semantic-group-tree"
      data-presence-cursor-anchor="true"
      data-presence-key="semantic-groups"
      onKeyDown={handleTreeKeyDown}
    >
      <header>
        <div className="semantic-group-tree-heading">
          <strong>Группы</strong>
          <SemanticGroupColorLegendControl
            onLegendChange={setColorLegend}
            projectId={projectId}
            refreshVersion={refreshVersion}
          />
        </div>
        <div>
          {selectedGroups.length > 0 && <span>{selectedGroups.length}</span>}
          <button
            aria-label="Выбрать вложенные группы"
            className="semantic-group-descendants"
            disabled={selectedGroups.length === 0}
            onClick={() => {
              const ids = semanticGroupIdsWithDescendants(
                groups,
                selectedGroups.map(({ id }) => id)
              );
              setSelectedIds(new Set(ids));
              selectionAnchorIdRef.current ??= ids[0];
            }}
            title={
              selectedGroups.length === 0
                ? "Сначала выберите группу"
                : "Добавить к выбору все вложенные группы"
            }
            type="button"
          >
            <Icon name="checkDouble" />
          </button>
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
        {search && (
          <button
            aria-label="Очистить поиск по группам"
            onClick={() => setSearch("")}
            title="Очистить"
            type="button"
          >
            <Icon name="close" />
          </button>
        )}
      </label>
      <button
        aria-current={!activeGroupId ? "true" : undefined}
        className={`semantic-group-root${remotePresenceByGroupId.has(ROOT_PRESENCE_KEY) ? ` remote-presence presence-color-${remotePresenceByGroupId.get(ROOT_PRESENCE_KEY)?.[0]?.colorIndex ?? 0}` : ""}${dragTarget?.placement === "root" ? " drag-target" : ""}`}
        data-presence-cursor-anchor="true"
        data-presence-key="semantic-group:root"
        onClick={() => {
          selectionAnchorIdRef.current = undefined;
          setSelectedIds(new Set());
          onSelect();
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          updateDragTarget(
            { placement: "root" },
            dragFeedbackFromEvent(event)
          );
        }}
        onDragOver={(event) => {
          event.preventDefault();
          updateDragTarget(
            { placement: "root" },
            dragFeedbackFromEvent(event)
          );
        }}
        onDrop={(event) => {
          event.preventDefault();
          const keywordIds = draggedKeywordIds(event);
          if (keywordIds.length > 0) {
            onKeywordDrop(keywordIds);
            updateDragTarget(undefined);
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
          updateDragTarget(
            { placement: "root" },
            dragFeedbackFromEvent(event)
          );
        }}
        onDrop={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          const keywordIds = draggedKeywordIds(event);
          if (keywordIds.length > 0) {
            onKeywordDrop(keywordIds);
            updateDragTarget(undefined);
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
      {dragFeedback && dragTargetLabel && typeof document !== "undefined" &&
        createPortal(
          <span
            aria-hidden="true"
            className="semantic-group-drop-label"
            style={{
              left: `clamp(92px, ${dragFeedback.x}px, calc(100vw - 92px))`,
              top: `${Math.max(58, dragFeedback.y)}px`
            }}
          >
            {dragTargetLabel}
          </span>,
          document.body
        )}
      {contextMenu && (
        <ContextMenu
          afterItemId="export"
          footer={contextColorNote ? (
            <div className="semantic-group-context-note">
              <Icon name="info" />
              <span>
                <strong>Примечание к цвету</strong>
                {contextColorNote}
              </span>
            </div>
          ) : undefined}
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
  const value = event.dataTransfer.getData(KEYWORD_DRAG_TYPE);
  return value ? [...new Set(value.split(",").filter(Boolean))] : [];
}

function dragFeedbackFromEvent(event: DragEvent): SemanticGroupDragFeedback {
  return {
    x: event.clientX,
    y: event.clientY,
    kind: Array.from(event.dataTransfer.types).includes(KEYWORD_DRAG_TYPE)
      ? "keyword"
      : "group"
  };
}

function semanticGroupDragTargetLabel(
  target: SemanticGroupTreeDropTarget,
  kind: SemanticGroupDragFeedback["kind"],
  groupById: ReadonlyMap<string, SemanticGroupTreeItem>
): string {
  if (target.placement === "root") {
    return kind === "keyword"
      ? "Переместить без папки"
      : "Корневой уровень";
  }
  if (target.placement === "inside") {
    return kind === "keyword"
      ? `В папку «${target.group.name}»`
      : `Внутрь «${target.group.name}»`;
  }
  return target.group.parentId
    ? `В «${groupById.get(target.group.parentId)?.name ?? "родительскую папку"}»`
    : "Корневой уровень";
}
