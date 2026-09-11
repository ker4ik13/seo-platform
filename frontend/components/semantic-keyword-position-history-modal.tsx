"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RankHistoryItem,
  SemanticKeywordPositionHistoryPoint
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiCollectionRequest
} from "../lib/browser-api";
import {
  rankHistoryProviderLabel,
  semanticDisplayUrl,
  semanticUrlBelongsToProject,
  type SemanticRankEngine
} from "../lib/semantic-rank-presentation";
import {
  searchContextDisplayName,
  searchRegionDisplayName
} from "../lib/seo-regions";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticModal } from "./semantic-modal";
import { SemanticProjectSerpResults } from "./semantic-project-serp-results";
import { useUiLocale, UiText } from "./ui-locale";


interface HistoryContextPresentation {
  readonly contextName: string;
  readonly searchEngine: SemanticRankEngine;
  readonly searchSource?: "LIVE" | "SEARCH_API";
  readonly regionLabel?: string;
  readonly device?: "DESKTOP" | "MOBILE";
  readonly regionCode?: string;
}

export function SemanticKeywordPositionHistoryModal({
  contextPoints,
  createdAt,
  initialObservedAt,
  keywordId,
  keywordText,
  initialSiteResultsSnapshotId,
  onClose,
  projectId,
  showUrlComparison = false,
  targetUrl,
  dimensionKey
}: Readonly<{
  contextPoints: readonly SemanticKeywordPositionHistoryPoint[];
  createdAt: string;
  initialObservedAt?: string;
  keywordId: string;
  keywordText: string;
  initialSiteResultsSnapshotId?: string;
  onClose: () => void;
  projectId: string;
  showUrlComparison?: boolean;
  targetUrl?: string;
  dimensionKey?: string | undefined;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const range = useMemo(
    () => showUrlComparison && initialObservedAt
      ? snapshotHistoryRange(initialObservedAt)
      : historyRange(createdAt),
    [createdAt, initialObservedAt, showUrlComparison]
  );
  const [items, setItems] = useState<readonly RankHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedSnapshot, setSelectedSnapshot] = useState<RankHistoryItem>();
  const loadingMoreRef = useRef(false);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const contextById = useMemo(
    () => historyContextMap(contextPoints),
    [contextPoints]
  );

  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setNextCursor(undefined);
    setHasNext(false);
    setError(undefined);
    setSelectedSnapshot(undefined);
    setLoading(true);
    void requestHistoryPage(
      projectId,
      keywordId,
      range,
      undefined,
      controller.signal,
      dimensionKey,
      showUrlComparison
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page.data);
        if (initialSiteResultsSnapshotId) {
          setSelectedSnapshot(
            page.data.find(({ snapshotId }) => snapshotId === initialSiteResultsSnapshotId) ??
            (showUrlComparison ? page.data[0] : undefined)
          );
        }
        setHasNext(page.page.hasNext);
        setNextCursor(page.page.nextCursor);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setError(historyError(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [dimensionKey, initialSiteResultsSnapshotId, keywordId, projectId, range, showUrlComparison]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasNext || !nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(undefined);
    try {
      const page = await requestHistoryPage(
        projectId,
        keywordId,
        range,
        nextCursor,
        undefined,
        dimensionKey,
        showUrlComparison
      );
      setItems((current) => mergeHistoryItems(current, page.data));
      setHasNext(page.page.hasNext);
      setNextCursor(page.page.nextCursor);
    } catch (requestError) {
      setError(historyError(requestError));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasNext, keywordId, nextCursor, projectId, range, dimensionKey, showUrlComparison]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasNext) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(({ isIntersecting }) => isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "180px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNext, loadMore]);

  if (initialSiteResultsSnapshotId) {
    return (
      <HistorySiteResultsModal
        {...(selectedSnapshot ? historyContextProps(selectedSnapshot, contextById) : {})}
        {...(error ? { error } : {})}
        {...(selectedSnapshot ? { item: selectedSnapshot } : {})}
        keywordText={keywordText}
        loading={loading}
        onClose={onClose}
        showUrlComparison={showUrlComparison}
        {...(targetUrl ? { targetUrl } : {})}
      />
    );
  }

  if (selectedSnapshot) {
    return (
      <HistorySiteResultsModal
        {...historyContextProps(selectedSnapshot, contextById)}
        item={selectedSnapshot}
        keywordText={keywordText}
        onClose={() => setSelectedSnapshot(undefined)}
        showUrlComparison={showUrlComparison}
        {...(targetUrl ? { targetUrl } : {})}
      />
    );
  }

  return (
    <SemanticModal
      bodyLayout="edge"
      description={uiText(dimensionKey ? "Сохранённые позиции выбранного города и устройства. История загружается блоками по 200 записей." : "Все сохранённые съёмы этого запроса во всех контекстах. История загружается блоками по 200 записей и не обрезается последними датами.")}
      onClose={onClose}
      size="large"
      title={uiText("История позиций · {0}", [String(keywordText)])}
    >
      <div className="semantic-position-history-full">
        <header>
          <span><UiText text="Загружено записей:" after=" " /><strong>{items.length.toLocaleString(uiLocale)}</strong></span>
          <span><UiText text="Новые съёмы выше, старые ниже" /></span>
        </header>

        {loading ? (
          <div className="semantic-position-history-state" role="status">
            <UiText text="Загружаем историю позиций…" /></div>
        ) : items.length === 0 && !error ? (
          <div className="semantic-position-history-state">
            <UiText text="Сохранённых съёмов пока нет." /></div>
        ) : (
          <ol className="semantic-position-history-list">
            {items.map((item) => (
              <HistoryRow
                {...historyContextProps(item, contextById)}
                item={item}
                key={item.snapshotId}
                onOpenSiteResults={() => setSelectedSnapshot(item)}
              />
            ))}
          </ol>
        )}

        {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
        {hasNext && (
          <button
            className="secondary-button semantic-position-history-more"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            ref={loadMoreRef}
            type="button"
          >
            {loadingMore ? <UiText text="Загружаем следующие записи…" /> : <UiText text="Прокрутите ниже или загрузите ещё 200" />}
          </button>
        )}
      </div>
    </SemanticModal>
  );
}

function HistoryRow({
  context,
  item,
  onOpenSiteResults
}: Readonly<{
  context?: HistoryContextPresentation;
  item: RankHistoryItem;
  onOpenSiteResults: () => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const status = item.found
    ? `Позиция ${item.position}`
    : "Не найдена";
  const contextName = context ? historyContextName(context) : undefined;
  return (
    <li className={item.found ? undefined : "not-found"}>
      <div className="semantic-position-history-row-head">
        <time dateTime={item.observedAt} title={formatDateTime(item.observedAt, uiLocale)}>
          {formatDateTime(item.observedAt, uiLocale)}
        </time>
        <span title={contextName ?? item.trackingContextId}>
          {context && <SearchEngineLogo engine={context.searchEngine} size="compact" />}
          <b>{contextName ?? <UiText text="Контекст {0}" values={[String(item.trackingContextId.slice(0, 8))]} />}</b>
        </span>
        <small>{<UiText text={rankHistoryProviderLabel(item.provider) ?? ""} />}</small>
        <div className="semantic-position-history-row-actions">
          <strong>{status}</strong>
          {(item.siteResults?.length ?? 0) > 1 && (
            <button
              aria-label={uiText("Показать {0} страниц сайта в выдаче", [String(item.siteResults!.length)])}
              className="semantic-keyword-rank-indicator multiple"
              onClick={onOpenSiteResults}
              title={uiText("В выдаче найдено страниц сайта: {0}", [String(item.siteResults!.length)])}
              type="button"
            >
              <Icon name="multiGroup" />
            </button>
          )}
        </div>
      </div>
      <div className="semantic-position-history-row-body">
        {context && <small>{searchRegionDisplayName(context.searchEngine, context.regionCode, context.regionLabel)}{context.device ? <> · <UiText text={context.device === "DESKTOP" ? "ПК" : "Телефон"} /></> : null}{item.depth ? <> · <UiText text="Топ-" />{item.depth}</> : null}</small>}
        {item.found ? (
          <>
            {item.title && <span title={item.title}>{item.title}</span>}
            {item.snippet && <span title={item.snippet}>{item.snippet}</span>}
            {item.rankingUrl ? (
              <a
                href={item.rankingUrl}
                rel="noopener noreferrer"
                target="_blank"
                title={item.rankingUrl}
              >
                {semanticDisplayUrl(item.rankingUrl)}
              </a>
            ) : (
              <span><UiText text="URL не сохранён" /></span>
            )}
          </>
        ) : (
          <span><UiText text="В пределах глубины этого съёма страница сайта не найдена." /></span>
        )}
      </div>
    </li>
  );
}

function HistorySiteResultsModal({
  context,
  error,
  item,
  keywordText,
  loading = false,
  onClose,
  showUrlComparison,
  targetUrl
}: Readonly<{
  context?: HistoryContextPresentation;
  error?: string;
  item?: RankHistoryItem;
  keywordText: string;
  loading?: boolean;
  onClose: () => void;
  showUrlComparison: boolean;
  targetUrl?: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [showDifferences, setShowDifferences] = useState(false);
  const results = item
    ? showUrlComparison
      ? targetUrl
        ? (item.serpResults ?? item.siteResults ?? []).filter(({ rankingUrl }) =>
            semanticUrlBelongsToProject(rankingUrl, targetUrl)
          )
        : item.siteResults ?? []
      : item.siteResults ?? []
    : [];
  return (
    <SemanticModal
      bodyLayout="edge"
      description={uiText(showUrlComparison
        ? "Страницы домена из сохранённой выдачи относятся именно к выбранному историческому съёму."
        : "Страницы проекта и их сохранённые SERP-данные относятся именно к выбранному историческому съёму.")}
      onClose={onClose}
      size="large"
      title={uiText(showUrlComparison ? "Нерелевантный URL · {0}" : "Страницы сайта в выдаче · {0}", [String(keywordText)])}
    >
      <div className="semantic-site-results-modal">
        {showUrlComparison && (
          <div className="semantic-url-comparison-toolbar">
            <div><span><UiText text="Целевой URL" /></span><strong>{targetUrl ?? <UiText text="Не задан" />}</strong></div>
            <label><input checked={showDifferences} disabled={!targetUrl} onChange={(event) => setShowDifferences(event.target.checked)} type="checkbox" /><UiText text="Показать различия" /></label>
          </div>
        )}
        {item ? <section>
          <header>
            <span>
              {context && (
                <SearchEngineLogo engine={context.searchEngine} size="compact" />
              )}
              <strong>{context ? historyContextName(context) : <UiText text="Исторический съём" />}</strong>
            </span>
            <time dateTime={item.observedAt} title={formatDateTime(item.observedAt, uiLocale)}>
              {formatDateTime(item.observedAt, uiLocale)}
            </time>
          </header>
          <SemanticProjectSerpResults
            results={results}
            showUrlDifferences={showDifferences}
            {...(targetUrl ? { targetUrl } : {})}
          />
        </section> : (
          <div className="semantic-site-results-empty" role={error ? "alert" : loading ? "status" : undefined}>
            {loading
              ? <><i className="spinner compact" /><UiText text="Загружаем сохранённую выдачу…" /></>
              : error
                ? <UiText text={error} />
                : <UiText text="Сохранённая выдача для этой позиции недоступна." />}
          </div>
        )}
      </div>
    </SemanticModal>
  );
}

function historyContextMap(
  points: readonly SemanticKeywordPositionHistoryPoint[]
): ReadonlyMap<string, HistoryContextPresentation> {
  const result = new Map<string, HistoryContextPresentation>();
  for (const point of points) {
    if (result.has(point.trackingContextId)) continue;
    result.set(point.trackingContextId, {
      contextName: point.contextName,
      searchEngine: point.searchEngine,
      device: point.device,
      regionCode: point.regionCode,
      ...(point.searchSource ? { searchSource: point.searchSource } : {}),
      ...(point.regionLabel ? { regionLabel: point.regionLabel } : {})
    });
  }
  return result;
}

function historyContextProps(
  item: RankHistoryItem,
  fallback: ReadonlyMap<string, HistoryContextPresentation>
): Readonly<{ context?: HistoryContextPresentation }> {
  if (item.contextName && item.searchEngine) {
    return {
      context: {
        contextName: item.contextName,
        searchEngine: item.searchEngine,
        ...(item.searchSource ? { searchSource: item.searchSource } : {}),
        ...(item.regionLabel ? { regionLabel: item.regionLabel } : {}),
        ...(item.device ? { device: item.device } : {}),
        ...(item.regionCode ? { regionCode: item.regionCode } : {})
      }
    };
  }
  const context = fallback.get(item.trackingContextId);
  return context ? { context } : {};
}

function historyContextName(context: HistoryContextPresentation): string {
  return searchContextDisplayName(
    context.contextName,
    context.searchEngine,
    context.regionCode,
    context.regionLabel
  );
}

function historyRange(createdAt: string): Readonly<{
  observedFrom: string;
  observedBefore: string;
}> {
  // Imported observations can legitimately predate the day on which the
  // canonical keyword was created in this project.
  void createdAt;
  return {
    observedFrom: new Date(0).toISOString(),
    observedBefore: new Date(Date.now() + 300_000).toISOString()
  };
}

function snapshotHistoryRange(observedAt: string): Readonly<{
  observedFrom: string;
  observedBefore: string;
}> {
  const timestamp = Date.parse(observedAt);
  return Number.isNaN(timestamp)
    ? historyRange(observedAt)
    : {
        observedFrom: new Date(timestamp - 1_000).toISOString(),
        observedBefore: new Date(timestamp + 1_000).toISOString()
      };
}

function requestHistoryPage(
  projectId: string,
  keywordId: string,
  range: Readonly<{ observedFrom: string; observedBefore: string }>,
  cursor?: string,
  signal?: AbortSignal,
  dimensionKey?: string,
  fullSerp = false
) {
  const query = new URLSearchParams({
    observedFrom: range.observedFrom,
    observedBefore: range.observedBefore,
    keywordId,
    limit: fullSerp ? "10" : "200"
  });
  if (cursor) query.set("cursor", cursor);
  if (dimensionKey) query.set("dimensionKey", dimensionKey);
  if (fullSerp) query.set("mode", "SERP");
  return browserApiCollectionRequest<RankHistoryItem>(
    `/app/api/projects/${encodeURIComponent(projectId)}/rank-history?${query.toString()}`,
    signal ? { signal } : undefined
  );
}

function mergeHistoryItems(
  current: readonly RankHistoryItem[],
  next: readonly RankHistoryItem[]
): readonly RankHistoryItem[] {
  const seen = new Set(current.map(({ snapshotId }) => snapshotId));
  return [...current, ...next.filter(({ snapshotId }) => !seen.has(snapshotId))];
}

function historyError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    return error.status === 403
      ? "Недостаточно прав для просмотра истории позиций."
      : error.status === 503
        ? "История временно недоступна. Повторите попытку позже."
        : error.message;
  }
  return "Не удалось загрузить историю позиций.";
}

function formatDateTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(uiLocale, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}
