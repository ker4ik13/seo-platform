"use client";

import type {
  RankHistoryItem,
  RankJobSummary,
  SemanticKeywordGroup,
  SemanticKeywordListItem,
  SemanticKeywordSort
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  BrowserApiError,
  browserApiCollectionRequest,
  browserApiRequest,
  type BrowserCursorPage
} from "../lib/browser-api";
import { externalPageUrlPresentation } from "../lib/app-path";
import {
  defaultRankHistoryDateSelection,
  mergeRankHistoryItems,
  parseRankHistoryCollection,
  rankHistoryApiPath,
  rankHistoryPageSize,
  rankHistoryRangeFromDates,
  rankHistoryReturnTo,
  type RankHistoryRequest
} from "../lib/rank-history";
import {
  isActiveRankJob,
  rankJobProgressPercent,
  rankJobStageLabel,
  rankRunsApiPath
} from "../lib/rank-jobs";
import { CustomSelect } from "./custom-select";
import { ProviderLogo } from "./provider-logo";
import { SearchEngineLogo } from "./search-engine-logo";
import { KeywordDataGrid, type KeywordDataGridColumn } from "./keyword-data-grid";
import { SemanticPositionDialog } from "./semantic-position-dialog";
import {
  defaultPositionsViewConfig,
  positionsProjectTableViewName,
  semanticFolderSortFor,
  semanticFolderSortViewName,
  semanticFolderSortViewPrefix,
  type SemanticSavedView,
  type SemanticSystemColumn,
  type SemanticViewConfig
} from "./semantic-view-types";

type PositionsView = "TABLE" | "HISTORY" | "PAGES" | "CANNIBALIZATION";

interface PositionsFailure {
  readonly message: string;
  readonly requestId?: string;
}

interface KeywordQuery {
  readonly groupId?: string;
  readonly search?: string;
  readonly sort: SemanticKeywordSort;
}

interface TargetPageSummary {
  readonly bestPosition?: number;
  readonly keywordCount: number;
  readonly missing: boolean;
  readonly url: string;
}

interface CannibalizationSummary {
  readonly cluster: string;
  readonly keywordCount: number;
  readonly urls: readonly string[];
}

const keywordPageSize = 100;

