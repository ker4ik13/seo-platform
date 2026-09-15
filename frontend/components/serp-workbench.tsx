"use client";

import {
  parseSemanticRankDimensionCatalog,
  parseSerpWorkbenchReport,
  type ProjectSearchCity,
  type SemanticKeywordGroup,
  type SemanticRankDimension,
  type SerpWorkbenchReport,
  type SerpWorkbenchResult,
  type SerpWorkbenchSnapshotProvider
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
import {
  assignSerpDomainColors,
  normalizedSerpDomain,
  repeatedSerpDomains
} from "../lib/serp-domain-highlights";
import { semanticUrlBelongsToProject } from "../lib/semantic-rank-presentation";
import { Icon } from "./icon";
import {
  SemanticSerpResultUrl,
  SemanticSiteFavicon
} from "./semantic-competitor-snapshots";
import { SemanticPositionDialog } from "./semantic-position-dialog";
import { SemanticAiAnswerDialog } from "./semantic-ai-answer-dialog";
import { SemanticRankContext } from "./semantic-rank-context";
import { SemanticGroupPickerField } from "./semantic-group-picker";
import { UiText, useUiLocale } from "./ui-locale";

const MAX_DIMENSIONS = 5;
const SERP_QUERY_COLUMN_DEFAULT = 180;
const SERP_RESULT_COLUMN_DEFAULT = 320;
const SERP_COLUMN_MIN = 220;
const SERP_COLUMN_MAX = 620;

export function SerpWorkbench({
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
  const { t } = useUiLocale();
  const [dimensions, setDimensions] = useState<readonly SemanticRankDimension[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<SerpWorkbenchReport>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [dimensionPickerOpen, setDimensionPickerOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [watchedDomains, setWatchedDomains] = useState<readonly string[]>([]);
  const [domainDraft, setDomainDraft] = useState("");
  const [highlightDuplicateDomains, setHighlightDuplicateDomains] = useState(true);
  const [expandedKeywordIds, setExpandedKeywordIds] = useState<ReadonlySet<string>>(new Set());
  const [columnWidths, setColumnWidths] = useState<Readonly<Record<string, number>>>({});
  const [columnsCustomized, setColumnsCustomized] = useState(false);
  const [aiOnly, setAiOnly] = useState(false);
  const [scopePreferencesOwner, setScopePreferencesOwner] = useState<string>();
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    setWatchedDomains(readWatchedDomains(projectId));
    const preferences = readSerpColumnPreferences(projectId, currentUserId);
    setColumnWidths(preferences.widths);
    setColumnsCustomized(preferences.customized);
    setHighlightDuplicateDomains(readDuplicateHighlightPreference(projectId, currentUserId));
  }, [currentUserId, projectId]);

  useEffect(() => {
    if (scopePreferencesOwner !== serpScopeStorageKey(projectId, currentUserId)) return;
    writeSerpScopePreferences(projectId, currentUserId, {
      dimensionKeys: selectedKeys,
      groupId,
      aiOnly
    });
  }, [aiOnly, currentUserId, groupId, projectId, scopePreferencesOwner, selectedKeys]);


  useEffect(() => {
    const controller = new AbortController();
    setScopePreferencesOwner(undefined);
    setLoading(true);
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
      const availableGroups = nextGroups.filter(({ systemKind }) => systemKind !== "TRASH");
      const preferences = readSerpScopePreferences(projectId, currentUserId);
      const preferredDimensions = preferences.dimensionKeys.filter((key) =>
        catalog.dimensions.some((dimension) => dimension.key === key)
      ).slice(0, MAX_DIMENSIONS);
      setDimensions(catalog.dimensions);
      setGroups(availableGroups);
      setSelectedKeys(preferredDimensions.length > 0
        ? preferredDimensions
        : catalog.dimensions.slice(0, 2).map(({ key }) => key));
      setGroupId(availableGroups.some(({ id }) => id === preferences.groupId)
        ? preferences.groupId
        : "");
      setAiOnly(preferences.aiOnly);
      setScopePreferencesOwner(serpScopeStorageKey(projectId, currentUserId));
    }).catch(() => {
      if (!controller.signal.aborted) setError(t("Не удалось загрузить сохранённые срезы выдачи."));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [currentUserId, projectId, t]);

  const input = useMemo(() => selectedKeys.length === 0 ? undefined : ({
    dimensionKeys: selectedKeys,
    ...(groupId ? { groupIds: [groupId] } : {}),
    ...(query ? { search: query } : {}),
    limit: 50 as const
  }), [groupId, query, selectedKeys]);

  useEffect(() => {
    if (!input) {
      setReport(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        const next = await requestSerp(projectId, input, controller.signal);
        if (!controller.signal.aborted) setReport(next);
      } catch {
        if (!controller.signal.aborted) {
          setError(t("Не удалось загрузить сохранённую выдачу."));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [input, projectId, revision, t]);

  const loadMore = useCallback(async () => {
    if (
      !input ||
      !report?.page.hasNext ||
      !report.page.nextCursor ||
      loadingMoreRef.current
    ) return;
    loadingMoreRef.current = true;
    setError(undefined);
    setLoadingMore(true);
    try {
      const next = await requestSerp(projectId, { ...input, cursor: report.page.nextCursor });
      setReport({ ...next, rows: [...report.rows, ...next.rows] });
    } catch {
      setError(t("Не удалось загрузить следующую страницу выдачи."));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [input, projectId, report, t]);

  useEffect(() => {
    const target = loadMoreSentinelRef.current;
    const root = gridScrollRef.current;
    if (!target || !root || !report?.page.hasNext) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore();
      },
      { root, rootMargin: "360px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, report?.page.hasNext]);

  function toggleDimension(key: string): void {
    setSelectedKeys((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : current.length < MAX_DIMENSIONS ? [...current, key] : current);
  }

  function addWatchedDomain(): void {
    const value = normalizedSerpDomain(domainDraft);
    if (!value || watchedDomains.includes(value)) return;
    const next = [...watchedDomains, value].slice(0, 20);
    setWatchedDomains(next);
    writeWatchedDomains(projectId, next);
    setDomainDraft("");
  }

  function removeWatchedDomain(domain: string): void {
    const next = watchedDomains.filter((value) => value !== domain);
    setWatchedDomains(next);
    writeWatchedDomains(projectId, next);
  }

  function resizeColumn(key: string, width: number, persist: boolean): void {
    const minimum = key === "query" ? 150 : SERP_COLUMN_MIN;
    const fallback = key === "query"
      ? SERP_QUERY_COLUMN_DEFAULT
      : SERP_RESULT_COLUMN_DEFAULT;
    const nextWidth = Number.isFinite(width)
      ? Math.min(SERP_COLUMN_MAX, Math.max(minimum, Math.round(width)))
      : fallback;
    const next = { ...columnWidths, [key]: nextWidth };
    setColumnWidths(next);
    setColumnsCustomized(true);
    if (persist) {
      writeSerpColumnPreferences(projectId, currentUserId, {
        customized: true,
        widths: next
      });
    }
  }

  function startColumnResize(
    event: ReactPointerEvent<HTMLSpanElement>,
    key: string
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = columnWidths[key] ??
      (key === "query" ? SERP_QUERY_COLUMN_DEFAULT : SERP_RESULT_COLUMN_DEFAULT);
    let nextWidth = startWidth;
    const move = (moveEvent: PointerEvent) => {
      nextWidth = startWidth + moveEvent.clientX - startX;
      resizeColumn(key, nextWidth, false);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      resizeColumn(key, nextWidth, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    handle.setPointerCapture(pointerId);
  }

  function resetColumnWidth(key: string): void {
    resizeColumn(
      key,
      key === "query" ? SERP_QUERY_COLUMN_DEFAULT : SERP_RESULT_COLUMN_DEFAULT,
      true
    );
  }

  function resizeColumnFromKeyboard(
    event: ReactKeyboardEvent<HTMLSpanElement>,
    key: string
  ): void {
    const current = columnWidths[key] ??
      (key === "query" ? SERP_QUERY_COLUMN_DEFAULT : SERP_RESULT_COLUMN_DEFAULT);
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    resizeColumn(key, current + (event.key === "ArrowRight" ? 16 : -16), true);
  }

  function toggleKeywordExpansion(keywordId: string): void {
    setExpandedKeywordIds((current) => {
      const next = new Set(current);
      if (next.has(keywordId)) next.delete(keywordId);
      else next.add(keywordId);
      return next;
    });
  }

  const selectedDimensions = selectedKeys.flatMap((key) => {
    const dimension = dimensions.find((item) => item.key === key);
    return dimension ? [dimension] : [];
  });
  const duplicateHosts = useMemo(
    () => repeatedSerpDomains(report?.rows ?? [], aiOnly ? "ai" : "organic"),
    [aiOnly, report?.rows]
  );
  const domainColors = useMemo(
    () => assignSerpDomainColors([...watchedDomains, ...duplicateHosts]),
    [duplicateHosts, watchedDomains]
  );

  return <main className="serp-workbench">
    <section className="serp-controls">
      <div className="serp-dimension-control">
        <span><UiText text="Срезы для сравнения" /></span>
        <button aria-expanded={dimensionPickerOpen} className="serp-dimension-trigger" onClick={() => setDimensionPickerOpen((value) => !value)} type="button"><span>{selectedDimensions.length === 0 ? <UiText text="Выберите города и устройства" /> : <UiText text="Выбрано срезов: {0}" values={[String(selectedDimensions.length)]} />}</span><Icon name="chevronDown" /></button>
        {dimensionPickerOpen && <div className="serp-dimension-popover"><header><strong><UiText text="До пяти срезов" /></strong><span>{selectedDimensions.length} / {MAX_DIMENSIONS}</span></header>{dimensions.map((dimension) => <label key={dimension.key}><input checked={selectedKeys.includes(dimension.key)} disabled={!selectedKeys.includes(dimension.key) && selectedKeys.length >= MAX_DIMENSIONS} onChange={() => toggleDimension(dimension.key)} type="checkbox" /><SemanticRankContext {...dimension} /></label>)}<button className="primary-button" onClick={() => setDimensionPickerOpen(false)} type="button"><UiText text="Готово" /></button></div>}
      </div>
      <div className="serp-group-control">
        <span><UiText text="Группа запросов" /></span>
        <SemanticGroupPickerField
          dialogTitle="Фильтр по папке"
          groups={groups}
          onChange={setGroupId}
          rootIcon="projects"
          rootLabel="Все группы"
          searchPlaceholder="Найти папку по названию или пути"
          value={groupId}
        />
      </div>
      <form onSubmit={(event) => { event.preventDefault(); setQuery(queryDraft.trim()); }}><label><span><UiText text="Поиск по запросам" /></span><div><Icon name="search" /><input onChange={(event) => setQueryDraft(event.target.value)} placeholder={t("Введите запрос")} value={queryDraft} /></div></label><button className="secondary-button" type="submit"><UiText text="Найти" /></button></form>
      <div className="serp-toolbar-actions">
        <label className="serp-ai-mode-toggle"><input checked={aiOnly} onChange={(event) => setAiOnly(event.target.checked)} type="checkbox" /><Icon name="ai" /><UiText text="ИИ-выдача" /></label>
        <button className="secondary-button" onClick={() => setRevision((value) => value + 1)} type="button"><Icon name="history" /><UiText text="Обновить" /></button><button className="primary-button" onClick={() => setCollectionOpen(true)} type="button"><Icon name="rankCheck" /><UiText text={aiOnly ? "Собрать ИИ-выдачу" : "Собрать выдачу"} /></button>
      </div>
    </section>

    <section className="serp-highlight-settings">
      <div>
        <strong><UiText text="Подсветка доменов" /></strong>
        <span>
          <UiText text="Свой домен отмечен зелёным. Одинаковые домены во всех показанных срезах и запросах получают собственный цвет; уникальные автоматически не выделяются, а добавленные вручную выделяются всегда." />
        </span>
        <label className="serp-duplicate-toggle">
          <input
            checked={highlightDuplicateDomains}
            onChange={(event) => {
              setHighlightDuplicateDomains(event.target.checked);
              writeDuplicateHighlightPreference(projectId, currentUserId, event.target.checked);
            }}
            type="checkbox"
          />
          <UiText text="Подсвечивать одинаковые домены" />
        </label>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); addWatchedDomain(); }}>
        <input
          onChange={(event) => setDomainDraft(event.target.value)}
          placeholder="example.ru"
          value={domainDraft}
        />
        <button aria-label={t("Добавить домен")} className="secondary-button" type="submit">
          <Icon name="plus" />
        </button>
      </form>
      <div className="serp-domain-chips">
        <span className="own">{normalizedSerpDomain(projectDomain) ?? projectDomain}</span>
        {watchedDomains.map((domain) => (
          <button
            key={domain}
            onClick={() => removeWatchedDomain(domain)}
            style={domainColorStyle(domain, domainColors)}
            title={t("Убрать подсветку")}
            type="button"
          >
            {domain}<Icon name="close" />
          </button>
        ))}
      </div>
    </section>

    <section className="serp-report">
      {loading && !report ? (
        <div className="serp-state" role="status"><UiText text="Загружаем выдачу…" /></div>
      ) : error && !report ? (
        <div className="serp-state error" role="alert">{error}</div>
      ) : !report || report.rows.length === 0 ? (
        <div className="serp-state">
          <strong><UiText text={aiOnly ? "Сохранённой ИИ-выдачи пока нет" : "Сохранённой выдачи пока нет"} /></strong>
          <span><UiText text={aiOnly ? "Запустите сбор ИИ-конкурентов для выбранных городов и устройств." : "Запустите сбор конкурентов для выбранных городов и устройств."} /></span>
        </div>
      ) : (
        <div className="serp-grid-scroll" ref={gridScrollRef}>
          {report.dimensions.length === 1 && (
            <div className="serp-single-context">
              <SemanticRankContext {...report.dimensions[0]!} />
            </div>
          )}
          <table
            className={`serp-grid ${report.dimensions.length === 1 ? "is-single" : "is-multi"}${columnsCustomized ? " is-resized" : ""}`}
            style={{
              "--serp-dimension-count": report.dimensions.length,
              minWidth: report.dimensions.length > 1
                ? `${columnsCustomized
                    ? (columnWidths.query ?? SERP_QUERY_COLUMN_DEFAULT) +
                      report.dimensions.reduce((sum, dimension) =>
                        sum + (columnWidths[dimension.key] ?? SERP_RESULT_COLUMN_DEFAULT), 0)
                    : 180 + report.dimensions.length * 250}px`
                : undefined,
              width: columnsCustomized && report.dimensions.length > 1
                ? `${(columnWidths.query ?? SERP_QUERY_COLUMN_DEFAULT) +
                    report.dimensions.reduce((sum, dimension) =>
                      sum + (columnWidths[dimension.key] ?? SERP_RESULT_COLUMN_DEFAULT), 0)}px`
                : undefined
            } as CSSProperties}
          >
            {report.dimensions.length > 1 && (
              <colgroup>
                <col style={{ width: columnWidths.query ?? SERP_QUERY_COLUMN_DEFAULT }} />
                {report.dimensions.map((dimension) => (
                  <col
                    key={dimension.key}
                    style={{ width: columnWidths[dimension.key] ?? SERP_RESULT_COLUMN_DEFAULT }}
                  />
                ))}
              </colgroup>
            )}
            <thead>
              <tr>
                <th>
                  <UiText text="Запрос" />
                  <SerpColumnResizeHandle
                    label={t("Изменить ширину колонки запроса")}
                    onDoubleClick={() => resetColumnWidth("query")}
                    onKeyDown={(event) => resizeColumnFromKeyboard(event, "query")}
                    onPointerDown={(event) => startColumnResize(event, "query")}
                    value={columnWidths.query ?? SERP_QUERY_COLUMN_DEFAULT}
                  />
                </th>
                {report.dimensions.map((dimension) => (
                  <th key={dimension.key}>
                    <SemanticRankContext {...dimension} />
                    <SerpColumnResizeHandle
                      label={t("Изменить ширину колонки выдачи")}
                      onDoubleClick={() => resetColumnWidth(dimension.key)}
                      onKeyDown={(event) => resizeColumnFromKeyboard(event, dimension.key)}
                      onPointerDown={(event) => startColumnResize(event, dimension.key)}
                      value={columnWidths[dimension.key] ?? SERP_RESULT_COLUMN_DEFAULT}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const resultDepth = Math.max(
                  0,
                  ...(aiOnly ? row.aiSnapshots : row.snapshots).map(({ results }) => results.length)
                );
                const expanded = expandedKeywordIds.has(row.keywordId);
                return (
                  <tr key={row.keywordId}>
                    <th scope="row">
                      <strong>{row.query}</strong>
                      {row.groupPath && <small>{row.groupPath}</small>}
                      {row.tags.length > 0 && (
                        <div>
                          {row.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                        </div>
                      )}
                      {resultDepth > 10 && (
                        <button
                          className="serp-row-expand"
                          onClick={() => toggleKeywordExpansion(row.keywordId)}
                          type="button"
                        >
                          {expanded
                            ? <UiText text="Скрыть до топ-10" />
                            : <UiText text="Показать топ {0}" values={[String(resultDepth)]} />}
                        </button>
                      )}
                    </th>
                    {report.dimensions.map((dimension) => {
                      const snapshot = (aiOnly ? row.aiSnapshots : row.snapshots).find(
                        ({ dimensionKey: snapshotKey }) => snapshotKey === dimension.key
                      );
                      return (
                        <td key={dimension.key}>
                          {snapshot ? <div className="serp-combined-snapshots">
                              <SerpSnapshotCell
                                duplicateHosts={duplicateHosts}
                                domainColors={domainColors}
                                expanded={expanded}
                                highlightDuplicateDomains={highlightDuplicateDomains}
                                kind={aiOnly ? "ai" : "organic"}
                                observedAt={snapshot.observedAt}
                                projectDomain={projectDomain}
                                provider={snapshot.provider}
                                results={snapshot.results}
                                watchedDomains={watchedDomains}
                              />
                          </div> : (
                            <div className="serp-empty-cell"><UiText text="Нет снимка" /></div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {report.page.hasNext && (
            <div
              aria-label={t("Загружаем следующую страницу…")}
              className="serp-infinite-sentinel"
              ref={loadMoreSentinelRef}
              role="status"
            >
              {loadingMore && <UiText text="Загружаем…" />}
            </div>
          )}
        </div>
      )}
      {error && report && (
        <div className="inline-alert danger" role="alert">
          <span>{error}</span>
          <button className="text-button" onClick={() => void loadMore()} type="button">
            <UiText text="Повторить" />
          </button>
        </div>
      )}
    </section>

    {collectionOpen && (aiOnly
      ? <SemanticAiAnswerDialog
          activeGroupId={groupId || undefined}
          groups={groups.map((group) => ({ ...group }))}
          initialSelections={[]}
          mode="competitors"
          onClose={() => setCollectionOpen(false)}
          onStarted={() => { setCollectionOpen(false); setError(undefined); }}
          projectDomain={projectDomain}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      : <SemanticPositionDialog activeGroupId={groupId || undefined} groups={groups.map((group) => ({ ...group }))} initialSelections={[]} mode="competitors" onClose={() => setCollectionOpen(false)} onStarted={() => { setCollectionOpen(false); setError(undefined); }} projectId={projectId} {...(projectSearchCity ? { projectSearchCity } : {})} workspaceId={workspaceId} />)}
  </main>;
}

function SerpColumnResizeHandle({
  label,
  onDoubleClick,
  onKeyDown,
  onPointerDown,
  value
}: Readonly<{
  label: string;
  onDoubleClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLSpanElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  value: number;
}>) {
  return (
    <span
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={SERP_COLUMN_MAX}
      aria-valuemin={SERP_COLUMN_MIN}
      aria-valuenow={value}
      className="serp-column-resizer"
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={0}
      title={label}
    />
  );
}

function SerpSnapshotCell({
  domainColors,
  duplicateHosts,
  expanded,
  highlightDuplicateDomains,
  kind,
  observedAt,
  projectDomain,
  provider,
  results,
  watchedDomains
}: Readonly<{
  domainColors: ReadonlyMap<string, string>;
  duplicateHosts: ReadonlySet<string>;
  expanded: boolean;
  highlightDuplicateDomains: boolean;
  kind: "organic" | "ai";
  observedAt: string;
  projectDomain: string;
  provider: SerpWorkbenchSnapshotProvider;
  results: readonly SerpWorkbenchResult[];
  watchedDomains: readonly string[];
}>) {
  const { locale } = useUiLocale();
  const visible = expanded ? results : results.slice(0, 10);
  return (
    <div className="serp-snapshot-cell">
      <header>
        <b>{kind === "ai" ? <UiText text="ИИ-выдача" /> : <UiText text="Обычная выдача" />}</b>
        <time dateTime={observedAt}>
          {new Intl.DateTimeFormat(locale, {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
          }).format(new Date(observedAt))}
        </time>
        <span>{provider === "XMLSTOCK"
          ? "XMLStock"
          : provider === "KEY_COLLECTOR"
            ? "Key Collector · импорт"
            : "Arsenkin"}</span>
      </header>
      <ol>
        {visible.map((result) => {
          const host = normalizedSerpDomain(result.url) ?? "";
          const watched = watchedDomains.includes(host);
          const tone = semanticUrlBelongsToProject(result.url, projectDomain)
            ? "own"
            : watched
              ? "watched"
              : highlightDuplicateDomains && duplicateHosts.has(host)
                ? "duplicate"
                : undefined;
          return (
            <li
              className={tone}
              key={`${result.position}:${result.url}`}
              style={watched || tone === "duplicate"
                ? domainColorStyle(host, domainColors)
                : undefined}
            >
              <span className="serp-result-rank">{result.position}</span>
              <SemanticSiteFavicon faviconUrl={result.faviconUrl} pageUrl={result.url} />
              <div>
                <strong title={result.title ?? result.url}>{result.title ?? host}</strong>
                <small title={result.snippet}>{result.snippet ?? <UiText text="Описание не передано" />}</small>
                <a href={result.url} rel="noopener noreferrer" target="_blank">
                  <SemanticSerpResultUrl value={result.url} />
                </a>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function domainColorStyle(
  domain: string,
  colors: ReadonlyMap<string, string>
): CSSProperties {
  return {
    "--serp-domain-color": colors.get(domain)
  } as CSSProperties;
}

async function requestSerp(projectId: string, input: object, signal?: AbortSignal): Promise<SerpWorkbenchReport> { const value = await browserApiRequest<unknown>(`/app/api/projects/${encodeURIComponent(projectId)}/rank-workbench/serp`, { method: "POST", body: input, ...(signal ? { signal } : {}) }); return parseSerpWorkbenchReport(value); }
function watchedStorageKey(projectId: string): string { return `seonorita:serp-watched-domains:v1:${projectId}`; }
function readWatchedDomains(projectId: string): readonly string[] { try { const value = JSON.parse(localStorage.getItem(watchedStorageKey(projectId)) ?? "[]"); return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" && normalizedSerpDomain(item) === item ? [item] : []).slice(0, 20) : []; } catch { return []; } }
function writeWatchedDomains(projectId: string, values: readonly string[]): void { try { localStorage.setItem(watchedStorageKey(projectId), JSON.stringify(values)); } catch {} }
function duplicateHighlightStorageKey(projectId: string, currentUserId: string): string { return `seonorita:serp-duplicate-highlight:v1:${currentUserId}:${projectId}`; }
function readDuplicateHighlightPreference(projectId: string, currentUserId: string): boolean { try { return localStorage.getItem(duplicateHighlightStorageKey(projectId, currentUserId)) !== "false"; } catch { return true; } }
function writeDuplicateHighlightPreference(projectId: string, currentUserId: string, value: boolean): void { try { localStorage.setItem(duplicateHighlightStorageKey(projectId, currentUserId), String(value)); } catch {} }

interface SerpColumnPreferences {
  readonly customized: boolean;
  readonly widths: Readonly<Record<string, number>>;
}

function serpColumnStorageKey(projectId: string, currentUserId: string): string {
  return `seonorita:serp-columns:v1:${currentUserId}:${projectId}`;
}

function readSerpColumnPreferences(
  projectId: string,
  currentUserId: string
): SerpColumnPreferences {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(serpColumnStorageKey(projectId, currentUserId)) ?? "null"
    ) as { customized?: unknown; widths?: unknown } | null;
    if (!parsed || typeof parsed.widths !== "object" || !parsed.widths) {
      return { customized: false, widths: {} };
    }
    const widths = Object.fromEntries(
      Object.entries(parsed.widths).flatMap(([key, value]) =>
        typeof value === "number" && Number.isFinite(value)
          ? [[key, Math.min(SERP_COLUMN_MAX, Math.max(150, Math.round(value)))]]
          : []
      )
    );
    return { customized: parsed.customized === true, widths };
  } catch {
    return { customized: false, widths: {} };
  }
}

function writeSerpColumnPreferences(
  projectId: string,
  currentUserId: string,
  preferences: SerpColumnPreferences
): void {
  try {
    localStorage.setItem(
      serpColumnStorageKey(projectId, currentUserId),
      JSON.stringify(preferences)
    );
  } catch {
    // Column resizing remains available for the current page.
  }
}

interface SerpScopePreferences {
  readonly dimensionKeys: readonly string[];
  readonly groupId: string;
  readonly aiOnly: boolean;
}

function serpScopeStorageKey(projectId: string, currentUserId: string): string {
  return `seonorita:serp-scope:v1:${currentUserId}:${projectId}`;
}

function readSerpScopePreferences(
  projectId: string,
  currentUserId: string
): SerpScopePreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(serpScopeStorageKey(projectId, currentUserId)) ?? "null"
    ) as Readonly<Record<string, unknown>> | null;
    if (!value || !Array.isArray(value.dimensionKeys)) {
      return { dimensionKeys: [], groupId: "", aiOnly: false };
    }
    const dimensionKeys = value.dimensionKeys.flatMap((key) =>
      typeof key === "string" && key.length <= 1_000 ? [key] : []
    );
    return {
      dimensionKeys: [...new Set(dimensionKeys)].slice(0, MAX_DIMENSIONS),
      groupId: typeof value.groupId === "string" && value.groupId.length <= 36
        ? value.groupId
        : "",
      aiOnly: value.aiOnly === true
    };
  } catch {
    return { dimensionKeys: [], groupId: "", aiOnly: false };
  }
}

function writeSerpScopePreferences(
  projectId: string,
  currentUserId: string,
  preferences: SerpScopePreferences
): void {
  try {
    localStorage.setItem(
      serpScopeStorageKey(projectId, currentUserId),
      JSON.stringify(preferences)
    );
  } catch {
    // The current view remains usable when browser storage is unavailable.
  }
}
