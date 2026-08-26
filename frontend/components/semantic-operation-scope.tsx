"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent
} from "react";
import type { TrackingContextScopeMode } from "@seo-platform/contracts";
import {
  browserApiCollectionRequest,
  type BrowserApiCollection
} from "../lib/browser-api";
import {
  expandedAncestorIds,
  treeIdsWithDescendants,
  visibleFolderRows
} from "../lib/semantic-operation-tree";
import { semanticOperationScopeQuery } from "../lib/semantic-operation-scope-query";
import { Icon } from "./icon";

export interface SemanticOperationSelection {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly isTracked?: boolean;
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

export type SemanticOperationScopeCountChange = (
  count: number | undefined,
  resolving: boolean
) => void;

interface KeywordListItem {
  readonly id: string;
  readonly version: number;
  readonly textOriginal: string;
  readonly groupPath?: string;
  readonly isTracked: boolean;
  readonly trashed?: boolean;
}

export function SemanticOperationScope({
  activeGroupId,
  groups,
  initialSelections,
  initialScope,
  maxItems,
  onChange,
  onCountChange,
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
  onCountChange?: SemanticOperationScopeCountChange;
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
  const [queryLoadingMore, setQueryLoadingMore] = useState(false);
  const [queryLoadError, setQueryLoadError] = useState<string>();
  const [queryNextCursor, setQueryNextCursor] = useState<string>();
  const [queryHasNext, setQueryHasNext] = useState(false);
  const [queryTotalApprox, setQueryTotalApprox] = useState<number>();
  const [queryReloadToken, setQueryReloadToken] = useState(0);
  const [queryError, setQueryError] = useState<string>();
  const queryListRef = useRef<HTMLDivElement>(null);
  const querySentinelRef = useRef<HTMLDivElement>(null);
  const queryPaginationControllerRef = useRef<AbortController | undefined>(undefined);
  const queryLoadingMoreRef = useRef(false);
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
    () => expandedAncestorIds(
      groups,
      initialScope?.groupIds ?? (activeGroupId ? [activeGroupId] : [])
    )
  );
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => systemKind !== "TRASH"),
    [groups]
  );
  const resolvedGroupIds = useMemo(
    () => treeIdsWithDescendants(availableGroups, selectedGroupIds),
    [availableGroups, selectedGroupIds]
  );
  const visibleGroups = useMemo(
    () => visibleFolderRows(availableGroups, expandedGroupIds),
    [availableGroups, expandedGroupIds]
  );
  const visibleQueryOptions = useMemo(() => {
    const result = new Map<string, KeywordListItem>();
    const normalizedSearch = querySearch.trim().toLocaleLowerCase("ru-RU");
    for (const selection of querySelections.values()) {
      if (
        normalizedSearch &&
        !selection.label.toLocaleLowerCase("ru-RU").includes(normalizedSearch)
      ) continue;
      result.set(selection.id, {
        id: selection.id,
        version: selection.version,
        textOriginal: selection.label,
        isTracked: selection.isTracked ?? true
      });
    }
    for (const option of queryOptions) {
      if (!option.trashed) result.set(option.id, option);
    }
    return [...result.values()];
  }, [queryOptions, querySearch, querySelections]);

  useEffect(() => {
    onScopeChange?.({
      mode,
      groupIds: mode === "GROUPS" ? [...selectedGroupIds] : []
    });
    if (mode === "KEYWORDS") {
      onCountChange?.(querySelections.size, false);
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
      onCountChange?.(0, false);
      onChange([], false);
      return;
    }
    const controller = new AbortController();
    let resolvedCount: number | undefined;
    onCountChange?.(undefined, true);
    onChange([], true);
    const reportCount = (count: number): void => {
      resolvedCount = count;
      if (!controller.signal.aborted) onCountChange?.(count, true);
    };
    const timer = window.setTimeout(() => {
      const loader = mode === "ALL"
        ? loadProjectSelections(projectId, maxItems, controller.signal, reportCount)
        : loadGroupSelections(
            projectId,
            resolvedGroupIds,
            maxItems,
            controller.signal,
            reportCount
          );
      void loader
      .then((selections) => {
        if (controller.signal.aborted) return;
        onCountChange?.(selections.length, false);
        onChange(selections, false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        onCountChange?.(resolvedCount, false);
        onChange(
          [],
          false,
          error instanceof Error ? error.message : "Не удалось загрузить запросы папок."
        );
      });
    }, SCOPE_RESOLUTION_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [maxItems, mode, onChange, onCountChange, onScopeChange, projectId, querySelections, resolvedGroupIds, selectedGroupIds]);

  useEffect(() => {
    queryPaginationControllerRef.current?.abort();
    queryPaginationControllerRef.current = undefined;
    queryLoadingMoreRef.current = false;
    setQueryLoadingMore(false);
    setQueryLoadError(undefined);
    setQueryOptions([]);
    setQueryNextCursor(undefined);
    setQueryHasNext(false);
    setQueryTotalApprox(undefined);
    if (mode !== "KEYWORDS") {
      setQueryLoading(false);
      return;
    }
    setQueryLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadQueryOptions(projectId, querySearch, undefined, controller.signal)
        .then((page) => {
          if (controller.signal.aborted) return;
          setQueryOptions(activeQueryOptions(page.data));
          setQueryNextCursor(page.page.nextCursor);
          setQueryHasNext(page.page.hasNext && Boolean(page.page.nextCursor));
          setQueryTotalApprox(page.page.totalApprox);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setQueryLoadError(
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
  }, [mode, projectId, queryReloadToken, querySearch]);

  useEffect(() => () => queryPaginationControllerRef.current?.abort(), []);

  const loadNextQueryPage = useCallback((): void => {
    if (
      mode !== "KEYWORDS" ||
      queryLoading ||
      queryLoadingMoreRef.current ||
      !queryHasNext ||
      !queryNextCursor
    ) return;
    const controller = new AbortController();
    queryPaginationControllerRef.current?.abort();
    queryPaginationControllerRef.current = controller;
    queryLoadingMoreRef.current = true;
    setQueryLoadingMore(true);
    setQueryLoadError(undefined);
    void loadQueryOptions(
      projectId,
      querySearch,
      queryNextCursor,
      controller.signal
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setQueryOptions((current) => mergeQueryOptions(current, page.data));
        setQueryNextCursor(page.page.nextCursor);
        setQueryHasNext(page.page.hasNext && Boolean(page.page.nextCursor));
        setQueryTotalApprox(page.page.totalApprox);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setQueryLoadError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить следующую страницу запросов."
        );
      })
      .finally(() => {
        if (queryPaginationControllerRef.current !== controller) return;
        queryPaginationControllerRef.current = undefined;
        queryLoadingMoreRef.current = false;
        setQueryLoadingMore(false);
      });
  }, [mode, projectId, queryHasNext, queryLoading, queryNextCursor, querySearch]);

  useEffect(() => {
    const root = queryListRef.current;
    const target = querySentinelRef.current;
    if (
      mode !== "KEYWORDS" ||
      !root ||
      !target ||
      !queryHasNext ||
      queryLoadError
    ) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(({ isIntersecting }) => isIntersecting)) {
          loadNextQueryPage();
        }
      },
      { root, rootMargin: "0px 0px 120px", threshold: 0.01 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadNextQueryPage, mode, queryHasNext, queryLoadError]);

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
          label: option.textOriginal,
          isTracked: option.isTracked
        });
      } else {
        setQueryError(`За один запуск можно выбрать не больше ${maxItems} запросов.`);
      }
      return next;
    });
  }

  function selectVisibleQueries(): void {
    const additions = queryOptions.filter(({ id }) => !querySelections.has(id));
    if (querySelections.size + additions.length > maxItems) {
      setQueryError(
        `Загруженные строки превысят лимит ${maxItems}. Уточните поиск и выберите нужные запросы.`
      );
      return;
    }
    setQuerySelections((current) => {
      const next = new Map(current);
      for (const option of additions) {
        next.set(option.id, {
          id: option.id,
          version: option.version,
          label: option.textOriginal,
          isTracked: option.isTracked
        });
      }
      return next;
    });
  }

  function loadMoreOnScroll(event: UIEvent<HTMLDivElement>): void {
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) {
      loadNextQueryPage();
    }
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
              Выбрать загруженные
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
            aria-busy={queryLoading || queryLoadingMore}
            aria-label="Конкретные запросы"
            className="semantic-operation-query-list"
            onScroll={loadMoreOnScroll}
            ref={queryListRef}
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
            {!queryLoading && !queryLoadError && visibleQueryOptions.length === 0 && (
              <p>По этому поиску запросов нет.</p>
            )}
            {queryLoading && queryOptions.length === 0 && (
              <p role="status">Загружаем запросы…</p>
            )}
            {queryLoadError && (
              <div className="semantic-operation-query-load-error" role="alert">
                <span>{queryLoadError}</span>
                <button onClick={() => setQueryReloadToken((value) => value + 1)} type="button">
                  Повторить
                </button>
              </div>
            )}
            {queryHasNext && !queryLoadError && (
              <div
                aria-label={queryLoadingMore ? "Загружаем ещё запросы" : "Загрузить следующую страницу"}
                className="semantic-operation-query-sentinel"
                ref={querySentinelRef}
                role="status"
              >
                {queryLoadingMore ? <><i aria-hidden="true" />Загружаем ещё…</> : "Прокрутите ниже"}
              </div>
            )}
            {!queryLoading && !queryHasNext && queryOptions.length > 0 && (
              <p className="semantic-operation-query-page-status" role="status">
                Загружено {queryOptions.length}{queryTotalApprox !== undefined ? ` из ${queryTotalApprox}` : ""}
              </p>
            )}
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

