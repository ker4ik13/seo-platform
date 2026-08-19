"use client";

import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { SemanticKeywordBulkResult } from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";
import { SemanticModal } from "./semantic-modal";
import { Icon } from "./icon";

interface MoveGroupRow {
  readonly group: SemanticGroupTreeItem;
  readonly depth: number;
  readonly hasChildren: boolean;
}

export function SemanticKeywordMoveDialog({
  groups,
  initialGroupId = "",
  onClose,
  onCompleted,
  projectId,
  selections
}: Readonly<{
  groups: readonly SemanticGroupTreeItem[];
  initialGroupId?: string;
  onClose: () => void;
  onCompleted: (result: SemanticKeywordBulkResult) => void;
  projectId: string;
  selections: readonly Readonly<{
    id: string;
    version: number;
    text: string;
    currentGroupPath?: string;
  }>[];
}>) {
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => !systemKind),
    [groups]
  );
  const safeInitialGroupId = availableGroups.some(({ id }) => id === initialGroupId)
    ? initialGroupId
    : "";
  const [groupId, setGroupId] = useState(safeInitialGroupId);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => initiallyExpandedGroupIds(availableGroups, safeInitialGroupId)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const rows = useMemo(
    () => moveGroupRows(availableGroups, expandedIds, search),
    [availableGroups, expandedIds, search]
  );
  const selectedGroup = availableGroups.find(({ id }) => id === groupId);
  const currentLocation = moveCurrentLocation(selections);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<SemanticKeywordBulkResult>(
        `/app/api/projects/${encodeURIComponent(projectId)}/bulk-commands`,
        {
          method: "POST",
          body: {
            items: selections.map(({ id, version }) => ({ id, version })),
            patch: { groupId: groupId || null }
          }
        }
      );
      onCompleted(result);
    } catch (requestError) {
      setError(moveErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function toggleExpanded(id: string): void {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <SemanticModal
      description={`Выбрано запросов: ${selections.length}. Выберите папку в дереве — вложенность и путь сохранятся.`}
      onClose={saving ? () => undefined : onClose}
      size="medium"
      title="Перенести запросы"
    >
      <form className="semantic-dialog-form semantic-move-dialog" onSubmit={(event) => void submit(event)}>
        <div className="semantic-move-current-summary">
          <span className="semantic-move-current-icon"><Icon name="inbox" /></span>
          <span>
            <small>{selections.length === 1 ? "Текущая группа" : "Сейчас находятся"}</small>
            <strong title={currentLocation.title}>{currentLocation.label}</strong>
          </span>
          {currentLocation.detail && <b>{currentLocation.detail}</b>}
        </div>
        <div className="semantic-move-target-summary">
          <span className="semantic-move-target-icon"><Icon name="move" /></span>
          <span>
            <small>Целевая группа</small>
            <strong>{selectedGroup?.path ?? "Без группы"}</strong>
          </span>
          <b>{selections.length}</b>
        </div>

        <label className="semantic-move-search">
          <span className="visually-hidden">Поиск группы</span>
          <Icon name="search" />
          <input
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Найти папку по названию или пути"
            type="search"
            value={search}
          />
        </label>

        <div aria-label="Дерево групп" className="semantic-move-tree" role="tree">
          <button
            aria-selected={groupId === ""}
            className={`semantic-move-tree-row root${groupId === "" ? " selected" : ""}`}
            onClick={() => setGroupId("")}
            role="treeitem"
            type="button"
          >
            <span className="semantic-move-tree-spacer" />
            <Icon name="inbox" />
            <span>Без группы</span>
            {groupId === "" && <Icon name="checkDouble" />}
          </button>
          {rows.map(({ group, depth, hasChildren }) => {
            const expanded = expandedIds.has(group.id) || Boolean(search.trim());
            const selected = group.id === groupId;
            return (
              <div
                className={`semantic-move-tree-row${selected ? " selected" : ""}`}
                key={group.id}
                role="none"
                style={{ "--move-group-depth": depth } as CSSProperties}
              >
                <button
                  aria-label={hasChildren ? (expanded ? `Свернуть ${group.name}` : `Развернуть ${group.name}`) : undefined}
                  className="semantic-move-tree-toggle"
                  disabled={!hasChildren || Boolean(search.trim())}
                  onClick={() => toggleExpanded(group.id)}
                  tabIndex={hasChildren ? 0 : -1}
                  type="button"
                >
                  {hasChildren && <Icon className={expanded ? "expanded" : undefined} name="chevronRight" />}
                </button>
                <button
                  aria-selected={selected}
                  className="semantic-move-tree-choice"
                  onClick={() => setGroupId(group.id)}
                  role="treeitem"
                  title={group.path}
                  type="button"
                >
                  <i style={{ backgroundColor: group.color ?? "#aaa6bb" }} />
                  <span>
                    <strong>{group.name}</strong>
                    {depth > 0 && <small>{group.path}</small>}
                  </span>
                  <b>{formatInteger(group.keywordCount)}</b>
                  {selected && <Icon name="checkDouble" />}
                </button>
              </div>
            );
          })}
          {rows.length === 0 && search.trim() && (
            <div className="semantic-move-tree-empty">Группы не найдены</div>
          )}
        </div>

        <details className="semantic-move-selection">
          <summary>Переносимые запросы · {selections.length}</summary>
          <div className="semantic-dialog-selection">
            {selections.slice(0, 30).map((selection) => (
              <span key={selection.id}>{selection.text}</span>
            ))}
            {selections.length > 30 && <span>Ещё {selections.length - 30}</span>}
          </div>
        </details>

        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        <div className="semantic-modal-actions">
          <button className="secondary-button" disabled={saving} onClick={onClose} type="button">Отмена</button>
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "Переносим…" : `Перенести (${selections.length})`}
          </button>
        </div>
      </form>
    </SemanticModal>
  );
}