export function PositionsWorkspace({
  projectId,
  projectName,
  projects,
  projectStatus,
  workspaceStatus
}: Readonly<{
  projectId: string;
  projectName: string;
  projects: readonly Readonly<{ id: string; name: string }>[];
  projectStatus: "DRAFT" | "ACTIVE" | "ARCHIVED";
  workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
}>) {
  const initialDates = useMemo(() => defaultRankHistoryDateSelection(), []);
  const returnTo = rankHistoryReturnTo(projectId);
  const [online, setOnline] = useState(true);
  const [view, setView] = useState<PositionsView>("TABLE");
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [query, setQuery] = useState<KeywordQuery>({ sort: defaultPositionsViewConfig.sort });
  const [viewConfig, setViewConfig] = useState<SemanticViewConfig>(defaultPositionsViewConfig);
  const [draftViewConfig, setDraftViewConfig] = useState<SemanticViewConfig>(defaultPositionsViewConfig);
  const [layoutView, setLayoutView] = useState<SemanticSavedView>();
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [folderSortViews, setFolderSortViews] = useState<readonly SemanticSavedView[]>([]);
  const [savingFolderSort, setSavingFolderSort] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<SemanticSystemColumn>();
  const [searchDraft, setSearchDraft] = useState("");
  const [keywords, setKeywords] = useState<readonly SemanticKeywordListItem[]>([]);
  const [keywordPage, setKeywordPage] = useState<BrowserCursorPage>({ hasNext: false });
  const [keywordLoading, setKeywordLoading] = useState(true);
  const [keywordLoadingMore, setKeywordLoadingMore] = useState(false);
  const [keywordFailure, setKeywordFailure] = useState<PositionsFailure>();
  const [keywordVersion, setKeywordVersion] = useState(0);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [focusedKeywordId, setFocusedKeywordId] = useState<string>();
  const [fromDate, setFromDate] = useState(initialDates.fromDate);
  const [toDate, setToDate] = useState(initialDates.toDate);
  const [historyRequest, setHistoryRequest] = useState<RankHistoryRequest>();
  const [historyItems, setHistoryItems] = useState<readonly RankHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState<BrowserCursorPage>({ hasNext: false });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyFailure, setHistoryFailure] = useState<PositionsFailure>();
  const [historyVersion, setHistoryVersion] = useState(0);
  const [inspectorHistory, setInspectorHistory] = useState<readonly RankHistoryItem[]>([]);
  const [inspectorHistoryLoading, setInspectorHistoryLoading] = useState(false);
  const [jobs, setJobs] = useState<readonly RankJobSummary[]>([]);
  const [jobsFailure, setJobsFailure] = useState<PositionsFailure>();
  const [scanOpen, setScanOpen] = useState(false);
  const keywordLoadLock = useRef(false);
  const historyLoadLock = useRef(false);
  const dateDraftRef = useRef({ fromDate, toDate });
  dateDraftRef.current = { fromDate, toDate };

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void browserApiRequest<readonly SemanticSavedView[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`,
      { signal: controller.signal }
    ).then((views) => {
      if (controller.signal.aborted) return;
      const saved = views.find(({ name, scope }) =>
        scope === "PROJECT_SHARED" && name === positionsProjectTableViewName
      );
      const sortViews = views.filter(({ name, scope }) =>
        scope === "PROJECT_SHARED" && name.startsWith(semanticFolderSortViewPrefix)
      );
      const config = saved?.config ?? defaultPositionsViewConfig;
      const sort = semanticFolderSortFor(undefined, sortViews, config.sort);
      setLayoutView(saved);
      setFolderSortViews(sortViews);
      setViewConfig({ ...config, sort });
      setDraftViewConfig({ ...config, sort });
      setQuery((current) => ({ ...current, sort }));
    }).catch(() => undefined);
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void browserApiRequest<readonly SemanticKeywordGroup[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setGroups(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setGroups([]);
      });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setKeywordLoading(true);
    setKeywordFailure(undefined);
    setKeywords([]);
    setKeywordPage({ hasNext: false });
    setSelectedIds(new Set());
    setFocusedKeywordId(undefined);
    void loadKeywords(projectId, query, undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setKeywords(result.data);
        setKeywordPage(result.page);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (redirectForExpiredSession(error, returnTo)) return;
        setKeywordFailure(failureFrom(error, "Не удалось загрузить текущие позиции."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setKeywordLoading(false);
      });
    return () => controller.abort();
  }, [keywordVersion, projectId, query, returnTo]);

  const loadMoreKeywords = useCallback(async () => {
    if (
      keywordLoadLock.current ||
      keywordLoading ||
      keywordLoadingMore ||
      !keywordPage.hasNext ||
      !keywordPage.nextCursor
    ) return;
    keywordLoadLock.current = true;
    setKeywordLoadingMore(true);
    try {
      const result = await loadKeywords(projectId, query, keywordPage.nextCursor);
      setKeywords((current) => mergeKeywords(current, result.data));
      setKeywordPage(result.page);
      setKeywordFailure(undefined);
    } catch (error) {
      if (!redirectForExpiredSession(error, returnTo)) {
        setKeywordFailure(failureFrom(error, "Не удалось загрузить следующую часть запросов."));
      }
    } finally {
      keywordLoadLock.current = false;
      setKeywordLoadingMore(false);
    }
  }, [keywordLoading, keywordLoadingMore, keywordPage, projectId, query, returnTo]);

  useEffect(() => {
    try {
      setHistoryRequest({
        ...rankHistoryRangeFromDates(
          dateDraftRef.current.fromDate,
          dateDraftRef.current.toDate
        ),
        limit: rankHistoryPageSize
      });
    } catch {
      setHistoryFailure({ message: "Укажите корректный календарный диапазон." });
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    if (!historyRequest || view !== "HISTORY") return () => controller.abort();
    setHistoryLoading(true);
    setHistoryFailure(undefined);
    setHistoryItems([]);
    setHistoryPage({ hasNext: false });
    void loadHistory(projectId, historyRequest, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setHistoryItems(result.data);
        setHistoryPage(result.page);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (redirectForExpiredSession(error, returnTo)) return;
        setHistoryFailure(failureFrom(error, "Не удалось загрузить историю позиций."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [historyRequest, historyVersion, projectId, returnTo, view]);

  const focusedKeyword = useMemo(
    () => keywords.find(({ id }) => id === focusedKeywordId),
    [focusedKeywordId, keywords]
  );

  useEffect(() => {
    const controller = new AbortController();
    if (!focusedKeywordId) {
      setInspectorHistory([]);
      return () => controller.abort();
    }
    setInspectorHistoryLoading(true);
    const range = rankHistoryRangeFromDates(initialDates.fromDate, initialDates.toDate);
    void loadHistory(
      projectId,
      {
        ...range,
        keywordId: focusedKeywordId,
        limit: 30
      },
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) setInspectorHistory(result.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setInspectorHistory([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setInspectorHistoryLoading(false);
      });
    return () => controller.abort();
  }, [focusedKeywordId, initialDates.fromDate, initialDates.toDate, projectId]);

  const loadJobs = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await browserApiRequest<{ readonly jobs: readonly RankJobSummary[] }>(
        rankRunsApiPath(projectId),
        signal ? { signal } : {}
      );
      if (signal?.aborted) return;
      setJobs(result.jobs);
      setJobsFailure(undefined);
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return;
      setJobsFailure(failureFrom(error, "Журнал съёмов временно недоступен."));
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadJobs(controller.signal);
    const timer = window.setInterval(() => void loadJobs(controller.signal), 5_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadJobs]);

  const keywordMap = useMemo(
    () => new Map(keywords.map((keyword) => [keyword.id, keyword])),
    [keywords]
  );
  const visibleGroups = useMemo(() => {
    const normalized = groupSearch.trim().toLocaleLowerCase("ru");
    return [...groups]
      .filter(({ name, path }) => !normalized || `${name} ${path}`.toLocaleLowerCase("ru").includes(normalized))
      .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, "ru"));
  }, [groupSearch, groups]);
  const metrics = useMemo(() => currentMetrics(keywords), [keywords]);
  const pages = useMemo(() => summarizePages(keywords), [keywords]);
  const cannibalizations = useMemo(() => summarizeCannibalization(keywords), [keywords]);
  const activeJob = useMemo(
    () => jobs.filter(isActiveRankJob).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0],
    [jobs]
  );
  const latestJob = useMemo(
    () => [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0],
    [jobs]
  );
  const restriction = positionRestriction(projectStatus, workspaceStatus);

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const search = searchDraft.trim();
    setQuery((current) => {
      if (search) return { ...current, search };
      const { search: ignored, ...rest } = current;
      void ignored;
      return rest;
    });
  }

  function selectGroup(groupId?: string): void {
    const sort = semanticFolderSortFor(groupId, folderSortViews, defaultPositionsViewConfig.sort);
    setQuery((current) => {
      if (groupId) return { ...current, groupId, sort };
      const { groupId: ignored, ...rest } = current;
      void ignored;
      return { ...rest, sort };
    });
    setViewConfig((current) => ({ ...current, sort }));
    setDraftViewConfig((current) => ({ ...current, sort }));
  }

  function toggleKeyword(keywordId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(keywordId)) next.delete(keywordId);
      else next.add(keywordId);
      return next;
    });
  }

  function toggleAllVisible(): void {
    setSelectedIds((current) => {
      const allSelected = keywords.length > 0 && keywords.every(({ id }) => current.has(id));
      return allSelected ? new Set() : new Set(keywords.map(({ id }) => id));
    });
  }

  function applyHistoryFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    try {
      setHistoryFailure(undefined);
      setHistoryRequest({
        ...rankHistoryRangeFromDates(fromDate, toDate),
        limit: rankHistoryPageSize
      });
      setView("HISTORY");
    } catch {
      setHistoryFailure({ message: "Начальная дата не должна быть позже конечной." });
    }
  }

  async function loadMoreHistory(): Promise<void> {
    if (
      historyLoadLock.current ||
      historyLoading ||
      historyLoadingMore ||
      !historyRequest ||
      !historyPage.hasNext ||
      !historyPage.nextCursor
    ) return;
    historyLoadLock.current = true;
    setHistoryLoadingMore(true);
    try {
      const result = await loadHistory(projectId, { ...historyRequest, cursor: historyPage.nextCursor });
      setHistoryItems((current) => mergeRankHistoryItems(current, result.data));
      setHistoryPage(result.page);
    } catch (error) {
      setHistoryFailure(failureFrom(error, "Не удалось продолжить загрузку истории."));
    } finally {
      historyLoadLock.current = false;
      setHistoryLoadingMore(false);
    }
  }

  function exportCurrentRows(): void {
    const selected = selectedIds.size > 0
      ? keywords.filter(({ id }) => selectedIds.has(id))
      : keywords;
    const rows = [
      ["Запрос", "Группа", "Целевая страница", "Яндекс База", 'Яндекс ""', 'Яндекс "!"', "Позиция Яндекс", "Релевантный URL Яндекс", "Позиция Google", "Релевантный URL Google", "Обновлено"],
      ...selected.map((keyword) => [
        keyword.textOriginal,
        keyword.groupPath ?? "",
        keyword.targetUrl ?? "",
        rawFrequencyMetric(keyword, "BASE"),
        rawFrequencyMetric(keyword, "EXACT"),
        rawFrequencyMetric(keyword, "FIXED"),
        positionText(keyword, "YANDEX"),
        currentPosition(keyword, "YANDEX")?.rankingUrl ?? "",
        positionText(keyword, "GOOGLE"),
        currentPosition(keyword, "GOOGLE")?.rankingUrl ?? "",
        keyword.updatedAt
      ])
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `positions-${projectId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function closeScan(): void {
    setScanOpen(false);
    void loadJobs();
  }

  async function changeSort(sort: SemanticKeywordSort): Promise<void> {
    if (savingFolderSort || sort === query.sort) return;
    const previousSort = query.sort;
    const viewName = semanticFolderSortViewName(query.groupId);
    const config: SemanticViewConfig = {
      ...defaultPositionsViewConfig,
      filters: query.groupId ? { groupId: query.groupId } : {},
      sort
    };
    setViewConfig((current) => ({ ...current, sort }));
    setDraftViewConfig((current) => ({ ...current, sort }));
    setQuery((current) => ({ ...current, sort }));
    setSavingFolderSort(true);
    try {
      let currentView = folderSortViews.find(({ name }) => name === viewName);
      let saved: SemanticSavedView;
      try {
        saved = currentView
          ? await browserApiRequest<SemanticSavedView>(
              `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views/${encodeURIComponent(currentView.id)}`,
              { method: "PATCH", ifMatch: currentView.version, body: { config } }
            )
          : await browserApiRequest<SemanticSavedView>(
              `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`,
              { method: "POST", body: { name: viewName, scope: "PROJECT_SHARED", config } }
            );
      } catch (error) {
        if (!(error instanceof BrowserApiError) || ![409, 412].includes(error.status)) throw error;
        const latest = await browserApiRequest<readonly SemanticSavedView[]>(
          `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`
        );
        currentView = latest.find(({ name, scope }) => name === viewName && scope === "PROJECT_SHARED");
        if (!currentView) throw error;
        saved = await browserApiRequest<SemanticSavedView>(
          `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views/${encodeURIComponent(currentView.id)}`,
          { method: "PATCH", ifMatch: currentView.version, body: { config } }
        );
      }
      setFolderSortViews((current) => [...current.filter(({ name }) => name !== saved.name), saved]);
    } catch (error) {
      setViewConfig((current) => ({ ...current, sort: previousSort }));
      setDraftViewConfig((current) => ({ ...current, sort: previousSort }));
      setQuery((current) => ({ ...current, sort: previousSort }));
      setKeywordFailure(failureFrom(error, "Не удалось сохранить сортировку группы."));
    } finally {
      setSavingFolderSort(false);
    }
  }

  function moveDraftColumn(column: SemanticSystemColumn, target: SemanticSystemColumn): void {
    setDraftViewConfig((current) => {
      const columns = current.columns.filter((item): item is SemanticSystemColumn => !item.startsWith("custom:"));
      const from = columns.indexOf(column);
      const to = columns.indexOf(target);
      if (from < 0 || to < 0 || from === to) return current;
      const next = [...columns];
      next.splice(to, 0, next.splice(from, 1)[0]!);
      return { ...current, columns: next };
    });
  }

  function toggleDraftColumn(column: SemanticSystemColumn): void {
    setDraftViewConfig((current) => {
      if (column === "query") return current;
      const enabled = current.columns.includes(column);
      return {
        ...current,
        columns: enabled
          ? current.columns.filter((item) => item !== column)
          : [...current.columns, column]
      };
    });
  }

  async function saveLayout(): Promise<void> {
    if (layoutSaving) return;
    setLayoutSaving(true);
    try {
      const config = { ...draftViewConfig, sort: query.sort };
      const saved = layoutView
        ? await browserApiRequest<SemanticSavedView>(
            `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views/${encodeURIComponent(layoutView.id)}`,
            { method: "PATCH", ifMatch: layoutView.version, body: { config } }
          )
        : await browserApiRequest<SemanticSavedView>(
            `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`,
            { method: "POST", body: { name: positionsProjectTableViewName, scope: "PROJECT_SHARED", config } }
          );
      setLayoutView(saved);
      setViewConfig(config);
    } finally {
      setLayoutSaving(false);
    }
  }

  return (
    <section className={`positions-workspace${focusedKeyword ? " has-inspector" : ""}`}>
      <header className="semantic-core-header positions-titlebar">
        <div className="semantic-title-block positions-title" title={projectName}>
          <h1>Позиции</h1>
          <CustomSelect
            aria-label="Выбрать проект"
            onChange={(event) => {
              if (event.target.value !== projectId) {
                window.location.assign(rankHistoryReturnTo(event.target.value));
              }
            }}
            value={projectId}
          >
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </CustomSelect>
        </div>
        <dl className="semantic-summary positions-summary">
          <Metric label="Запросов" value={formatInteger(keywordPage.totalApprox ?? keywords.length)} />
          <Metric label="В топ-3" value={formatInteger(metrics.top3)} />
          <Metric label="В топ-10" value={formatInteger(metrics.top10)} />
          <Metric label="Видимость" value={`${formatDecimal(metrics.visibility)}%`} />
        </dl>
        <div className="semantic-header-status positions-title-status">
          {activeJob ? (
            <span className="positions-live-status">
              <i aria-hidden="true" /> {rankJobStageLabel(activeJob.stage)} · {formatDecimal(rankJobProgressPercent(activeJob))}%
            </span>
          ) : latestJob ? (
            <span>Обновлено {formatRelativeTime(latestJob.createdAt)}</span>
          ) : (
            <span>Съёмов ещё не было</span>
          )}
        </div>
      </header>

      <nav aria-label="Инструменты позиций" className="semantic-commandbar">
        <button
          disabled={Boolean(restriction) || selectedIds.size === 0}
          onClick={() => setScanOpen(true)}
          title={restriction ?? (selectedIds.size === 0 ? "Выберите запросы в таблице" : undefined)}
          type="button"
        >
          <span aria-hidden="true">◎</span>Запустить съём
        </button>
        <button onClick={() => window.location.assign("/app/semantics")} type="button"><span aria-hidden="true">＋</span>Добавить запросы</button>
        <button onClick={() => document.querySelector<HTMLInputElement>("#positions-group-search")?.focus()} type="button"><span aria-hidden="true">⌘</span>Группы</button>
        <button onClick={() => document.querySelector<HTMLInputElement>("#positions-query-search")?.focus()} type="button"><span aria-hidden="true">≡</span>Фильтры</button>
        <button onClick={() => setView("HISTORY")} type="button"><span aria-hidden="true">▣</span>Сравнить даты</button>
        <button onClick={exportCurrentRows} type="button"><span aria-hidden="true">⇩</span>Экспорт</button>
        <button onClick={() => window.location.assign(`/app/projects/${encodeURIComponent(projectId)}/rankings/automations`)} type="button"><span aria-hidden="true">◷</span>Расписание</button>
        {selectedIds.size > 0 && (
          <div className="semantic-selection-chip" role="status">
            <strong>Выбрано: {selectedIds.size}</strong>
            <button aria-label="Снять выделение" onClick={() => setSelectedIds(new Set())} type="button">×</button>
          </div>
        )}
      </nav>

      {!online && <OverlayNotice tone="warning">Нет соединения. Уже загруженные данные доступны только для чтения.</OverlayNotice>}
      {jobsFailure && <OverlayNotice tone="warning">{jobsFailure.message}</OverlayNotice>}

      <aside className="positions-groups">
        <header><strong>Группы</strong><span>{groups.length}</span></header>
        <label>
          <span className="visually-hidden">Поиск по группам</span>
          <input id="positions-group-search" onChange={(event) => setGroupSearch(event.target.value)} placeholder="Поиск по группам" type="search" value={groupSearch} />
        </label>
        <button aria-current={!query.groupId} className="positions-group-root" onClick={() => selectGroup()} type="button">
          <span>▤</span><strong>Все запросы</strong><small>{formatInteger(keywordPage.totalApprox ?? keywords.length)}</small>
        </button>
        <div className="positions-group-list">
          {visibleGroups.map((group) => (
            <button
              aria-current={query.groupId === group.id}
              key={group.id}
              onClick={() => selectGroup(group.id)}
              style={{ paddingLeft: `${12 + groupDepth(group.path) * 13}px` }}
              title={group.path}
              type="button"
            >
              <i aria-hidden="true" style={{ background: group.color ?? "#8d7dff" }} />
              <span>{group.name}</span>
              <small>{formatInteger(group.keywordCount)}</small>
            </button>
          ))}
          {visibleGroups.length === 0 && <p>Группы не найдены</p>}
        </div>
      </aside>

      <main className="positions-main">
        <div className="positions-viewbar">
          <span className="positions-last-scan">
            {latestJob ? `Последний съём: ${formatDateTime(latestJob.createdAt)}` : "Съёмов пока нет"}
          </span>
          <div className="positions-view-tabs" role="tablist" aria-label="Представление позиций">
            <ViewButton active={view === "TABLE"} label="Таблица" onClick={() => setView("TABLE")} />
            <ViewButton active={view === "HISTORY"} label="Динамика" onClick={() => setView("HISTORY")} />
            <ViewButton active={view === "PAGES"} label="Страницы" onClick={() => setView("PAGES")} />
            <ViewButton active={view === "CANNIBALIZATION"} label="Каннибализация" onClick={() => setView("CANNIBALIZATION")} />
          </div>
          <form className="positions-search" onSubmit={submitSearch}>
            <input id="positions-query-search" onChange={(event) => setSearchDraft(event.target.value)} placeholder="Поиск по запросам" type="search" value={searchDraft} />
            <button className="secondary-button" type="submit">Найти</button>
          </form>
          {view === "TABLE" && (
            <details className="semantic-column-picker positions-column-picker" data-exclusive-dropdown>
              <summary>Колонки и плотность</summary>
              <div className="semantic-column-picker-menu">
                <p>Порядок сохраняется для всего проекта.</p>
                <div className="semantic-column-order" aria-label="Порядок колонок позиций">
                  {draftViewConfig.columns
                    .filter((column): column is SemanticSystemColumn => !column.startsWith("custom:"))
                    .map((column) => (
                      <div
                        draggable
                        key={column}
                        onDragEnd={() => setDraggedColumn(undefined)}
                        onDragOver={(event) => event.preventDefault()}
                        onDragStart={() => setDraggedColumn(column)}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedColumn) moveDraftColumn(draggedColumn, column);
                          setDraggedColumn(undefined);
                        }}
                      >
                        <span aria-hidden="true" className="semantic-column-grip">⋮⋮</span>
                        <label>
                          <input checked disabled={column === "query"} onChange={() => toggleDraftColumn(column)} type="checkbox" />
                          <span>{positionColumnLabel(column)}</span>
                        </label>
                      </div>
                    ))}
                </div>
                <div className="semantic-column-available">
                  {positionColumns
                    .filter(({ key }) => !draftViewConfig.columns.includes(key))
                    .map(({ key, label }) => (
                      <label key={key}>
                        <input checked={false} onChange={() => toggleDraftColumn(key)} type="checkbox" />
                        <span>{label}</span>
                      </label>
                    ))}
                </div>
                <label>
                  <span>Плотность</span>
                  <CustomSelect
                    onChange={(event) => setDraftViewConfig((current) => ({
                      ...current,
                      density: event.target.value as SemanticViewConfig["density"]
                    }))}
                    value={draftViewConfig.density}
                  >
                    <option value="COMFORTABLE">Обычная</option>
                    <option value="COMPACT">Компактная</option>
                  </CustomSelect>
                </label>
                <button className="secondary-button" disabled={layoutSaving} onClick={() => void saveLayout()} type="button">
                  {layoutSaving ? "Сохраняем…" : "Применить для проекта"}
                </button>
              </div>
            </details>
          )}
        </div>

        {restriction && <div className="positions-inline-note warning">{restriction}</div>}
        {keywordFailure && (
          <FailureNotice failure={keywordFailure} onRetry={() => setKeywordVersion((value) => value + 1)} />
        )}

        {view === "TABLE" && (
          <CurrentPositionsTable
            columns={viewConfig.columns.filter((column): column is SemanticSystemColumn => !column.startsWith("custom:"))}
            density={viewConfig.density}
            focusedKeywordId={focusedKeywordId}
            keywords={keywords}
            loading={keywordLoading}
            onFocus={setFocusedKeywordId}
            onNearEnd={() => void loadMoreKeywords()}
            onSort={(sort) => void changeSort(sort)}
            onToggle={toggleKeyword}
            onToggleAll={toggleAllVisible}
            selectedIds={selectedIds}
            sort={query.sort}
          />
        )}
        {view === "HISTORY" && (
          <HistoryView
            failure={historyFailure}
            fromDate={fromDate}
            items={historyItems}
            keywordMap={keywordMap}
            loading={historyLoading}
            loadingMore={historyLoadingMore}
            onFromDateChange={setFromDate}
            onLoadMore={() => void loadMoreHistory()}
            onRetry={() => setHistoryVersion((value) => value + 1)}
            onSubmit={applyHistoryFilters}
            onToDateChange={setToDate}
            page={historyPage}
            toDate={toDate}
          />
        )}
        {view === "PAGES" && <PagesView pages={pages} />}
        {view === "CANNIBALIZATION" && <CannibalizationView rows={cannibalizations} />}

        {view === "TABLE" && (
          <footer className="positions-table-footer">
            <span>Показано {formatInteger(keywords.length)}{keywordPage.totalApprox ? ` из ~${formatInteger(keywordPage.totalApprox)}` : ""}</span>
            <span>{keywordLoadingMore ? "Загружаем следующую часть…" : keywordPage.hasNext ? "Прокрутите ниже для продолжения" : "Все доступные строки загружены"}</span>
          </footer>
        )}
      </main>

      {focusedKeyword && (
        <KeywordInspector
          history={inspectorHistory}
          historyLoading={inspectorHistoryLoading}
          keyword={focusedKeyword}
          onClose={() => setFocusedKeywordId(undefined)}
        />
      )}

      {scanOpen && (
        <SemanticPositionDialog
          activeGroupId={query.groupId}
          groups={groups}
          initialSelections={keywords
            .filter(({ id }) => selectedIds.has(id))
            .map(({ id, version, textOriginal }) => ({
              id,
              version,
              label: textOriginal
            }))}
          onClose={closeScan}
          onStarted={(job) => {
            setScanOpen(false);
            setJobs((current) => [job, ...current.filter(({ id }) => id !== job.id)]);
            void loadJobs();
          }}
          projectId={projectId}
        />
      )}
    </section>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function ViewButton({ active, label, onClick }: Readonly<{ active: boolean; label: string; onClick: () => void }>) {
  return <button aria-selected={active} className={active ? "active" : undefined} onClick={onClick} role="tab" type="button">{label}</button>;
}

