"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from "react";
import {
  expandedAncestorIds,
  treeIdsWithDescendants,
  visibleFolderRows
} from "../lib/semantic-operation-tree";
import { Icon } from "./icon";

export function SemanticExportFolderPicker({
  disabled,
  groups,
  includeDescendants,
  onIncludeDescendantsChange,
  onSelectedGroupIdsChange,
  selectedGroupIds
}: Readonly<{
  disabled: boolean;
  groups: readonly SemanticExportFolderGroup[];
  includeDescendants: boolean;
  onIncludeDescendantsChange: (value: boolean) => void;
  onSelectedGroupIdsChange: (value: ReadonlySet<string>) => void;
  selectedGroupIds: ReadonlySet<string>;
}>) {
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => systemKind === undefined),
    [groups]
  );
  const [search, setSearch] = useState("");
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<string>>(
    () => expandedAncestorIds(availableGroups, selectedGroupIds)
  );
  const includedGroupIds = useMemo(
    () => includeDescendants
      ? new Set(treeIdsWithDescendants(availableGroups, selectedGroupIds))
      : new Set(selectedGroupIds),
    [availableGroups, includeDescendants, selectedGroupIds]
  );
  const includedKeywordRows = useMemo(() => {
    let total = 0;
    for (const group of availableGroups) {
      if (includedGroupIds.has(group.id)) total += group.keywordCount;
    }
    return total;
  }, [availableGroups, includedGroupIds]);
  const rows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("ru-RU");
    if (!normalized) return visibleFolderRows(availableGroups, expandedGroupIds);
    const byId = new Map(availableGroups.map((group) => [group.id, group]));
    const visibleIds = new Set<string>();
    for (const group of availableGroups) {
      if (
        !group.name.toLocaleLowerCase("ru-RU").includes(normalized) &&
        !group.path.toLocaleLowerCase("ru-RU").includes(normalized)
      ) continue;
      let current: SemanticExportFolderGroup | undefined = group;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        visibleIds.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    const visibleGroups = availableGroups.filter(({ id }) => visibleIds.has(id));
    return visibleFolderRows(visibleGroups, visibleIds);
  }, [availableGroups, expandedGroupIds, search]);

  useEffect(() => {
    const ancestors = expandedAncestorIds(availableGroups, selectedGroupIds);
    if (ancestors.size === 0) return;
    setExpandedGroupIds((current) => new Set([...current, ...ancestors]));
  }, [availableGroups, selectedGroupIds]);

  function toggleGroup(groupId: string): void {
    const next = new Set(selectedGroupIds);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    onSelectedGroupIdsChange(next);
  }

  function selectAll(): void {
    if (!includeDescendants) {
      onSelectedGroupIdsChange(new Set(availableGroups.map(({ id }) => id)));
      return;
    }
    const availableIds = new Set(availableGroups.map(({ id }) => id));
    onSelectedGroupIdsChange(new Set(
      availableGroups
        .filter(({ parentId }) => !parentId || !availableIds.has(parentId))
        .map(({ id }) => id)
    ));
  }

  return (
    <section className="semantic-export-folder-picker" aria-labelledby="semantic-export-folder-title">
      <header>
        <div>
          <strong id="semantic-export-folder-title">Папки карты сайта</strong>
          <span>
            В карту попадёт {formatInteger(includedGroupIds.size)} папок · до {formatInteger(includedKeywordRows)} строк
          </span>
        </div>
        <div className="semantic-export-folder-actions">
          <button disabled={disabled || availableGroups.length === 0} onClick={selectAll} type="button">
            Выбрать все
          </button>
          <button disabled={disabled || selectedGroupIds.size === 0} onClick={() => onSelectedGroupIdsChange(new Set())} type="button">
            Очистить
          </button>
        </div>
      </header>
      <div className="semantic-export-folder-controls">
        <label className="semantic-export-folder-search">
          <Icon name="search" />
          <input
            aria-label="Поиск папок карты сайта"
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Найти папку по названию или пути"
            type="search"
            value={search}
          />
        </label>
        <label className="semantic-control-check semantic-export-folder-descendants">
          <input
            checked={includeDescendants}
            disabled={disabled}
            onChange={(event) => onIncludeDescendantsChange(event.target.checked)}
            type="checkbox"
          />
          <span>Включать все вложенные папки выбранных</span>
        </label>
      </div>
      <div className="semantic-operation-folder-list semantic-export-folder-tree" aria-label="Дерево папок карты сайта">
        {rows.map(({ group, depth, hasChildren }) => {
          const selected = selectedGroupIds.has(group.id);
          const includedByParent = !selected && includedGroupIds.has(group.id);
          return (
            <div
              className={`semantic-operation-folder-row${includedByParent ? " included-by-parent" : ""}`}
              key={group.id}
              style={{ "--folder-depth": depth } as CSSProperties}
              title={group.path}
            >
              {hasChildren ? (
                <button
                  aria-label={expandedGroupIds.has(group.id) ? "Свернуть папку" : "Развернуть папку"}
                  aria-expanded={expandedGroupIds.has(group.id)}
                  className="semantic-operation-folder-toggle"
                  disabled={disabled}
                  onClick={() => setExpandedGroupIds((current) => {
                    const next = new Set(current);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  })}
                  type="button"
                >
                  <Icon name="chevronRight" />
                </button>
              ) : (
                <span className="semantic-operation-folder-toggle-spacer" />
              )}
              <label>
                <input
                  checked={selected}
                  disabled={disabled}
                  onChange={() => toggleGroup(group.id)}
                  type="checkbox"
                />
                <i
                  aria-hidden="true"
                  className="semantic-operation-folder-color"
                  style={{ background: group.color ?? "#a8a5b8" }}
                />
                <span>{group.name}</span>
                {includedByParent && <em>из вложенных</em>}
                <b>{formatInteger(group.keywordCount)}</b>
              </label>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p>{search.trim() ? "Папки по этому поиску не найдены." : "В проекте пока нет обычных папок."}</p>
        )}
      </div>
      <small>
        Пустые папки сохраняются в дереве. Отдельный лист создаётся для каждой папки, в которой есть запросы.
      </small>
    </section>
  );
}

interface SemanticExportFolderGroup {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly color?: string;
  readonly position: number;
  readonly keywordCount: number;
  readonly systemKind?: "UNGROUPED" | "TRASH";
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}