async function loadQueryOptions(
  projectId: string,
  search: string,
  cursor: string | undefined,
  signal: AbortSignal
): Promise<BrowserApiCollection<KeywordListItem>> {
  const query = new URLSearchParams({
    limit: "200",
    sort: "TEXT_ASC"
  });
  const normalizedSearch = search.trim();
  if (normalizedSearch) query.set("search", normalizedSearch);
  if (cursor) query.set("cursor", cursor);
  return browserApiCollectionRequest<KeywordListItem>(
    `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`,
    { signal }
  );
}

function activeQueryOptions(
  options: readonly KeywordListItem[]
): readonly KeywordListItem[] {
  return options.filter(({ trashed }) => trashed !== true);
}

function mergeQueryOptions(
  current: readonly KeywordListItem[],
  nextPage: readonly KeywordListItem[]
): readonly KeywordListItem[] {
  const merged = new Map(current.map((option) => [option.id, option]));
  for (const option of activeQueryOptions(nextPage)) merged.set(option.id, option);
  return [...merged.values()];
}

async function loadGroupSelections(
  projectId: string,
  groupIds: readonly string[],
  maxItems: number,
  signal: AbortSignal,
  onCount: (count: number) => void
): Promise<readonly SemanticOperationSelection[]> {
  const selections = new Map<string, SemanticOperationSelection>();
  let cursor: string | undefined;
  do {
    const query = semanticOperationScopeQuery(groupIds, cursor);
    const page = await browserApiCollectionRequest<KeywordListItem>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`,
      { signal }
    );
    if (!cursor && page.page.totalApprox !== undefined) {
      onCount(page.page.totalApprox);
      if (page.page.totalApprox > maxItems) {
        throw new Error(
          `В выбранных папках ${page.page.totalApprox} запросов, а этот источник принимает не больше ${maxItems} за запуск. Уточните папки или выберите конкретные запросы.`
        );
      }
    }
    for (const keyword of page.data) {
      selections.set(keyword.id, {
        id: keyword.id,
        version: keyword.version,
        label: keyword.textOriginal,
        isTracked: keyword.isTracked
      });
      if (selections.size > maxItems) {
        onCount(selections.size);
        throw new Error(
          `В выбранных папках больше ${maxItems} запросов. Уточните папки или выберите конкретные запросы.`
        );
      }
    }
    cursor = page.page.hasNext ? page.page.nextCursor : undefined;
  } while (cursor);
  return [...selections.values()];
}

async function loadProjectSelections(
  projectId: string,
  maxItems: number,
  signal: AbortSignal,
  onCount: (count: number) => void
): Promise<readonly SemanticOperationSelection[]> {
  const selections: SemanticOperationSelection[] = [];
  let cursor: string | undefined;
  do {
    const query = semanticOperationScopeQuery(undefined, cursor);
    const page = await browserApiCollectionRequest<KeywordListItem>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`,
      { signal }
    );
    if (!cursor && page.page.totalApprox !== undefined) {
      onCount(page.page.totalApprox);
      if (page.page.totalApprox > maxItems) {
        throw new Error(
          `В проекте ${page.page.totalApprox} запросов, а этот источник принимает не больше ${maxItems} за запуск. Выберите отдельные папки или конкретные запросы.`
        );
      }
    }
    for (const keyword of page.data) {
      if (keyword.trashed) continue;
      selections.push({
        id: keyword.id,
        version: keyword.version,
        label: keyword.textOriginal,
        isTracked: keyword.isTracked
      });
      if (selections.length > maxItems) {
        onCount(selections.length);
        throw new Error(
          `В проекте больше ${maxItems} запросов. Выберите отдельные папки или конкретные запросы.`
        );
      }
    }
    cursor = page.page.hasNext ? page.page.nextCursor : undefined;
  } while (cursor);
  return selections;
}

const SCOPE_RESOLUTION_DEBOUNCE_MS = 120;