function OverlayNotice({ children, tone }: Readonly<{ children: string; tone: "warning" | "danger" }>) {
  return <div className={`positions-overlay-notice ${tone}`} role="status"><span aria-hidden="true">!</span>{children}</div>;
}

function FailureNotice({ failure, onRetry }: Readonly<{ failure: PositionsFailure; onRetry: () => void }>) {
  return (
    <div className="positions-inline-note danger" role="alert">
      <span>{failure.message}{failure.requestId && <small>Request ID: {failure.requestId}</small>}</span>
      <button onClick={onRetry} type="button">Повторить</button>
    </div>
  );
}

const positionColumns: readonly Readonly<{ key: SemanticSystemColumn; label: string }>[] = [
  { key: "query", label: "Запрос" },
  { key: "group", label: "Группа" },
  { key: "cluster", label: "Кластер" },
  { key: "frequency", label: "База" },
  { key: "frequencyExact", label: '""' },
  { key: "frequencyFixed", label: '"!"' },
  { key: "wordCount", label: "WS" },
  { key: "yandexPosition", label: "Позиция Яндекс" },
  { key: "yandexRelevantUrl", label: "Релевантный URL Яндекс" },
  { key: "googlePosition", label: "Позиция Google" },
  { key: "googleRelevantUrl", label: "Релевантный URL Google" },
  { key: "visibility", label: "Видимость" },
  { key: "targetUrl", label: "Целевая страница" },
  { key: "tags", label: "Теги" },
  { key: "intent", label: "Интент" },
  { key: "priority", label: "Приоритет" },
  { key: "source", label: "Источник" },
  { key: "updatedAt", label: "Обновлено" }
];

