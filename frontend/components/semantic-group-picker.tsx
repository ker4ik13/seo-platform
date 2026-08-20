"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";
import { Icon, type IconName } from "./icon";

interface GroupPickerRow {
  readonly group: SemanticGroupTreeItem;
  readonly depth: number;
  readonly hasChildren: boolean;
}

export function SemanticGroupPicker({
  autoFocus = false,
  className,
  groups,
  onChange,
  rootIcon = "inbox",
  rootLabel = "Без группы",
  searchPlaceholder = "Найти папку по названию или пути",
  showRootOption = true,
  value
}: Readonly<{
  autoFocus?: boolean;
  className?: string;
  groups: readonly SemanticGroupTreeItem[];
  onChange: (groupId: string) => void;
  rootIcon?: IconName;
  rootLabel?: string;
  searchPlaceholder?: string;
  showRootOption?: boolean;
  value: string;
}>) {
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => !systemKind),
    [groups]
  );
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => initiallyExpandedGroupIds(availableGroups, value)
  );
  const rows = useMemo(
    () => groupPickerRows(availableGroups, expandedIds, search),
    [availableGroups, expandedIds, search]
  );

  function toggleExpanded(id: string): void {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={`semantic-group-picker${className ? ` ${className}` : ""}`}>
      <label className="semantic-move-search">
        <span className="visually-hidden">Поиск группы</span>
        <Icon name="search" />
        <input
          autoFocus={autoFocus}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          type="search"
          value={search}
        />
      </label>
      <div aria-label="Дерево групп" className="semantic-move-tree" role="tree">
        {showRootOption && (
          <button
            aria-selected={value === ""}
            className={`semantic-move-tree-row root${value === "" ? " selected" : ""}`}
            onClick={() => onChange("")}
            role="treeitem"
            type="button"
          >
            <span className="semantic-move-tree-spacer" />
            <Icon name={rootIcon} />
            <span>{rootLabel}</span>
            {value === "" && <Icon name="checkDouble" />}
          </button>
        )}
        {rows.map(({ group, depth, hasChildren }) => {
          const expanded = expandedIds.has(group.id) || Boolean(search.trim());
          const selected = group.id === value;
          return (
            <div
              className={`semantic-move-tree-row${selected ? " selected" : ""}`}
              key={group.id}
              role="none"
              style={{ "--move-group-depth": depth } as CSSProperties}
            >
              <button
                aria-label={hasChildren
                  ? expanded
                    ? `Свернуть ${group.name}`
                    : `Развернуть ${group.name}`
                  : undefined}
                className="semantic-move-tree-toggle"
                disabled={!hasChildren || Boolean(search.trim())}
                onClick={() => toggleExpanded(group.id)}
                tabIndex={hasChildren ? 0 : -1}
                type="button"
              >
                {hasChildren && (
                  <Icon
                    className={expanded ? "expanded" : undefined}
                    name="chevronRight"
                  />
                )}
              </button>
              <button
                aria-selected={selected}
                className="semantic-move-tree-choice"
                onClick={() => onChange(group.id)}
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
    </div>
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

function groupPickerRows(
  groups: readonly SemanticGroupTreeItem[],
  expandedIds: ReadonlySet<string>,
  search: string
): readonly GroupPickerRow[] {
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
    siblings.sort(
      (left, right) =>
        left.position - right.position || left.name.localeCompare(right.name, "ru")
    );
  }
  const visibleIds = new Set<string>();
  if (normalizedSearch) {
    for (const group of groups) {
      if (!`${group.name}\n${group.path}`
        .normalize("NFKC")
        .toLocaleLowerCase("ru")
        .includes(normalizedSearch)) continue;
      for (
        let current: SemanticGroupTreeItem | undefined = group;
        current;
        current = current.parentId ? byId.get(current.parentId) : undefined
      ) {
        if (visibleIds.has(current.id)) break;
        visibleIds.add(current.id);
      }
    }
  }
  const rows: GroupPickerRow[] = [];
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
