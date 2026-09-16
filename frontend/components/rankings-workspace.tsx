"use client";

import {
  parseRankPositionReport,
  parseSemanticRankDimensionCatalog,
  type ProjectSearchCity,
  type RankPositionReport,
  type RankPositionReportCell,
  type SemanticKeywordGroup,
  type SemanticRankDimension
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { browserApiRequest } from "../lib/browser-api";
import { rankDimensionLabel } from "../lib/rank-dimension-presentation";
import { sameSemanticRankingUrl } from "../lib/semantic-rank-presentation";
import {
  clampQueryColumnWidth,
  rankingsQueryColumnDefaultWidth,
  rankingsQueryColumnMaxWidth,
  rankingsQueryColumnMinWidth,
  readRankingsPreferences,
  writeRankingsPreferences
} from "../lib/rankings-preferences";
import { SemanticKeywordPositionHistoryModal } from "./semantic-keyword-position-history-modal";
import { SemanticKeywordSerpHistory } from "./semantic-keyword-serp-history";
import { SemanticKeywordAiPositionHistoryModal } from "./semantic-keyword-ai-position-history-modal";
import { SemanticModal } from "./semantic-modal";
import { SemanticPositionDialog } from "./semantic-position-dialog";
import { SemanticAiAnswerDialog } from "./semantic-ai-answer-dialog";
import { SemanticRankContext } from "./semantic-rank-context";
import { SemanticGroupPickerField } from "./semantic-group-picker";
import { CustomDateRangePicker } from "./custom-date-range-picker";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { DuplicateFrequency } from "./semantic-duplicates-dialog";
import { UiText, useUiLocale } from "./ui-locale";

type ReportState = Readonly<{
  report?: RankPositionReport;
  loading: boolean;
  loadingMore: boolean;
  error?: string;
}>;

interface HistorySelection {
  readonly createdAt: string;
  readonly initialObservedAt?: string;
  readonly initialSiteResultsSnapshotId?: string;
  readonly keywordId: string;
  readonly keywordText: string;
  readonly showUrlComparison?: boolean;
  readonly targetUrl?: string;
}

export function RankingsWorkspace({
  currentUserId,
  projectDomain,
  projectId,
  projectSearchCity,
  workspaceId
}: Readonly<{
  currentUserId: string;
  projectDomain: string;
  projectId: string;
  projectSearchCity?: ProjectSearchCity;
  workspaceId: string;
}>) {
  const { locale, t } = useUiLocale();
  const [dimensions, setDimensions] = useState<readonly SemanticRankDimension[]>([]);
  const [aiDimensions, setAiDimensions] = useState<readonly SemanticRankDimension[]>([]);
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);
  const [mode, setMode] = useState<"SEO" | "AI">("SEO");
  const [seoDimensionKey, setSeoDimensionKey] = useState("");
  const [aiDimensionKey, setAiDimensionKey] = useState("");
  const [groupId, setGroupId] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState(initialDateRange);
  const [sort, setSort] = useState<
    "QUERY_ASC" | "POSITION_ASC" | "POSITION_DESC" | "CHANGE_ASC" | "CHANGE_DESC"
  >("QUERY_ASC");
  const [state, setState] = useState<ReportState>({ loading: true, loadingMore: false });
  const [revision, setRevision] = useState(0);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [history, setHistory] = useState<HistorySelection>();
  const [serpHistory, setSerpHistory] = useState<HistorySelection>();
  const [aiHistory, setAiHistory] = useState<HistorySelection>();
  const [collectionMode, setCollectionMode] = useState<"SEO" | "AI">();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [queryColumnWidth, setQueryColumnWidth] = useState(rankingsQueryColumnDefaultWidth);
  const [hiddenDates, setHiddenDates] = useState<ReadonlySet<string>>(new Set());
  const [preferencesReady, setPreferencesReady] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const availableDateRange = useMemo(() => ({
    from: addCalendarDays(today(), -3 * 366 + 1),
    to: today()
  }), []);
  const effectiveMode: "SEO" | "AI" =
    mode === "AI" && aiDimensions.length > 0 ? "AI" : "SEO";
  const activeDimensions = effectiveMode === "AI" ? aiDimensions : dimensions;
  const dimensionKey = effectiveMode === "AI" ? aiDimensionKey : seoDimensionKey;

  function selectDimension(key: string): void {
    if (effectiveMode === "AI") setAiDimensionKey(key);
    else setSeoDimensionKey(key);
  }

  useEffect(() => {
    const initial = initialDateRange();
    const preferences = readRankingsPreferences(
      projectId,
      currentUserId,
      {
        mode: "SEO",
        seoDimensionKey: "",
        aiDimensionKey: "",
        groupId: "",
        dateFrom: initial.from,
        dateThrough: initial.through,
        sort: "QUERY_ASC",
        queryColumnWidth: rankingsQueryColumnDefaultWidth,
        hiddenDates: []
      },
      window.localStorage
    );
    setMode(preferences.mode);
    setSeoDimensionKey(preferences.seoDimensionKey);
    setAiDimensionKey(preferences.aiDimensionKey);
    setGroupId(preferences.groupId);
    setDateRange({
      from: preferences.dateFrom < availableDateRange.from
        ? availableDateRange.from
        : preferences.dateFrom,
      through: preferences.dateThrough > availableDateRange.to
        ? availableDateRange.to
        : preferences.dateThrough
    });
    setSort(preferences.sort);
    setQueryColumnWidth(preferences.queryColumnWidth);
    setHiddenDates(new Set(preferences.hiddenDates));
    setPreferencesReady(true);
  }, [availableDateRange.from, availableDateRange.to, currentUserId, projectId]);

  useEffect(() => {
    if (!preferencesReady) return;
    writeRankingsPreferences(projectId, currentUserId, {
      mode,
      seoDimensionKey,
      aiDimensionKey,
      groupId,
      dateFrom: dateRange.from,
      dateThrough: dateRange.through,
      sort,
      queryColumnWidth,
      hiddenDates: [...hiddenDates]
    }, window.localStorage);
  }, [aiDimensionKey, currentUserId, dateRange, groupId, hiddenDates, mode, preferencesReady, projectId, queryColumnWidth, seoDimensionKey, sort]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      browserApiRequest<unknown>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keyword-ranks/dimensions`,
        { signal: controller.signal }
      ).then(parseSemanticRankDimensionCatalog),
      browserApiRequest<readonly SemanticKeywordGroup[]>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`,
        { signal: controller.signal }
      )
    ]).then(([catalog, nextGroups]) => {
      if (controller.signal.aborted) return;
      setDimensions(catalog.dimensions);
      setAiDimensions(catalog.aiDimensions ?? []);
      const availableGroups = nextGroups.filter(({ systemKind }) => systemKind !== "TRASH");
      setGroups(availableGroups);
      setGroupId((current) => current && availableGroups.some(({ id }) => id === current)
        ? current
        : "");
      setSeoDimensionKey((current) =>
        current && catalog.dimensions.some(({ key }) => key === current)
          ? current
          : catalog.dimensions[0]?.key ?? ""
      );
      setAiDimensionKey((current) =>
        current && (catalog.aiDimensions ?? []).some(({ key }) => key === current)
          ? current
          : catalog.aiDimensions?.[0]?.key ?? ""
      );
    }).catch(() => {
      if (!controller.signal.aborted) {
        setState({ loading: false, loadingMore: false, error: t("Не удалось загрузить доступные срезы позиций.") });
      }
    });
    return () => controller.abort();
  }, [catalogRevision, projectId, t]);

  const requestInput = useMemo(() => {
    if (!dimensionKey) return undefined;
    return {
      dimensionKey,
      observedFrom: `${dateRange.from}T00:00:00.000Z`,
      observedBefore: `${addCalendarDays(dateRange.through, 1)}T00:00:00.000Z`,
      dateLimit: 31,
      ...(groupId ? { groupIds: [groupId] } : {}),
      ...(search ? { search } : {}),
      limit: 100 as const,
      sort,
      mode: effectiveMode
    };
  }, [dateRange, dimensionKey, effectiveMode, groupId, search, sort]);

  useEffect(() => {
    if (!requestInput) {
      setState({ loading: false, loadingMore: false });
      return;
    }
    const controller = new AbortController();
    setState({ loading: true, loadingMore: false });
    void requestReport(projectId, requestInput, controller.signal)
      .then((report) => {
        if (!controller.signal.aborted) {
          setState({ report, loading: false, loadingMore: false });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ loading: false, loadingMore: false, error: t("Не удалось построить отчёт по позициям. Повторите загрузку.") });
        }
      });
    return () => controller.abort();
  }, [projectId, requestInput, revision, t]);

  const loadMore = useCallback(async () => {
    const report = state.report;
    if (
      !requestInput ||
      !report?.page.hasNext ||
      !report.page.nextCursor ||
      loadingMoreRef.current
    ) return;
    loadingMoreRef.current = true;
    setState((current) => ({
      ...(current.report ? { report: current.report } : {}),
      loading: current.loading,
      loadingMore: true
    }));
    try {
      const next = await requestReport(projectId, {
        ...requestInput,
        cursor: report.page.nextCursor
      });
      setState({
        report: {
          ...next,
          rows: [...report.rows, ...next.rows]
        },
        loading: false,
        loadingMore: false
      });
    } catch {
      setState((current) => ({
        ...current,
        loadingMore: false,
        error: t("Не удалось загрузить следующую страницу.")
      }));
    } finally {
      loadingMoreRef.current = false;
    }
  }, [projectId, requestInput, state.report, t]);

  useEffect(() => {
    const target = loadMoreSentinelRef.current;
    const root = tableScrollRef.current;
    if (!target || !root || !state.report?.page.hasNext) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore();
      },
      { root, rootMargin: "320px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, state.report?.page.hasNext]);

  function toggleDateColumn(date: string): void {
    setHiddenDates((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function startQueryColumnResize(event: ReactPointerEvent<HTMLSpanElement>): void {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = queryColumnWidth;
    let nextWidth = startWidth;
    const move = (moveEvent: PointerEvent) => {
      nextWidth = clampQueryColumnWidth(startWidth + moveEvent.clientX - startX);
      setQueryColumnWidth(nextWidth);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      setQueryColumnWidth(nextWidth);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    handle.setPointerCapture(pointerId);
  }

  function resizeQueryColumnFromKeyboard(event: ReactKeyboardEvent<HTMLSpanElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setQueryColumnWidth((current) => clampQueryColumnWidth(
      current + (event.key === "ArrowRight" ? 16 : -16)
    ));
  }

  async function deleteHistory(): Promise<void> {
    if (!dimensionKey || deleting) return;
    setDeleting(true);
    try {
      const result = await browserApiRequest<{ readonly affectedSnapshots: number }>(
        `/app/api/projects/${encodeURIComponent(projectId)}/rank-workbench/delete-dimension-history`,
        {
          method: "POST",
          idempotencyKey: `rank-history-delete-${crypto.randomUUID()}`,
          body: { dimensionKey, confirmation: "DELETE" }
        }
      );
      setDeleteConfirm(false);
      setSeoDimensionKey("");
      setNotice(t("История среза удалена из отчётов: {0} снимков.", [String(result.affectedSnapshots)]));
      setCatalogRevision((value) => value + 1);
      setRevision((value) => value + 1);
    } catch {
      setNotice(t("Не удалось удалить историю среза. Проверьте права и повторите попытку."));
    } finally {
      setDeleting(false);
    }
  }

  const report = state.report;
  const visibleDates = report?.dates.filter((date) => !hiddenDates.has(date)) ?? [];
  const selectedDimension = activeDimensions.find(({ key }) => key === dimensionKey);

  return (
    <main className="rankings-workspace" ref={workspaceRef}>
      <section className="rankings-filter-bar" aria-label={t("Параметры отчёта")}>
        <div className="rankings-filter-primary">
        <div className="rankings-filter-mode">
          <span><UiText text="Тип выдачи" /></span>
          <div className="rankings-mode-switch" role="tablist">
            <button
              aria-selected={effectiveMode === "SEO"}
              className={effectiveMode === "SEO" ? "active" : undefined}
              onClick={() => setMode("SEO")}
              role="tab"
              type="button"
            >
              <UiText text="SEO выдача" />
            </button>
            {aiDimensions.length > 0 && (
              <button
                aria-selected={effectiveMode === "AI"}
                className={effectiveMode === "AI" ? "active" : undefined}
                onClick={() => setMode("AI")}
                role="tab"
                type="button"
              >
                <UiText text="ИИ выдача" />
              </button>
            )}
          </div>
        </div>
        <label className="rankings-filter-dimension">
          <span><UiText text="Город, поисковик и устройство" /></span>
          <CustomSelect
            onChange={(event) => selectDimension(event.target.value)}
            searchable
            searchPlaceholder={t("Найти город или устройство")}
            value={dimensionKey}
          >
            {activeDimensions.length === 0 && <option value=""><UiText text="Нет сохранённых съёмов" /></option>}
            {activeDimensions.map((dimension) => (
              <option key={dimension.key} value={dimension.key}>
                <span className="rankings-dimension-option">
                  <SemanticRankContext {...dimension} showEngineName={false} />
                  <span className="visually-hidden">{rankDimensionLabel(dimension, locale)}</span>
                </span>
              </option>
            ))}
          </CustomSelect>
        </label>
        <div className="rankings-group-filter">
          <span><UiText text="Группа" /></span>
          <SemanticGroupPickerField
            dialogTitle="Фильтр по папке"
            groups={groups}
            onChange={setGroupId}
            rootIcon="projects"
            rootLabel="Все группы"
            searchPlaceholder="Найти папку по названию или пути"
            showCount={false}
            value={groupId}
          />
        </div>
        <div className="rankings-date-filter">
          <span><UiText text="Период" /></span>
          <CustomDateRangePicker
            active
            alwaysShowYear
            availableRange={availableDateRange}
            className="rankings-date-picker"
            dialogLabel="Выбрать период позиций"
            modal
            onApply={({ from, to }) => setDateRange({ from, through: to })}
            onOpenChange={setDatePickerOpen}
            onReset={() => setDateRange(initialDateRange())}
            open={datePickerOpen}
            periodLabel="Период позиций"
            rangeLabel="Доступная история:"
            resetLabel="Вернуть последние 14 дней"
            triggerLabel="Период"
            value={{ from: dateRange.from, to: dateRange.through }}
          />
        </div>
        <label>
          <span><UiText text="Сортировка" /></span>
          <CustomSelect value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="QUERY_ASC"><UiText text="По запросу" /></option>
            <option value="POSITION_ASC"><UiText text="Позиция: выше сначала" /></option>
            <option value="POSITION_DESC"><UiText text="Позиция: ниже сначала" /></option>
            <option value="CHANGE_DESC"><UiText text="Сначала рост" /></option>
            <option value="CHANGE_ASC"><UiText text="Сначала падение" /></option>
          </CustomSelect>
        </label>
        </div>
        <div className="rankings-filter-secondary">
        <form className="rankings-search" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}>
          <label>
            <span><UiText text="Поиск" /></span>
            <div><Icon name="search" /><input onChange={(event) => setSearchDraft(event.target.value)} placeholder={t("Найти запрос")} value={searchDraft} /></div>
          </label>
          <button className="secondary-button" type="submit"><UiText text="Применить" /></button>
        </form>
        {report && (
          <details className="rankings-date-columns">
            <summary>
              <Icon name="list" />
              <UiText text="Колонки дат" />
              {hiddenDates.size > 0 && <b>{hiddenDates.size}</b>}
            </summary>
            <div>
              {report.dates.map((date) => (
                <label key={date}>
                  <input
                    checked={!hiddenDates.has(date)}
                    onChange={() => toggleDateColumn(date)}
                    type="checkbox"
                  />
                  <time dateTime={date}>{rankDateLabel(date, locale)}</time>
                </label>
              ))}
            </div>
          </details>
        )}
        <div className="rankings-toolbar-actions">
          <button className="secondary-button" onClick={() => setRevision((value) => value + 1)} type="button">
            <Icon name="history" /><UiText text="Обновить" />
          </button>
          <button className="primary-button" onClick={() => setCollectionMode(effectiveMode)} type="button">
            <Icon name={effectiveMode === "AI" ? "ai" : "rankCheck"} />
            <UiText text={effectiveMode === "AI" ? "Снять ИИ-позиции" : "Снять позиции"} />
          </button>
        </div>
        {effectiveMode === "SEO" && selectedDimension && (
          <button className="rankings-delete-slice" onClick={() => setDeleteConfirm(true)} type="button">
            <Icon name="trash" /><UiText text="Удалить историю среза" />
          </button>
        )}
        </div>
      </section>

      {notice && <div className="inline-alert" role="status">{notice}</div>}
      {report && (
        <div className="rankings-summary-row">
          <RankingSummary report={report} locale={locale} />
          <div className="rankings-summary-disclosures">
            <button
              aria-expanded={showStatistics}
              className="rankings-statistics-toggle"
              onClick={() => setShowStatistics((value) => !value)}
              type="button"
            >
              <Icon name="trend" />
              <UiText text="Статистика" />
            </button>
          </div>
        </div>
      )}
      {report && showStatistics && (
        <RankingCharts report={report} />
      )}

      <section className="rankings-table-panel">
        {state.loading && !report ? (
          <div className="rankings-state" role="status"><UiText text="Строим отчёт…" /></div>
        ) : state.error && !report ? (
          <div className="rankings-state error" role="alert">{state.error}</div>
        ) : !report || report.rows.length === 0 ? (
          <div className="rankings-state">
            <strong><UiText text="Нет данных для выбранного среза" /></strong>
            <span><UiText text="Измените даты или запустите новый съём позиций." /></span>
          </div>
        ) : (
          <div className="rankings-table-scroll" ref={tableScrollRef}>
            <table
              className="rankings-matrix"
              style={{ "--rankings-query-width": `${queryColumnWidth}px` } as CSSProperties}
            >
              <thead>
                <tr>
                  <th>
                    <span className="rankings-query-heading"><UiText text="Запрос" /></span>
                    <span
                      aria-label={t("Изменить ширину колонки запроса")}
                      aria-orientation="vertical"
                      aria-valuemax={rankingsQueryColumnMaxWidth}
                      aria-valuemin={rankingsQueryColumnMinWidth}
                      aria-valuenow={queryColumnWidth}
                      className="rankings-query-resizer"
                      onDoubleClick={() => setQueryColumnWidth(rankingsQueryColumnDefaultWidth)}
                      onKeyDown={resizeQueryColumnFromKeyboard}
                      onPointerDown={startQueryColumnResize}
                      role="separator"
                      tabIndex={0}
                    />
                  </th>
                  {visibleDates.map((date) => (
                    <th key={date}>
                      <label className="rankings-date-column-heading">
                        <input
                          aria-label={t("Скрыть колонку {0}", [rankDateLabel(date, locale)])}
                          checked
                          onChange={() => toggleDateColumn(date)}
                          type="checkbox"
                        />
                        <time dateTime={date}>{rankDateLabel(date, locale)}</time>
                      </label>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => {
                  const byDate = new Map(row.cells.map((cell) => [cell.date, cell]));
                  const selection = {
                    createdAt: row.createdAt,
                    keywordId: row.keywordId,
                    keywordText: row.query,
                    ...(row.targetUrl ? { targetUrl: row.targetUrl } : {})
                  };
                  return (
                    <tr key={row.keywordId}>
                      <th scope="row">
                        <strong title={row.query}>{row.query}</strong>
                        <div className="rankings-query-meta">
                          {row.frequencies.length > 0 && (
                            <div className="rankings-frequency-badges">
                              {row.frequencies.map((frequency) => (
                                <DuplicateFrequency
                                  key={frequency.type}
                                  label={rankingFrequencyShortLabel(frequency.type)}
                                  title={t(`Яндекс · ${rankingFrequencyLabel(frequency.type).toLocaleLowerCase("ru")} частотность`)}
                                  value={frequency.value}
                                />
                              ))}
                            </div>
                          )}
                          <div className="rankings-query-actions">
                            <a
                              aria-label={t("Открыть запрос в поиске")}
                              href={searchUrl(report.dimension, row.query)}
                              rel="noopener noreferrer"
                              target="_blank"
                              title={t("Открыть запрос в поиске")}
                            ><Icon name="search" /></a>
                            <button
                              aria-label={t(effectiveMode === "AI" ? "Открыть историю ИИ-позиций" : "Открыть историю позиций")}
                              onClick={() => effectiveMode === "AI"
                                ? setAiHistory(selection)
                                : setHistory(selection)}
                              title={t(effectiveMode === "AI" ? "Открыть историю ИИ-позиций" : "Открыть историю позиций")}
                              type="button"
                            ><Icon name="history" /></button>
                            <button
                              aria-label={t(effectiveMode === "AI" ? "Открыть историю ИИ-выдачи" : "Открыть историю выдачи")}
                              onClick={() => effectiveMode === "AI"
                                ? setAiHistory(selection)
                                : setSerpHistory(selection)}
                              title={t(effectiveMode === "AI" ? "Открыть историю ИИ-выдачи" : "Открыть историю выдачи")}
                              type="button"
                            ><Icon name="competitors" /></button>
                          </div>
                        </div>
                      </th>
                      {visibleDates.map((date) => (
                        <RankingCell
                          cell={byDate.get(date)}
                          key={date}
                          onOpenSiteResults={(snapshotId) => effectiveMode === "AI"
                            ? setAiHistory(selection)
                            : setHistory({ ...selection, initialSiteResultsSnapshotId: snapshotId })}
                          onOpenTargetMismatch={(snapshotId, observedAt) => effectiveMode === "AI"
                            ? setAiHistory(selection)
                            : setHistory({
                                ...selection,
                                initialObservedAt: observedAt,
                                initialSiteResultsSnapshotId: snapshotId,
                                showUrlComparison: true
                              })}
                          {...(row.targetUrl ? { targetUrl: row.targetUrl } : {})}
                        />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {report.page.hasNext && (
              <div
                aria-label={t("Загружаем следующую страницу…")}
                className="rankings-infinite-sentinel"
                ref={loadMoreSentinelRef}
                role="status"
              >
                {state.loadingMore && <UiText text="Загружаем…" />}
              </div>
            )}
          </div>
        )}
        {state.error && report && (
          <div className="inline-alert danger" role="alert">
            <span>{state.error}</span>
            <button className="text-button" onClick={() => void loadMore()} type="button"><UiText text="Повторить" /></button>
          </div>
        )}
      </section>

      {history && selectedDimension && (
        <SemanticKeywordPositionHistoryModal
          contextPoints={[]}
          createdAt={history.createdAt}
          dimensionKey={selectedDimension.key}
          {...(history.initialObservedAt ? { initialObservedAt: history.initialObservedAt } : {})}
          {...(history.initialSiteResultsSnapshotId ? { initialSiteResultsSnapshotId: history.initialSiteResultsSnapshotId } : {})}
          keywordId={history.keywordId}
          keywordText={history.keywordText}
          onClose={() => setHistory(undefined)}
          projectId={projectId}
          showUrlComparison={history.showUrlComparison ?? false}
          {...(history.targetUrl ? { targetUrl: history.targetUrl } : {})}
        />
      )}
      {serpHistory && selectedDimension && (
        <SemanticKeywordSerpHistory
          currentUserId={currentUserId}
          dimensionKey={selectedDimension.key}
          keywordId={serpHistory.keywordId}
          keywordText={serpHistory.keywordText}
          onClose={() => setSerpHistory(undefined)}
          projectDomain={projectDomain}
          projectId={projectId}
        />
      )}
      {aiHistory && selectedDimension && (
        <SemanticKeywordAiPositionHistoryModal
          currentUserId={currentUserId}
          dimensionKey={selectedDimension.key}
          keywordId={aiHistory.keywordId}
          keywordText={aiHistory.keywordText}
          onClose={() => setAiHistory(undefined)}
          projectDomain={projectDomain}
          projectId={projectId}
        />
      )}
      {collectionMode === "SEO" && (
        <SemanticPositionDialog
          groups={groups.map((group) => ({ ...group }))}
          initialSelections={[]}
          onClose={() => setCollectionMode(undefined)}
          onStarted={() => { setCollectionMode(undefined); setNotice(t("Съём запущен. Новые данные появятся после завершения операции.")); }}
          projectId={projectId}
          {...(projectSearchCity ? { projectSearchCity } : {})}
          workspaceId={workspaceId}
        />
      )}
      {collectionMode === "AI" && (
        <SemanticAiAnswerDialog
          activeGroupId={groupId || undefined}
          groups={groups.map((group) => ({ ...group }))}
          initialSelections={[]}
          mode="positions"
          onClose={() => setCollectionMode(undefined)}
          onStarted={() => {
            setCollectionMode(undefined);
            setNotice(t("Съём ИИ-позиций запущен. Новые данные появятся после завершения операции."));
          }}
          projectDomain={projectDomain}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      )}
      {deleteConfirm && selectedDimension && (
        <SemanticModal
          description={t("Все сохранённые снимки этого города, поисковика и устройства исчезнут из таблиц, графиков, сайдбара и экспорта. Новый съём снова создаст этот срез.")}
          footer={<div className="semantic-modal-actions"><button className="secondary-button" disabled={deleting} onClick={() => setDeleteConfirm(false)} type="button"><UiText text="Отмена" /></button><button className="danger-button" disabled={deleting} onClick={() => void deleteHistory()} type="button">{deleting ? <UiTextLine /> : <UiText text="Удалить историю" />}</button></div>}
          onClose={() => !deleting && setDeleteConfirm(false)}
          size="small"
          title={t("Удалить историю среза?")}
        >
          <div className="rankings-delete-context"><SemanticRankContext {...selectedDimension} /></div>
        </SemanticModal>
      )}
    </main>
  );
}

function RankingSummary({ report, locale }: { report: RankPositionReport; locale: string }) {
  const values = [
    ["Запросов", report.summary.keywordCount, "neutral"],
    ["Найдено", report.summary.foundCount, "good"],
    ["Не найдено", report.summary.notFoundCount, "warn"],
    ["Выросло", report.summary.improvedCount, "good"],
    ["Упало", report.summary.declinedCount, "bad"],
    ["Средняя позиция", report.summary.averagePosition ?? "—", "brand"]
  ] as const;
  return <section className="rankings-summary">{values.map(([label, value, tone]) => <div className={`tone-${tone}`} key={label}><span><UiText text={label} /></span><strong>{typeof value === "number" ? value.toLocaleString(locale) : value}</strong></div>)}</section>;
}

function RankingCharts({ report }: { report: RankPositionReport }) {
  const maximumPosition = Math.max(1, ...report.trend.map(({ averagePosition }) => averagePosition ?? 0));
  const points = report.trend.flatMap((point, index) => point.averagePosition === undefined ? [] : [{
    x: report.trend.length === 1 ? 50 : index / (report.trend.length - 1) * 100,
    y: 4 + (point.averagePosition - 1) / Math.max(1, maximumPosition - 1) * 32,
    value: point.averagePosition
  }]);
  return <section className="rankings-charts">
    <article><header><div><span><UiText text="Средняя позиция" /></span><strong>{report.summary.averagePosition?.toLocaleString() ?? "—"}</strong></div><Icon name="trend" /></header>{points.length > 0 ? <svg aria-label="График средней позиции" role="img" viewBox="0 0 100 40"><path d={points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")} /></svg> : <div className="rankings-chart-empty"><UiText text="В последнем срезе нет найденных позиций" /></div>}</article>
    <article className="rankings-distribution"><header><span><UiText text="Распределение по ТОПам" /></span><strong>{report.summary.measuredCount}</strong></header>{[["Топ-3", report.summary.top3Count], ["Топ-10", report.summary.top10Count], ["Топ-30", report.summary.top30Count]].map(([label, value]) => <div key={String(label)}><span>{label}</span><div><i style={{ width: `${Math.min(100, Number(value) / Math.max(1, report.summary.measuredCount) * 100)}%` }} /></div><strong>{value}</strong></div>)}</article>
    <article className="rankings-movement"><header><span><UiText text="Изменения" /></span><Icon name="positions" /></header><div><span className="up"><Icon name="arrowUp" />{report.summary.improvedCount}<small><UiText text="рост" /></small></span><span className="down"><Icon name="arrowDown" />{report.summary.declinedCount}<small><UiText text="падение" /></small></span><span>{report.summary.unchangedCount}<small><UiText text="без изменений" /></small></span></div></article>
  </section>;
}

function RankingCell({
  cell,
  onOpenSiteResults,
  onOpenTargetMismatch,
  targetUrl
}: Readonly<{
  cell: RankPositionReportCell | undefined;
  onOpenSiteResults: (snapshotId: string) => void;
  onOpenTargetMismatch: (snapshotId: string, observedAt: string) => void;
  targetUrl?: string;
}>) {
  const { t } = useUiLocale();
  if (!cell) return <td className="rankings-cell empty">—</td>;
  const delta = cell.position !== undefined && cell.previousPosition !== undefined
    ? cell.previousPosition - cell.position
    : undefined;
  const tone = !cell.found
    ? "lost"
    : delta === undefined
      ? "new"
      : delta > 0
        ? "up"
        : delta < 0
          ? "down"
          : "same";
  const targetMismatch = Boolean(
    targetUrl &&
    cell.found &&
    cell.rankingUrl &&
    !sameSemanticRankingUrl(targetUrl, cell.rankingUrl)
  );
  const positionValue = <>
    <strong>{cell.position ?? "×"}</strong>
    {delta === undefined ? (
      <small>{cell.found ? <UiText text="Новая" /> : <UiText text="Нет" />}</small>
    ) : delta === 0 ? (
      <small>—</small>
    ) : (
      <small>{delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</small>
    )}
  </>;
  return (
    <td className={`rankings-cell ${tone}`}>
      <div className="rankings-cell-content">
        {cell.rankingUrl ? (
          <a
            aria-label={t("Перейти на найденную страницу")}
            className="rankings-cell-value"
            href={cell.rankingUrl}
            rel="noopener noreferrer"
            target="_blank"
            title={cell.rankingUrl}
          >{positionValue}</a>
        ) : (
          <span className="rankings-cell-value">{positionValue}</span>
        )}
        <div className="rankings-cell-actions">
          {targetMismatch && (
            <button
              aria-label={t("Нерелевантный URL")}
              className="rankings-cell-mismatch"
              onClick={() => onOpenTargetMismatch(cell.snapshotId, cell.observedAt)}
              title={t("Открыть нецелевой URL в сохранённой выдаче")}
              type="button"
            ><Icon name="link" /></button>
          )}
          {cell.siteResultCount > 1 && (
            <button
              aria-label={t("Показать несколько страниц сайта в выдаче")}
              className="rankings-cell-multiple"
              onClick={() => onOpenSiteResults(cell.snapshotId)}
              title={t("Показать несколько страниц сайта в выдаче")}
              type="button"
            ><Icon name="multiGroup" /></button>
          )}
        </div>
      </div>
    </td>
  );
}

function rankingFrequencyLabel(type: "BASE" | "EXACT" | "FIXED"): string {
  return { BASE: "Базовая", EXACT: "Фразовая", FIXED: "Точная" }[type];
}

function rankingFrequencyShortLabel(type: "BASE" | "EXACT" | "FIXED"): string {
  return { BASE: "База", EXACT: '""', FIXED: '"!"' }[type];
}

async function requestReport(projectId: string, input: object, signal?: AbortSignal): Promise<RankPositionReport> {
  const value = await browserApiRequest<unknown>(`/app/api/projects/${encodeURIComponent(projectId)}/rank-workbench/positions`, { method: "POST", body: input, ...(signal ? { signal } : {}) });
  return parseRankPositionReport(value);
}

function initialDateRange() {
  return { from: addCalendarDays(today(), -13), through: today() };
}
function today(): string { return new Date().toISOString().slice(0, 10); }
function addCalendarDays(value: string, days: number): string { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function rankDateLabel(value: string, locale: string): string { return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00.000Z`)); }
function searchUrl(dimension: SemanticRankDimension, query: string): string { const url = new URL(dimension.searchEngine === "YANDEX" ? "https://yandex.ru/search/" : "https://www.google.com/search"); url.searchParams.set("text", query); if (dimension.searchEngine === "GOOGLE") { url.searchParams.delete("text"); url.searchParams.set("q", query); url.searchParams.set("hl", dimension.language); url.searchParams.set("gl", dimension.countryCode.toLowerCase()); } else { url.searchParams.set("lr", dimension.regionCode); } return url.toString(); }
function UiTextLine() { return <UiText text="Удаляем…" />; }
