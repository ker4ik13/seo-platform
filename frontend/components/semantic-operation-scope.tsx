"use client";

import { useEffect, useMemo, useState } from "react";
import { browserApiCollectionRequest } from "../lib/browser-api";

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
  readonly keywordCount: number;
  readonly systemKind?: "UNGROUPED" | "TRASH";
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
  maxItems,
  onChange,
  projectId
}: Readonly<{
  activeGroupId?: string | undefined;
  groups: readonly SemanticOperationGroup[];
  initialSelections: readonly SemanticOperationSelection[];
  maxItems: number;
  onChange: (
    selections: readonly SemanticOperationSelection[],
    resolving: boolean,
    error?: string
  ) => void;
  projectId: string;
}>) {
  const initialMode = initialSelections.length > 0 ? "QUERIES" : "GROUPS";
  const [mode, setMode] = useState<"QUERIES" | "GROUPS">(initialMode);
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
        activeGroupId &&
          groups.some(
            ({ id, systemKind }) => id === activeGroupId && systemKind !== "TRASH"
          )
          ? [activeGroupId]
          : []
      )
  );
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => systemKind !== "TRASH"),
    [groups]
  );
  const resolvedGroupIds = useMemo(
    () => groupsWithDescendants(availableGroups, selectedGroupIds),
    [availableGroups, selectedGroupIds]
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
    if (mode === "QUERIES") {
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
    if (resolvedGroupIds.length === 0) {
      onChange([], false);
      return;
    }
    const controller = new AbortController();
    onChange([], true);
    void loadGroupSelections(projectId, resolvedGroupIds, maxItems, controller.signal)
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
  }, [maxItems, mode, onChange, projectId, querySelections, resolvedGroupIds]);

  useEffect(() => {
    if (mode !== "QUERIES") return;
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
            checked={mode === "QUERIES"}
            name="operation-scope"
            onChange={() => setMode("QUERIES")}
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
      {mode === "QUERIES" ? (
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
          {availableGroups.map((group) => (
            <label key={group.id} title={group.path}>
              <input
                checked={selectedGroupIds.has(group.id)}
                onChange={() => toggleGroup(group.id)}
                type="checkbox"
              />
              <span>{group.path}</span>
              <b>{group.keywordCount}</b>
            </label>
          ))}
        </div>
      )}
      <small>Текущее выделение таблицы переносится в список конкретных запросов. Родительская папка включает вложенные. Лимит одной операции: {maxItems}.</small>
    </section>
  );
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
