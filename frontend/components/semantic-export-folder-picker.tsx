"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from "react";
import {
  expandedAncestorIds,
  resolvedFolderSelectionIds,
  visibleFolderRows
} from "../lib/semantic-operation-tree";
import { Icon } from "./icon";
import { SemanticFolderDescendantsToggle } from "./semantic-folder-descendants-toggle";
import { UiText, useUiLocale } from "./ui-locale";


export function SemanticExportFolderPicker({
  descendantGroupIds,
  disabled,
  groups,
  onDescendantGroupIdsChange,
  onSelectedGroupIdsChange,
  selectedGroupIds
}: Readonly<{
  disabled: boolean;
  descendantGroupIds: ReadonlySet<string>;
  groups: readonly SemanticExportFolderGroup[];
  onDescendantGroupIdsChange: (value: ReadonlySet<string>) => void;
  onSelectedGroupIdsChange: (value: ReadonlySet<string>) => void;
  selectedGroupIds: ReadonlySet<string>;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => systemKind === undefined),
    [groups]
  );
  const [search, setSearch] = useState("");
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<string>>(
    () => expandedAncestorIds(availableGroups, selectedGroupIds)
  );
  const includedGroupIds = useMemo(
    () => new Set(resolvedFolderSelectionIds(
      availableGroups,
      selectedGroupIds,
      descendantGroupIds
    )),
    [availableGroups, descendantGroupIds, selectedGroupIds]
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
    if (next.has(groupId)) {
      next.delete(groupId);
      const descendantRoots = new Set(descendantGroupIds);
      descendantRoots.delete(groupId);
      onDescendantGroupIdsChange(descendantRoots);
    } else next.add(groupId);
    onSelectedGroupIdsChange(next);
  }

  function toggleDescendants(groupId: string): void {
    onSelectedGroupIdsChange(new Set([...selectedGroupIds, groupId]));
    const next = new Set(descendantGroupIds);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    onDescendantGroupIdsChange(next);
  }

  function selectAll(): void {
    onSelectedGroupIdsChange(new Set(availableGroups.map(({ id }) => id)));
    onDescendantGroupIdsChange(new Set());
  }

  return (
    <section className="semantic-export-folder-picker" aria-labelledby="semantic-export-folder-title">
      <header>
        <div>
          <strong id="semantic-export-folder-title"><UiText text="Папки карты сайта" /></strong>
          <span>
            <UiText text="В карту попадёт" after=" " />{formatInteger(includedGroupIds.size, uiLocale)} <UiText text="папок · до" before=" " after=" " />{formatInteger(includedKeywordRows, uiLocale)} <UiText text="строк" before=" " /></span>
        </div>
        <div className="semantic-export-folder-actions">
          <button disabled={disabled || availableGroups.length === 0} onClick={selectAll} type="button">
            <UiText text="Выбрать все" /></button>
          <button disabled={disabled || selectedGroupIds.size === 0} onClick={() => {
            onSelectedGroupIdsChange(new Set());
            onDescendantGroupIdsChange(new Set());
          }} type="button">
            <UiText text="Очистить" /></button>
        </div>
      </header>
      <div className="semantic-export-folder-controls">
        <label className="semantic-export-folder-search">
          <Icon name="search" />
          <input
            aria-label={uiText("Поиск папок карты сайта")}
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={uiText("Найти папку по названию или пути")}
            type="search"
            value={search}
          />
        </label>
      </div>
      <div className="semantic-operation-folder-list semantic-export-folder-tree" aria-label={uiText("Дерево папок карты сайта")}>
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
                  aria-label={expandedGroupIds.has(group.id) ? uiText("Свернуть папку") : uiText("Развернуть папку")}
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
                  checked={selected || includedByParent}
                  disabled={disabled || includedByParent}
                  onChange={() => toggleGroup(group.id)}
                  type="checkbox"
                />
                <i
                  aria-hidden="true"
                  className="semantic-operation-folder-color"
                  style={{ background: group.color ?? "#a8a5b8" }}
                />
                <span>{group.name}</span>
                {includedByParent && <em><UiText text="из вложенных" /></em>}
                <b>{formatInteger(group.keywordCount, uiLocale)}</b>
              </label>
              {hasChildren ? (
                <SemanticFolderDescendantsToggle
                  disabled={disabled || includedByParent}
                  enabled={descendantGroupIds.has(group.id)}
                  folderName={group.name}
                  onChange={() => toggleDescendants(group.id)}
                />
              ) : (
                <span className="semantic-folder-descendants-spacer" />
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p>{search.trim() ? <UiText text="Папки по этому поиску не найдены." /> : <UiText text="В проекте пока нет обычных папок." />}</p>
        )}
      </div>
      <small>
        <UiText text="Пустые папки сохраняются в дереве. Отдельный лист создаётся для каждой папки, в которой есть запросы." /></small>
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

function formatInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 0 }).format(value);
}
