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
  type SemanticRankEngine
} from "../lib/semantic-rank-presentation";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticModal } from "./semantic-modal";
import { SemanticProjectSerpResults } from "./semantic-project-serp-results";

interface HistoryContextPresentation {
  readonly contextName: string;
  readonly searchEngine: SemanticRankEngine;
  readonly searchSource?: "LIVE" | "SEARCH_API";
  readonly regionLabel?: string;
}

export function SemanticKeywordPositionHistoryModal({
  contextPoints,
  createdAt,
  keywordId,
  keywordText,
  onClose,
  projectId,
  targetUrl
}: Readonly<{
  contextPoints: readonly SemanticKeywordPositionHistoryPoint[];
  createdAt: string;
  keywordId: string;
  keywordText: string;
  onClose: () => void;
  projectId: string;
  targetUrl?: string;
}>) {
  const [range] = useState(() => historyRange(createdAt));
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
    setLoading(true);
    void requestHistoryPage(
      projectId,
      keywordId,
      range,
      undefined,
      controller.signal
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page.data);
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
  }, [keywordId, projectId, range]);

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
        nextCursor
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
  }, [hasNext, keywordId, nextCursor, projectId, range]);

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

  return (
    <>
      <SemanticModal
      description="Все сохранённые съёмы этого запроса во всех контекстах. История загружается блоками по 200 записей и не обрезается последними датами."
      onClose={onClose}
      size="large"
      title={`История позиций · ${keywordText}`}
    >
      <div className="semantic-position-history-full">
        <header>
          <span>Загружено записей: <strong>{items.length.toLocaleString("ru-RU")}</strong></span>
          <span>Новые съёмы выше, старые ниже</span>
        </header>

        {loading ? (
          <div className="semantic-position-history-state" role="status">
            Загружаем историю позиций…
          </div>
        ) : items.length === 0 && !error ? (
          <div className="semantic-position-history-state">
            Сохранённых съёмов пока нет.
          </div>
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

        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        {hasNext && (
          <button
            className="secondary-button semantic-position-history-more"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            ref={loadMoreRef}
            type="button"
          >
            {loadingMore ? "Загружаем следующие записи…" : "Прокрутите ниже или загрузите ещё 200"}
          </button>
        )}
      </div>
      </SemanticModal>
      {selectedSnapshot && (
        <HistorySiteResultsModal
          {...historyContextProps(selectedSnapshot, contextById)}
          item={selectedSnapshot}
          keywordText={keywordText}
          onClose={() => setSelectedSnapshot(undefined)}
          {...(targetUrl ? { targetUrl } : {})}
        />
      )}
    </>
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
  const status = item.found
    ? `Позиция ${item.position}`
    : "Не найдена";
  return (
    <li className={item.found ? undefined : "not-found"}>
      <div className="semantic-position-history-row-head">
        <time dateTime={item.observedAt} title={formatDateTime(item.observedAt)}>
          {formatDateTime(item.observedAt)}
        </time>
        <span title={context?.contextName ?? item.trackingContextId}>
          {context && <SearchEngineLogo engine={context.searchEngine} size="compact" />}
          <b>{context?.contextName ?? `Контекст ${item.trackingContextId.slice(0, 8)}`}</b>
        </span>
        <small>{rankHistoryProviderLabel(item.provider)}</small>
        <div className="semantic-position-history-row-actions">
          <strong>{status}</strong>
          {(item.siteResults?.length ?? 0) > 1 && (
            <button
              aria-label={`Показать ${item.siteResults!.length} страниц сайта в выдаче`}
              className="semantic-keyword-rank-indicator multiple"
              onClick={onOpenSiteResults}
              title={`В выдаче найдено страниц сайта: ${item.siteResults!.length}`}
              type="button"
            >
              <Icon name="multiGroup" />
            </button>
          )}
        </div>
      </div>
      <div className="semantic-position-history-row-body">
        {context?.regionLabel && <small>{context.regionLabel}</small>}
        {item.found ? (
          <>
            {item.title && <span title={item.title}>{item.title}</span>}
            {item.snippet && <span title={item.snippet}>{item.snippet}</span>}
            <a
              href={item.rankingUrl}
              rel="noopener noreferrer"
              target="_blank"
              title={item.rankingUrl}
            >
              {semanticDisplayUrl(item.rankingUrl)}
            </a>
          </>
        ) : (
          <span>В пределах глубины этого съёма страница сайта не найдена.</span>
        )}
      </div>
    </li>
  );
}

function HistorySiteResultsModal({
  context,
  item,
  keywordText,
  onClose,
  targetUrl
}: Readonly<{
  context?: HistoryContextPresentation;
  item: RankHistoryItem;
  keywordText: string;
  onClose: () => void;
  targetUrl?: string;
}>) {
  return (
    <SemanticModal
      description="Страницы проекта и их сохранённые SERP-данные относятся именно к выбранному историческому съёму."
      onClose={onClose}
      size="large"
      title={`Страницы сайта в выдаче · ${keywordText}`}
    >
      <div className="semantic-site-results-modal">
        <section>
          <header>
            <span>
              {context && (
                <SearchEngineLogo engine={context.searchEngine} size="compact" />
              )}
              <strong>{context?.contextName ?? "Исторический съём"}</strong>
            </span>
            <time dateTime={item.observedAt} title={formatDateTime(item.observedAt)}>
              {formatDateTime(item.observedAt)}
            </time>
          </header>
          <SemanticProjectSerpResults
            results={item.siteResults ?? []}
            {...(targetUrl ? { targetUrl } : {})}
          />
        </section>
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
        ...(item.regionLabel ? { regionLabel: item.regionLabel } : {})
      }
    };
  }
  const context = fallback.get(item.trackingContextId);
  return context ? { context } : {};
}

function historyRange(createdAt: string): Readonly<{
  observedFrom: string;
  observedBefore: string;
}> {
  const created = Date.parse(createdAt);
  const observedFrom = Number.isFinite(created)
    ? new Date(Math.max(0, created - 86_400_000)).toISOString()
    : new Date(0).toISOString();
  return {
    observedFrom,
    observedBefore: new Date(Date.now() + 300_000).toISOString()
  };
}

function requestHistoryPage(
  projectId: string,
  keywordId: string,
  range: Readonly<{ observedFrom: string; observedBefore: string }>,
  cursor?: string,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({
    observedFrom: range.observedFrom,
    observedBefore: range.observedBefore,
    keywordId,
    limit: "200"
  });
  if (cursor) query.set("cursor", cursor);
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}