function positionColumnLabel(column: SemanticSystemColumn): string {
  return positionColumns.find(({ key }) => key === column)?.label ?? column;
}

function positionColumnHeader(column: SemanticSystemColumn) {
  if (column === "frequency" || column === "frequencyExact" || column === "frequencyFixed") {
    const label = column === "frequency" ? "База" : column === "frequencyExact" ? '""' : '"!"';
    return <span className="positions-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> {label}</span>;
  }
  if (column === "yandexPosition" || column === "yandexRelevantUrl") {
    return <span className="positions-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> {column === "yandexPosition" ? "Позиция" : "URL"}</span>;
  }
  if (column === "googlePosition" || column === "googleRelevantUrl") {
    return <span className="positions-engine-header"><SearchEngineLogo engine="GOOGLE" size="compact" /> {column === "googlePosition" ? "Позиция" : "URL"}</span>;
  }
  return positionColumnLabel(column);
}

function nextPositionColumnSort(
  column: SemanticSystemColumn,
  current: SemanticKeywordSort
): SemanticKeywordSort | undefined {
  switch (column) {
    case "query": return current === "TEXT_ASC" ? "TEXT_DESC" : "TEXT_ASC";
    case "frequency": return current === "FREQUENCY_BASE_DESC" ? "FREQUENCY_BASE_ASC" : "FREQUENCY_BASE_DESC";
    case "frequencyExact": return current === "FREQUENCY_EXACT_DESC" ? "FREQUENCY_EXACT_ASC" : "FREQUENCY_EXACT_DESC";
    case "frequencyFixed": return current === "FREQUENCY_FIXED_DESC" ? "FREQUENCY_FIXED_ASC" : "FREQUENCY_FIXED_DESC";
    case "yandexPosition": return current === "YANDEX_POSITION_ASC" ? "YANDEX_POSITION_DESC" : "YANDEX_POSITION_ASC";
    case "googlePosition": return current === "GOOGLE_POSITION_ASC" ? "GOOGLE_POSITION_DESC" : "GOOGLE_POSITION_ASC";
    case "priority": return current === "PRIORITY_DESC" ? "PRIORITY_ASC" : "PRIORITY_DESC";
    case "source": return current === "SOURCE_ASC" ? "SOURCE_DESC" : "SOURCE_ASC";
    case "updatedAt": return current === "UPDATED_DESC" ? "UPDATED_ASC" : "UPDATED_DESC";
    default: return undefined;
  }
}

