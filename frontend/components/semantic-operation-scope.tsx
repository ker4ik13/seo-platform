"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { TrackingContextScopeMode } from "@seo-platform/contracts";
import { browserApiCollectionRequest } from "../lib/browser-api";
import { visibleFolderRows } from "../lib/semantic-operation-tree";
import { Icon } from "./icon";

export interface SemanticOperationSelection {
  readonly id: string;
  readonly version: number;
  readonly label: string;
}

export interface SemanticOperationGroup {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly color?: string;
  readonly keywordCount: number;
  readonly systemKind?: "UNGROUPED" | "TRASH";
}

export interface SemanticOperationScopeState {
  readonly mode: TrackingContextScopeMode;
  readonly groupIds: readonly string[];
}

interface KeywordListItem {
  readonly id: string;
  readonly version: number;
  readonly textOriginal: string;
  readonly groupPath?: string;
  readonly trashed?: boolean;
}

export function SemanticOperationScope({
  activeGroupId,
  groups,
  initialSelections,
  initialScope,
  maxItems,
  onChange,
  onScopeChange,
  projectId
}: Readonly<{
  activeGroupId?: string | undefined;
  groups: readonly SemanticOperationGroup[];
  initialSelections: readonly SemanticOperationSelection[];
  initialScope?: SemanticOperationScopeState;
  maxItems: number;
  onChange: (
    selections: readonly SemanticOperationSelection[],
    resolving: boolean,
    error?: string
  ) => void;
  onScopeChange?: (scope: SemanticOperationScopeState) => void;
  projectId: string;
}>) {
  const initialMode: TrackingContextScopeMode = initialScope?.mode ?? (
    initialSelections.length > 0
      ? "KEYWORDS"
      : activeGroupId
        ? "GROUPS"
        : "ALL"
  );
  const [mode, setMode] = useState<TrackingContextScopeMode>(initialMode);
  const [querySearch, setQuerySearch] = useState("");
  const [queryOptions, setQueryOptions] = useState<readonly KeywordListItem[]>([]);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string>();
  const [querySelections, setQuerySelections] = useState<
    ReadonlyMap<string, SemanticOperationSelection>
  >(() => new Map(initialSelections.map((selection) => [selection.id, selection])));
  const [selectedGroupIds, setSelectedGroupIds] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        initialScope?.mode === "GROUPS"
          ? initialScope.groupIds
          : activeGroupId &&
          groups.some(
            ({ id, systemKind }) => id === activeGroupId && systemKind !== "TRASH"
          )
          ? [activeGroupId]
          : []
      )
  );
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<string>>(
    () => expandedAncestors(groups, initialScope?.groupIds ?? (activeGroupId ? [activeGroupId] : []))
  );
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => systemKind !== "TRASH"),
    [groups]
  );
  const resolvedGroupIds = useMemo(
    () => groupsWithDescendants(availableGroups, selectedGroupIds),
    [availableGroups, selectedGroupIds]
  );
  const visibleGroups = useMemo(
    () => visibleFolderRows(availableGroups, expandedGroupIds),
    [availableGroups, expandedGroupIds]
  );
  const visibleQueryOptions = useMemo(() => {
    const result = new Map<string, KeywordListItem>();
    for (const selection of querySelections.values()) {
      result.set(selection.id, {
        id: selection.id,
        version: selection.version,
        textOriginal: selection.label
      });
    }
    for (const option of queryOptions) {
      if (!option.trashed) result.set(option.id, option);
    }
    return [...result.values()];
  }, [queryOptions, querySelections]);

  useEffect(() => {
    onScopeChange?.({
      mode,
      groupIds: mode === "GROUPS" ? [...selectedGroupIds] : []
    });
    if (mode === "KEYWORDS") {
      if (querySelections.size > maxItems) {
        onChange(
          [],
          false,
          `Выбрано ${querySelections.size} запросов, а этот источник принимает не больше ${maxItems} за запуск.`
        );
        return;
      }
      onChange([...querySelections.values()], false);
      return;
    }
    if (mode === "GROUPS" && resolvedGroupIds.length === 0) {
      onChange([], false);
      return;
    }
    const controller = new AbortController();
    onChange([], true);
    const loader = mode === "ALL"
      ? loadProjectSelections(projectId, maxItems, controller.signal)
      : loadGroupSelections(projectId, resolvedGroupIds, maxItems, controller.signal);
    void loader
      .then((selections) => {
        if (!controller.signal.aborted) onChange(selections, false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        onChange(
          [],
          false,
          error instanceof Error ? error.message : "Не удалось загрузить запросы папок."
        );
      });
    return () => controller.abort();
  }, [maxItems, mode, onChange, onScopeChange, projectId, querySelections, resolvedGroupIds, selectedGroupIds]);

  useEffect(() => {
    if (mode !== "KEYWORDS") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setQueryLoading(true);
      setQueryError(undefined);
      void loadQueryOptions(projectId, querySearch, controller.signal)
        .then((options) => {
          if (!controller.signal.aborted) setQueryOptions(options);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setQueryError(
            error instanceof Error
              ? error.message
              : "Не удалось загрузить запросы."
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setQueryLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, projectId, querySearch]);

  function toggleGroup(groupId: string): void {
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function toggleExpanded(groupId: string): void {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function toggleQuery(option: KeywordListItem): void {
    setQueryError(undefined);
    setQuerySelections((current) => {
      const next = new Map(current);
      if (next.has(option.id)) {
        next.delete(option.id);
      } else if (next.size < maxItems) {
        next.set(option.id, {
          id: option.id,
          version: option.version,
          label: option.textOriginal
        });
      } else {
        setQueryError(`За один запуск можно выбрать не больше ${maxItems} запросов.`);
      }
      return next;
    });
  }

  function selectVisibleQueries(): void {
    const additions = visibleQueryOptions.filter(
      ({ id }) => !querySelections.has(id)
    );
    if (querySelections.size + additions.length > maxItems) {
      setQueryError(
        `Показанные строки превысят лимит ${maxItems}. Уточните поиск и выберите нужные запросы.`
      );
      return;
    }
    setQuerySelections((current) => {
      const next = new Map(current);
      for (const option of additions) {
        next.set(option.id, {
          id: option.id,
          version: option.version,
          label: option.textOriginal
        });
      }
      return next;
    });
  }

  return (
    <section className="semantic-operation-scope" aria-labelledby="semantic-operation-scope-title">
      <header>
        <strong id="semantic-operation-scope-title">Что обработать</strong>
        <span>Состав фиксируется перед запуском и не меняется вместе с таблицей.</span>
      </header>
      <div className="semantic-operation-scope-tabs" role="radiogroup" aria-label="Охват операции">
        <label>
          <input
            checked={mode === "ALL"}
            name="operation-scope"
            onChange={() => setMode("ALL")}
            type="radio"
          />
          <span>Все запросы проекта</span>
          <b>Все</b>
        </label>
        <label>
          <input
            checked={mode === "KEYWORDS"}
            name="operation-scope"
            onChange={() => setMode("KEYWORDS")}
            type="radio"
          />
          <span>Конкретные запросы</span>
          <b>{querySelections.size}</b>
        </label>
        <label>
          <input
            checked={mode === "GROUPS"}
            name="operation-scope"
            onChange={() => setMode("GROUPS")}
            type="radio"
          />
          <span>Папки</span>
          <b>{selectedGroupIds.size}</b>
        </label>
      </div>
      {mode === "ALL" ? (
        <div className="semantic-operation-all-scope">
          <strong>Будут обработаны все активные запросы</strong>
          <span>Состав загружается с сервера и фиксируется до запуска операции.</span>
        </div>
      ) : mode === "KEYWORDS" ? (
        <div className="semantic-operation-query-picker">
          <div className="semantic-operation-query-search">
            <label>
              <span className="sr-only">Поиск конкретных запросов</span>
              <input
                onChange={(event) => setQuerySearch(event.target.value)}
                placeholder="Найдите запрос по тексту"
                type="search"
                value={querySearch}
              />
            </label>
            <button onClick={selectVisibleQueries} type="button">
              Выбрать показанные
            </button>
            <button
              disabled={querySelections.size === 0}
              onClick={() => setQuerySelections(new Map())}
              type="button"
            >
              Очистить
            </button>
          </div>
          <div
            aria-busy={queryLoading}
            aria-label="Конкретные запросы"
            className="semantic-operation-query-list"
          >
            {visibleQueryOptions.map((option) => (
              <label key={option.id}>
                <input
                  checked={querySelections.has(option.id)}
                  onChange={() => toggleQuery(option)}
                  type="checkbox"
                />
                <span>
                  <strong>{option.textOriginal}</strong>
                  <small>{option.groupPath ?? "Без группы"}</small>
                </span>
              </label>
            ))}
            {!queryLoading && visibleQueryOptions.length === 0 && (
              <p>По этому поиску запросов нет.</p>
            )}
            {queryLoading && <p role="status">Загружаем запросы…</p>}
          </div>
          {queryError && <div className="inline-alert warning" role="alert">{queryError}</div>}
        </div>
      ) : (
        <div className="semantic-operation-folder-list" aria-label="Папки запросов">
          {visibleGroups.map(({ group, depth, hasChildren }) => (
            <div
              className="semantic-operation-folder-row"
              key={group.id}
              style={{ "--folder-depth": depth } as CSSProperties}
              title={group.path}
            >
              {hasChildren ? (
                <button
                  aria-label={expandedGroupIds.has(group.id) ? "Свернуть папку" : "Развернуть папку"}
                  aria-expanded={expandedGroupIds.has(group.id)}
                  className="semantic-operation-folder-toggle"
                  onClick={() => toggleExpanded(group.id)}
                  type="button"
                >
                  <Icon name="chevronRight" />
                </button>
              ) : (
                <span className="semantic-operation-folder-toggle-spacer" />
              )}
              <label>
                <input
                  checked={selectedGroupIds.has(group.id)}
                  onChange={() => toggleGroup(group.id)}
                  type="checkbox"
                />
                <i
                  aria-hidden="true"
                  className="semantic-operation-folder-color"
                  style={{ background: group.color ?? "#a8a5b8" }}
                />
                <span>{group.name}</span>
                <b>{group.keywordCount}</b>
              </label>
            </div>
          ))}
        </div>
      )}
      <small>Текущее выделение таблицы переносится в список конкретных запросов. Родительская папка включает вложенные. Лимит одной операции: {maxItems}.</small>
    </section>
  );
}

function expandedAncestors(
  groups: readonly SemanticOperationGroup[],
  selectedIds: readonly string[]
): ReadonlySet<string> {
  const parentById = new Map(groups.map(({ id, parentId }) => [id, parentId]));
  const expanded = new Set<string>();
  for (const selectedId of selectedIds) {
    let current = parentById.get(selectedId);
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      expanded.add(current);
      current = parentById.get(current);
    }
  }
  return expanded;
}

async function loadQueryOptions(
  projectId: string,
  search: string,
  signal: AbortSignal
): Promise<readonly KeywordListItem[]> {
  const query = new URLSearchParams({
    limit: "200",
    sort: "TEXT_ASC"
  });
  const normalizedSearch = search.trim();
  if (normalizedSearch) query.set("search", normalizedSearch);
  const page = await browserApiCollectionRequest<KeywordListItem>(
    `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`,
    { signal }
  );
  return page.data.filter(({ trashed }) => trashed !== true);
}

function groupsWithDescendants(
  groups: readonly SemanticOperationGroup[],
  selectedIds: ReadonlySet<string>
): readonly string[] {
  const result = new Set(selectedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (group.parentId && result.has(group.parentId) && !result.has(group.id)) {
        result.add(group.id);
        changed = true;
      }
    }
  }
  return [...result];
}

async function loadGroupSelections(
  projectId: string,
  groupIds: readonly string[],
  maxItems: number,
  signal: AbortSignal
): Promise<readonly SemanticOperationSelection[]> {
  const selections = new Map<string, SemanticOperationSelection>();
  for (const groupId of groupIds) {
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({
        groupId,
        limit: "200",
        sort: "CREATED_ASC"
      });
      if (cursor) query.set("cursor", cursor);
      const page = await browserApiCollectionRequest<KeywordListItem>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`,
        { signal }
      );
      for (const keyword of page.data) {
        selections.set(keyword.id, {
          id: keyword.id,
          version: keyword.version,
          label: keyword.textOriginal
        });
        if (selections.size > maxItems) {
          throw new Error(
            `В выбранных папках больше ${maxItems} запросов. Уточните папки или выделите конкретные запросы в таблице.`
          );
        }
      }
      cursor = page.page.hasNext ? page.page.nextCursor : undefined;
    } while (cursor);
  }
  return [...selections.values()];
}

async function loadProjectSelections(
  projectId: string,
  maxItems: number,
  signal: AbortSignal
): Promise<readonly SemanticOperationSelection[]> {
  const selections: SemanticOperationSelection[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "500", sort: "CREATED_ASC" });
    if (cursor) query.set("cursor", cursor);
    const page = await browserApiCollectionRequest<KeywordListItem>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`,
      { signal }
    );
    for (const keyword of page.data) {
      if (keyword.trashed) continue;
      selections.push({ id: keyword.id, version: keyword.version, label: keyword.textOriginal });
      if (selections.length > maxItems) {
        throw new Error(
          `В проекте больше ${maxItems} запросов. Выберите отдельные папки или конкретные запросы.`
        );
      }
    }
    cursor = page.page.hasNext ? page.page.nextCursor : undefined;
  } while (cursor);
  return selections;
}