function initiallyExpandedGroupIds(
  groups: readonly SemanticGroupTreeItem[],
  selectedId: string
): ReadonlySet<string> {
  const result = new Set(
    groups.filter(({ parentId }) => !parentId).map(({ id }) => id)
  );
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (let current = byId.get(selectedId); current?.parentId; ) {
    result.add(current.parentId);
    current = byId.get(current.parentId);
  }
  return result;
}

function moveGroupRows(
  groups: readonly SemanticGroupTreeItem[],
  expandedIds: ReadonlySet<string>,
  search: string
): readonly MoveGroupRow[] {
  const normalizedSearch = search.normalize("NFKC").trim().toLocaleLowerCase("ru");
  const byParent = new Map<string, SemanticGroupTreeItem[]>();
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const group of groups) {
    const parent = group.parentId && byId.has(group.parentId) ? group.parentId : "";
    const siblings = byParent.get(parent) ?? [];
    siblings.push(group);
    byParent.set(parent, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, "ru"));
  }
  const visibleIds = new Set<string>();
  if (normalizedSearch) {
    for (const group of groups) {
      if (!`${group.name}\n${group.path}`.normalize("NFKC").toLocaleLowerCase("ru").includes(normalizedSearch)) continue;
      for (let current: SemanticGroupTreeItem | undefined = group; current; current = current.parentId ? byId.get(current.parentId) : undefined) {
        if (visibleIds.has(current.id)) break;
        visibleIds.add(current.id);
      }
    }
  }
  const rows: MoveGroupRow[] = [];
  const visited = new Set<string>();
  const append = (parentId: string, depth: number): void => {
    for (const group of byParent.get(parentId) ?? []) {
      if (visited.has(group.id) || (normalizedSearch && !visibleIds.has(group.id))) continue;
      visited.add(group.id);
      const children = byParent.get(group.id) ?? [];
      rows.push({ group, depth, hasChildren: children.length > 0 });
      if (normalizedSearch || expandedIds.has(group.id)) append(group.id, depth + 1);
    }
  };
  append("", 0);
  return rows;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function moveCurrentLocation(
  selections: readonly Readonly<{ currentGroupPath?: string }>[]
): Readonly<{ label: string; title: string; detail?: string }> {
  const paths = selections.map(({ currentGroupPath }) => currentGroupPath?.trim() || "Без группы");
  const unique = [...new Set(paths)];
  if (selections.length === 1) {
    return { label: unique[0] ?? "Без группы", title: unique[0] ?? "Без группы" };
  }
  if (unique.length === 1) {
    return {
      label: unique[0] ?? "Без группы",
      title: unique[0] ?? "Без группы",
      detail: `${selections.length} запросов`
    };
  }
  return {
    label: `${unique.length} разных групп`,
    title: unique.join("\n"),
    detail: `${selections.length} запросов`
  };
}

function moveErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") return "Часть запросов уже изменена. Обновите таблицу и повторите перенос.";
    if (error.code === "FORBIDDEN") return "Недостаточно прав для переноса запросов.";
    if (error.code === "VALIDATION_FAILED") return error.fieldErrors[0]?.message ?? "Проверьте целевую группу.";
    return error.message;
  }
  return "Не удалось перенести запросы.";
}