function positionColumnSortDirection(
  column: SemanticSystemColumn,
  current: SemanticKeywordSort
): "ascending" | "descending" | undefined {
  const active =
    (column === "query" && current.startsWith("TEXT_")) ||
    (column === "frequency" && current.startsWith("FREQUENCY_BASE_")) ||
    (column === "frequencyExact" && current.startsWith("FREQUENCY_EXACT_")) ||
    (column === "frequencyFixed" && current.startsWith("FREQUENCY_FIXED_")) ||
    (column === "yandexPosition" && current.startsWith("YANDEX_POSITION_")) ||
    (column === "googlePosition" && current.startsWith("GOOGLE_POSITION_")) ||
    (column === "priority" && current.startsWith("PRIORITY_")) ||
    (column === "source" && current.startsWith("SOURCE_")) ||
    (column === "updatedAt" && current.startsWith("UPDATED_"));
  return active ? (current.endsWith("_ASC") ? "ascending" : "descending") : undefined;
}

function positionColumnCell(keyword: SemanticKeywordListItem, column: SemanticSystemColumn) {
  switch (column) {
    case "query":
      return <><strong>{keyword.textOriginal}</strong><small>{keyword.language.toUpperCase()} · {keyword.isTracked ? "отслеживается" : "не назначен"}</small></>;
    case "group": return <span title={keyword.groupPath}>{keyword.groupPath ?? "—"}</span>;
    case "cluster": return keyword.clusterName ?? "—";
    case "frequency": return frequencyMetric(keyword, "BASE");
    case "frequencyExact": return frequencyMetric(keyword, "EXACT");
    case "frequencyFixed": return frequencyMetric(keyword, "FIXED");
    case "wordCount": return keyword.textOriginal.trim().split(/\s+/u).filter(Boolean).length;
    case "yandexPosition": return <SearchPosition engine="YANDEX" position={currentPosition(keyword, "YANDEX")} />;
    case "googlePosition": return <SearchPosition engine="GOOGLE" position={currentPosition(keyword, "GOOGLE")} />;
    case "yandexRelevantUrl": return relevantUrlCell(keyword, "YANDEX");
    case "googleRelevantUrl": return relevantUrlCell(keyword, "GOOGLE");
    case "visibility": return `${formatDecimal(keywordVisibility(keyword))}%`;
    case "targetUrl": return keyword.targetUrl ? <a href={keyword.targetUrl} onClick={(event) => event.stopPropagation()} rel="noreferrer noopener" target="_blank" title={keyword.targetUrl}>{compactUrl(keyword.targetUrl)}</a> : <span className="positions-missing-url">Нет страницы</span>;
    case "tags": return keyword.tags.length > 0 ? keyword.tags.join(", ") : "—";
    case "intent": return intentLabel(keyword.intent);
    case "priority": return `P${keyword.priority}`;
    case "source": return sourceLabel(keyword.sourceMode);
    case "updatedAt": return formatRelativeTime(latestObservedAt(keyword) ?? keyword.updatedAt);
  }
}

function frequencyMetric(keyword: SemanticKeywordListItem, type: "BASE" | "EXACT" | "FIXED") {
  const value = rawFrequencyMetric(keyword, type);
  return value ? formatMetricInteger(value) : "—";
}

function rawFrequencyMetric(keyword: SemanticKeywordListItem, type: "BASE" | "EXACT" | "FIXED"): string {
  return keyword.frequencies?.find((entry) => entry.type === type)?.value ??
    (type === "BASE" ? keyword.frequency?.value : undefined) ?? "";
}

function relevantUrlCell(keyword: SemanticKeywordListItem, engine: "GOOGLE" | "YANDEX") {
  const url = currentPosition(keyword, engine)?.rankingUrl;
  const presentation = url ? externalPageUrlPresentation(url) : undefined;
  return presentation ? <a href={presentation.href} onClick={(event) => event.stopPropagation()} rel="noreferrer noopener" target="_blank" title={presentation.href}>{presentation.label}</a> : "—";
}

function CurrentPositionsTable({
  columns,
  density,
  focusedKeywordId,
  keywords,
  loading,
  onFocus,
  onNearEnd,
  onSort,
  onToggle,
  onToggleAll,
  selectedIds,
  sort
}: Readonly<{
  columns: readonly SemanticSystemColumn[];
  density: SemanticViewConfig["density"];
  focusedKeywordId: string | undefined;
  keywords: readonly SemanticKeywordListItem[];
  loading: boolean;
  onFocus: (keywordId: string) => void;
  onNearEnd: () => void;
  onSort: (sort: SemanticKeywordSort) => void;
  onToggle: (keywordId: string) => void;
  onToggleAll: () => void;
  selectedIds: ReadonlySet<string>;
  sort: SemanticKeywordSort;
}>) {
  if (loading && keywords.length === 0) return <WorkspaceLoading label="Загружаем текущие позиции…" />;
  if (keywords.length === 0) {
    return (
      <div className="positions-empty">
        <span aria-hidden="true">↗</span>
        <strong>В проекте пока нет запросов</strong>
        <p>Добавьте семантику, выберите запросы и запустите съём. Параметры поисковой системы, региона и устройства задаются при каждом запуске.</p>
        <a className="primary-button" href="/app/semantics">Открыть семантику</a>
      </div>
    );
  }
  const gridColumns = columns.map((column): KeywordDataGridColumn<SemanticKeywordListItem> => {
    const nextSort = nextPositionColumnSort(column, sort);
    const direction = positionColumnSortDirection(column, sort);
    return {
      key: column,
      ariaSort: direction,
      cellClassName: `semantic-column-${column}`,
      header: nextSort ? (
        <button className={direction ? "active" : undefined} onClick={() => onSort(nextSort)} type="button">
          {positionColumnHeader(column)}
          <i aria-hidden="true">{direction === "ascending" ? "↑" : direction === "descending" ? "↓" : "↕"}</i>
        </button>
      ) : positionColumnHeader(column),
      cell: (keyword) => positionColumnCell(keyword, column)
    };
  });
  return (
    <div
      className="positions-table-wrap"
      role="region"
      aria-label="Текущие позиции. Доступна горизонтальная прокрутка."
      onScroll={(event) => {
        const target = event.currentTarget;
        if (target.scrollHeight - target.scrollTop - target.clientHeight < 260) onNearEnd();
      }}
      tabIndex={0}
    >
      <KeywordDataGrid
        ariaLabel="Текущие позиции запросов"
        columns={gridColumns}
        density={density}
        focusedId={focusedKeywordId}
        onRowClick={(keyword) => onFocus(keyword.id)}
        onToggleAll={onToggleAll}
        onToggleRow={(keyword) => onToggle(keyword.id)}
        rows={keywords}
        selectedIds={selectedIds}
        tableClassName="semantic-table"
      />
    </div>
  );
}

function SearchPosition({ engine, position }: Readonly<{ engine: "GOOGLE" | "YANDEX"; position: SemanticKeywordListItem["positions"] extends readonly (infer Item)[] | undefined ? Item | undefined : never }>) {
  if (!position || !position.found) return <span className="positions-not-found">—</span>;
  const delta = position.previousPosition === undefined || position.position === undefined
    ? undefined
    : position.previousPosition - position.position;
  return (
    <span className={`positions-engine-position${delta && delta > 0 ? " improved" : delta && delta < 0 ? " declined" : ""}`}>
      <SearchEngineLogo engine={engine} size="compact" />
      <strong>{position.position}</strong>
      {position.previousPosition !== undefined && (
        <small title={`Предыдущая позиция: ${position.previousPosition}`}>было {position.previousPosition}</small>
      )}
    </span>
  );
}

function PositionDelta({ position }: Readonly<{ position: ReturnType<typeof currentPosition> }>) {
  if (!position?.found || position.previousPosition === undefined || position.position === undefined) return <span className="positions-flat">—</span>;
  const delta = position.previousPosition - position.position;
  if (delta === 0) return <span className="positions-flat">без изменений</span>;
  return <span className={delta > 0 ? "positions-up" : "positions-down"}>{delta > 0 ? "Выросла" : "Упала"} на {Math.abs(delta)}</span>;
}

function HistoryView({
  failure,
  fromDate,
  items,
  keywordMap,
  loading,
  loadingMore,
  onFromDateChange,
  onLoadMore,
  onRetry,
  onSubmit,
  onToDateChange,
  page,
  toDate
}: Readonly<{
  failure: PositionsFailure | undefined;
  fromDate: string;
  items: readonly RankHistoryItem[];
  keywordMap: ReadonlyMap<string, SemanticKeywordListItem>;
  loading: boolean;
  loadingMore: boolean;
  onFromDateChange: (value: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToDateChange: (value: string) => void;
  page: BrowserCursorPage;
  toDate: string;
}>) {
  return (
    <section className="positions-history-view">
      <form className="positions-history-filters" onSubmit={onSubmit}>
        <label><span>С даты</span><input onChange={(event) => onFromDateChange(event.target.value)} type="date" value={fromDate} /></label>
        <label><span>По дату</span><input onChange={(event) => onToDateChange(event.target.value)} type="date" value={toDate} /></label>
        <button className="primary-button" type="submit">Применить</button>
      </form>
      {failure && <FailureNotice failure={failure} onRetry={onRetry} />}
      {loading && items.length === 0 ? <WorkspaceLoading label="Загружаем историю снимков…" /> : items.length === 0 ? (
        <div className="positions-empty compact"><span aria-hidden="true">◷</span><strong>В выбранном периоде снимков нет</strong><p>Запустите первый съём или выберите другой период. Пустая история не считается ошибкой провайдера.</p></div>
      ) : (
        <>
          <HistoryChart items={items} />
          <div className="positions-table-wrap history">
            <table className="positions-table">
              <thead><tr><th>Дата и время, UTC</th><th>Запрос</th><th>Позиция</th><th>Страница</th><th>Источник</th><th>Качество</th></tr></thead>
              <tbody>{items.map((item) => <tr key={item.snapshotId}><td>{formatDateTime(item.observedAt)}</td><td><strong>{keywordMap.get(item.keywordId)?.textOriginal ?? `Запрос ${shortId(item.keywordId)}`}</strong></td><td>{item.found ? `№ ${item.position}` : "Не найден"}</td><td>{item.found ? <a href={item.rankingUrl} rel="noreferrer noopener" target="_blank">{compactUrl(item.rankingUrl)}</a> : "—"}</td><td><span className="provider-inline"><ProviderLogo provider={item.provider} size="compact" /> {item.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin"}</span></td><td>{item.dataQualityFlags.length === 0 ? <span className="positions-up">Полные данные</span> : `${item.dataQualityFlags.length} предупрежд.`}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="positions-history-footer"><span>Показано {formatInteger(items.length)}</span>{page.hasNext && <button className="secondary-button" disabled={loadingMore} onClick={onLoadMore} type="button">{loadingMore ? "Загружаем…" : "Показать ещё"}</button>}</div>
        </>
      )}
    </section>
  );
}

function HistoryChart({ items }: Readonly<{ items: readonly RankHistoryItem[] }>) {
  const points = chartPoints(items);
  if (points.length < 2) return null;
  return (
    <div className="positions-history-chart" aria-label="Динамика средней позиции">
      <header><div><strong>Динамика средней позиции</strong><span>Чем выше линия, тем лучше позиция</span></div><span>{points.length} снимков</span></header>
      <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 30"><polyline fill="none" points={points.map(({ x, y }) => `${x},${y}`).join(" ")} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" /></svg>
    </div>
  );
}

function PagesView({ pages }: Readonly<{ pages: readonly TargetPageSummary[] }>) {
  if (pages.length === 0) return <div className="positions-empty compact"><span aria-hidden="true">↗</span><strong>Посадочные страницы не назначены</strong><p>Назначьте целевые URL в семантике, чтобы оценивать распределение запросов по страницам.</p></div>;
  return <div className="positions-page-grid">{pages.map((page) => <article key={page.url}><div><strong>{page.missing ? "Без целевой страницы" : compactUrl(page.url)}</strong><span>{formatInteger(page.keywordCount)} запросов</span></div><dl><div><dt>Лучшая позиция</dt><dd>{page.bestPosition ? `№ ${page.bestPosition}` : "—"}</dd></div><div><dt>Статус</dt><dd>{page.missing ? "Требует внимания" : "Назначена"}</dd></div></dl>{!page.missing && <a href={page.url} rel="noreferrer noopener" target="_blank">Открыть страницу ↗</a>}</article>)}</div>;
}

function CannibalizationView({ rows }: Readonly<{ rows: readonly CannibalizationSummary[] }>) {
  if (rows.length === 0) return <div className="positions-empty compact"><span aria-hidden="true">✓</span><strong>Конфликтов в загруженной выборке нет</strong><p>Каннибализация показывается только когда один кластер связан более чем с одной целевой страницей.</p></div>;
  return <div className="positions-cannibalization-list">{rows.map((row) => <article key={row.cluster}><header><div><strong>{row.cluster}</strong><span>{row.keywordCount} запросов · {row.urls.length} страниц</span></div><b>Конфликт</b></header><ul>{row.urls.map((url) => <li key={url}><a href={url} rel="noreferrer noopener" target="_blank">{compactUrl(url)}</a></li>)}</ul></article>)}</div>;
}

function KeywordInspector({ history, historyLoading, keyword, onClose }: Readonly<{ history: readonly RankHistoryItem[]; historyLoading: boolean; keyword: SemanticKeywordListItem; onClose: () => void }>) {
  const yandex = currentPosition(keyword, "YANDEX");
  const google = currentPosition(keyword, "GOOGLE");
  return (
    <aside className="positions-inspector">
      <header><div><span>Запрос</span><strong>{keyword.textOriginal}</strong><small>ID: {shortId(keyword.id)}</small></div><div><a href="/app/semantics">Изменить</a><button aria-label="Закрыть информацию о запросе" onClick={onClose} type="button">×</button></div></header>
      <section><h2>Текущие позиции</h2><div className="positions-current-cards"><div><span><SearchEngineLogo engine="YANDEX" size="compact" /> Яндекс</span><strong>{yandex?.found ? yandex.position : "—"}</strong><PositionDelta position={yandex} /></div><div><span><SearchEngineLogo engine="GOOGLE" size="compact" /> Google</span><strong>{google?.found ? google.position : "—"}</strong><PositionDelta position={google} /></div></div></section>
      <section><h2>Динамика за 30 дней</h2>{historyLoading ? <span className="positions-inspector-muted">Загружаем…</span> : history.length > 1 ? <MiniHistoryChart items={history} /> : <span className="positions-inspector-muted">Недостаточно снимков для графика</span>}</section>
      <section>
        <h2>Частотность</h2>
        <dl>
          <div><dt><span className="provider-inline"><SearchEngineLogo engine="YANDEX" size="compact" /> База</span></dt><dd>{frequencyMetric(keyword, "BASE")}</dd></div>
          <div><dt><span className="provider-inline"><SearchEngineLogo engine="YANDEX" size="compact" /> &quot;&quot;</span></dt><dd>{frequencyMetric(keyword, "EXACT")}</dd></div>
          <div><dt><span className="provider-inline"><SearchEngineLogo engine="YANDEX" size="compact" /> &quot;!&quot;</span></dt><dd>{frequencyMetric(keyword, "FIXED")}</dd></div>
        </dl>
      </section>
      <section><h2>Семантика</h2><dl><div><dt>Группа</dt><dd>{keyword.groupPath ?? "Без группы"}</dd></div><div><dt>Кластер</dt><dd>{keyword.clusterName ?? "Не назначен"}</dd></div><div><dt>Интент</dt><dd>{intentLabel(keyword.intent)}</dd></div></dl></section>
      <section>
        <h2>Релевантные URL</h2>
        <dl>
          <div><dt><span className="provider-inline"><SearchEngineLogo engine="YANDEX" size="compact" /> Яндекс</span></dt><dd>{positionRelevantUrl(yandex)}</dd></div>
          <div><dt><span className="provider-inline"><SearchEngineLogo engine="GOOGLE" size="compact" /> Google</span></dt><dd>{positionRelevantUrl(google)}</dd></div>
        </dl>
      </section>
      <section><h2>Целевая страница</h2>{keyword.targetUrl ? <a className="positions-inspector-url" href={keyword.targetUrl} rel="noreferrer noopener" target="_blank">{keyword.targetUrl} ↗</a> : <span className="positions-inspector-muted">Не назначена</span>}</section>
      <section><h2>Теги</h2><div className="positions-tags">{keyword.tags.length ? keyword.tags.map((tag) => <span key={tag}>{tag}</span>) : <span>Нет тегов</span>}</div></section>
      <section><h2>Источник и даты</h2><dl><div><dt>Источник</dt><dd>{sourceLabel(keyword.sourceMode)}</dd></div><div><dt>Создан</dt><dd>{formatDateTime(keyword.createdAt)}</dd></div><div><dt>Обновлён</dt><dd>{formatDateTime(keyword.updatedAt)}</dd></div></dl></section>
    </aside>
  );
}

function MiniHistoryChart({ items }: Readonly<{ items: readonly RankHistoryItem[] }>) {
  const points = chartPoints(items);
  return <svg aria-label="Динамика позиции" className="positions-mini-chart" preserveAspectRatio="none" viewBox="0 0 100 28"><polyline fill="none" points={points.map(({ x, y }) => `${x},${y}`).join(" ")} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}

function WorkspaceLoading({ label }: Readonly<{ label: string }>) {
  return <div className="positions-loading" role="status"><span className="spinner" aria-hidden="true" /><strong>{label}</strong></div>;
}

async function loadKeywords(projectId: string, query: KeywordQuery, cursor?: string, signal?: AbortSignal) {
  const search = new URLSearchParams({ limit: String(keywordPageSize), sort: query.sort });
  if (query.groupId) search.set("groupId", query.groupId);
  if (query.search) search.set("search", query.search);
  if (cursor) search.set("cursor", cursor);
  return browserApiCollectionRequest<SemanticKeywordListItem>(
    `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${search.toString()}`,
    signal ? { signal } : {}
  );
}

async function loadHistory(projectId: string, request: RankHistoryRequest, signal?: AbortSignal) {
  const collection = await browserApiCollectionRequest<unknown>(rankHistoryApiPath(projectId, request), signal ? { signal } : {});
  return parseRankHistoryCollection(collection);
}

function mergeKeywords(current: readonly SemanticKeywordListItem[], next: readonly SemanticKeywordListItem[]): readonly SemanticKeywordListItem[] {
  const ids = new Set(current.map(({ id }) => id));
  return [...current, ...next.filter(({ id }) => !ids.has(id))];
}

function currentPosition(keyword: SemanticKeywordListItem, engine: "GOOGLE" | "YANDEX") {
  return keyword.positions?.find((position) => position.searchEngine === engine);
}

function positionRelevantUrl(position: ReturnType<typeof currentPosition>) {
  if (!position?.rankingUrl) return <span className="positions-inspector-muted">Не найден</span>;
  return <a href={position.rankingUrl} rel="noreferrer noopener" target="_blank" title={position.rankingUrl}>{compactUrl(position.rankingUrl)} ↗</a>;
}

function positionText(keyword: SemanticKeywordListItem, engine: "GOOGLE" | "YANDEX"): string {
  const position = currentPosition(keyword, engine);
  return position?.found && position.position !== undefined ? String(position.position) : "";
}

function latestObservedAt(keyword: SemanticKeywordListItem): string | undefined {
  const values = keyword.positions?.map(({ observedAt }) => observedAt) ?? [];
  return values.sort().at(-1);
}

function keywordVisibility(keyword: SemanticKeywordListItem): number {
  const found = keyword.positions?.filter((position) => position.found && position.position !== undefined) ?? [];
  if (found.length === 0) return 0;
  return found.reduce((sum, position) => sum + Math.max(0, 101 - (position.position ?? 101)), 0) / found.length;
}

function currentMetrics(keywords: readonly SemanticKeywordListItem[]) {
  const positions = keywords.flatMap((keyword) => keyword.positions?.filter((item) => item.found && item.position !== undefined) ?? []);
  return {
    top3: keywords.filter((keyword) => keyword.positions?.some(({ found, position }) => found && (position ?? 101) <= 3)).length,
    top10: keywords.filter((keyword) => keyword.positions?.some(({ found, position }) => found && (position ?? 101) <= 10)).length,
    visibility: positions.length === 0 ? 0 : positions.reduce((sum, item) => sum + Math.max(0, 101 - (item.position ?? 101)), 0) / positions.length
  };
}

function summarizePages(keywords: readonly SemanticKeywordListItem[]): readonly TargetPageSummary[] {
  const map = new Map<string, { count: number; best?: number; missing: boolean }>();
  for (const keyword of keywords) {
    const url = keyword.targetUrl ?? "__missing__";
    const positions = keyword.positions?.filter(({ found, position }) => found && position !== undefined).map(({ position }) => position as number) ?? [];
    const current = map.get(url) ?? { count: 0, missing: url === "__missing__" };
    const best = positions.length ? Math.min(...positions) : undefined;
    map.set(url, { count: current.count + 1, missing: current.missing, ...(best !== undefined || current.best !== undefined ? { best: Math.min(best ?? Number.POSITIVE_INFINITY, current.best ?? Number.POSITIVE_INFINITY) } : {}) });
  }
  return [...map.entries()].map(([url, value]) => ({ url, keywordCount: value.count, missing: value.missing, ...(value.best !== undefined && Number.isFinite(value.best) ? { bestPosition: value.best } : {}) })).sort((left, right) => right.keywordCount - left.keywordCount);
}

function summarizeCannibalization(keywords: readonly SemanticKeywordListItem[]): readonly CannibalizationSummary[] {
  const clusters = new Map<string, { keywords: Set<string>; urls: Set<string> }>();
  for (const keyword of keywords) {
    if (!keyword.clusterName || !keyword.targetUrl) continue;
    const current = clusters.get(keyword.clusterName) ?? { keywords: new Set<string>(), urls: new Set<string>() };
    current.keywords.add(keyword.id);
    current.urls.add(keyword.targetUrl);
    clusters.set(keyword.clusterName, current);
  }
  return [...clusters.entries()].filter(([, value]) => value.urls.size > 1).map(([cluster, value]) => ({ cluster, keywordCount: value.keywords.size, urls: [...value.urls] })).sort((left, right) => right.keywordCount - left.keywordCount);
}

function chartPoints(items: readonly RankHistoryItem[]) {
  const ordered = [...items].reverse().filter((item): item is Extract<RankHistoryItem, { found: true }> => item.found);
  if (ordered.length === 0) return [];
  const max = Math.max(100, ...ordered.map(({ position }) => position));
  return ordered.map((item, index) => ({ x: ordered.length === 1 ? 50 : (index / (ordered.length - 1)) * 100, y: Math.min(28, Math.max(2, (item.position / max) * 26)) }));
}

function groupDepth(path: string): number {
  return Math.max(0, path.split(" / ").length - 1);
}

function intentLabel(intent: SemanticKeywordListItem["intent"]): string {
  const labels = { INFORMATIONAL: "Информационный", NAVIGATIONAL: "Навигационный", COMMERCIAL: "Коммерческий", TRANSACTIONAL: "Транзакционный", LOCAL: "Локальный", MIXED: "Смешанный" } as const;
  return intent ? labels[intent] : "Не задан";
}

function sourceLabel(source: SemanticKeywordListItem["sourceMode"]): string {
  return { BYOK: "API проекта", PLATFORM: "API платформы", IMPORT: "Импорт", MANUAL: "Вручную" }[source];
}

function positionRestriction(projectStatus: "DRAFT" | "ACTIVE" | "ARCHIVED", workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED"): string | undefined {
  if (projectStatus === "ARCHIVED") return "Архивный проект доступен только для чтения.";
  if (workspaceStatus === "READ_ONLY") return "Рабочая область доступна только для чтения.";
  if (workspaceStatus === "SUSPENDED") return "Рабочая область приостановлена.";
  return undefined;
}

function failureFrom(error: unknown, fallback: string): PositionsFailure {
  if (error instanceof BrowserApiError) {
    return { message: error.message || fallback, ...(error.requestId ? { requestId: error.requestId } : {}) };
  }
  return { message: navigator.onLine ? fallback : "Нет соединения с сервером." };
}

function redirectForExpiredSession(error: unknown, returnTo: string): boolean {
  if (!(error instanceof BrowserApiError) || error.status !== 401) return false;
  window.location.assign(`/app/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`);
  return true;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(date);
}

function formatRelativeTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)} ч назад`;
  return formatDateTime(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatMetricInteger(value: string): string {
  try {
    return new Intl.NumberFormat("ru-RU").format(BigInt(value));
  } catch {
    return value;
  }
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}
