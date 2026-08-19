"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SemanticAiAnswerHistoryItem } from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiCollectionRequest
} from "../lib/browser-api";
import {
  rankChangePresentation,
  semanticDisplayUrl
} from "../lib/semantic-rank-presentation";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticModal } from "./semantic-modal";

export function SemanticKeywordAiPositionHistoryModal({
  keywordId,
  keywordText,
  onClose,
  projectId
}: Readonly<{
  keywordId: string;
  keywordText: string;
  onClose: () => void;
  projectId: string;
}>) {
  const [items, setItems] = useState<readonly SemanticAiAnswerHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const loadingMoreRef = useRef(false);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setNextCursor(undefined);
    setHasNext(false);
    setError(undefined);
    setLoading(true);
    void requestHistoryPage(projectId, keywordId, undefined, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page.data);
        setHasNext(page.page.hasNext);
        setNextCursor(page.page.nextCursor);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(historyError(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [keywordId, projectId]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasNext || !nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(undefined);
    try {
      const page = await requestHistoryPage(projectId, keywordId, nextCursor);
      setItems((current) => mergeHistoryItems(current, page.data));
      setHasNext(page.page.hasNext);
      setNextCursor(page.page.nextCursor);
    } catch (requestError) {
      setError(historyError(requestError));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasNext, keywordId, nextCursor, projectId]);

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
    <SemanticModal
      description="Все сохранённые проверки ИИ-ответов по этому запросу, независимо от региона и устройства. История загружается блоками по 200 записей."
      onClose={onClose}
      size="large"
      title={`История ИИ-позиций · ${keywordText}`}
    >
      <div className="semantic-position-history-full semantic-ai-position-history-full">
        <header>
          <span>Загружено записей: <strong>{items.length.toLocaleString("ru-RU")}</strong></span>
          <span>Новые съёмы выше, старые ниже</span>
        </header>

        {loading ? (
          <div className="semantic-position-history-state" role="status">
            Загружаем историю ИИ-позиций…
          </div>
        ) : items.length === 0 && !error ? (
          <div className="semantic-position-history-state">
            Сохранённых проверок ИИ-ответов пока нет.
          </div>
        ) : (
          <ol className="semantic-position-history-list semantic-ai-position-history-list">
            {items.map((item) => <HistoryRow item={item} key={item.snapshotId} />)}
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
  );
}

function HistoryRow({ item }: Readonly<{ item: SemanticAiAnswerHistoryItem }>) {
  const status = aiHistoryStatus(item);
  return (
    <li className={item.siteFound ? undefined : "not-found"}>
      <div className="semantic-position-history-row-head">
        <time dateTime={item.observedAt}>{formatDateTime(item.observedAt)}</time>
        <span>
          <SearchEngineLogo engine={item.searchEngine} size="compact" />
          <b>{item.searchEngine === "YANDEX" ? "ИИ-ответ Яндекса" : "ИИ-ответ Google"}</b>
        </span>
        <small>{item.regionCode} · {item.device === "DESKTOP" ? "десктоп" : "мобильное"}</small>
        <div className={`semantic-position-history-row-actions semantic-ai-position-history-row-actions ${status.tone}`}>
          <strong title={status.title}>{status.label}</strong>
        </div>
      </div>
      <div className="semantic-position-history-row-body">
        <small>{item.answerPresent ? "ИИ-ответ найден" : "ИИ-ответ не найден"}{item.brandFound ? " · бренд упомянут" : ""}</small>
        {item.rankingUrl ? (
          <a href={item.rankingUrl} rel="noopener noreferrer" target="_blank" title={item.rankingUrl}>
            {semanticDisplayUrl(item.rankingUrl)}
          </a>
        ) : (
          <span>Сайт проекта в источниках этой проверки не найден.</span>
        )}
      </div>
    </li>
  );
}

function aiHistoryStatus(item: SemanticAiAnswerHistoryItem): Readonly<{
  label: string;
  title: string;
  tone: "declined" | "improved" | "new" | "unchanged";
}> {
  if (item.siteFound && item.position !== undefined) {
    const change = rankChangePresentation(item.position, item.previousPosition);
    return {
      label: `Позиция ${item.position} · ${change.label}`,
      title: change.title,
      tone: change.tone
    };
  }
  if (item.previousPosition !== undefined) {
    return {
      label: `Не найдена · была ${item.previousPosition}`,
      title: `Сайт не найден в текущем ИИ-ответе. Предыдущая найденная позиция: ${item.previousPosition}`,
      tone: "declined"
    };
  }
  return {
    label: item.answerPresent ? "Сайт не найден" : "Нет ИИ-ответа",
    title: item.answerPresent
      ? "ИИ-ответ найден, но сайт проекта отсутствует в источниках"
      : "Поисковик не вернул ИИ-ответ",
    tone: "unchanged"
  };
}

function requestHistoryPage(
  projectId: string,
  keywordId: string,
  cursor?: string,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({ limit: "200" });
  if (cursor) query.set("cursor", cursor);
  return browserApiCollectionRequest<SemanticAiAnswerHistoryItem>(
    `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}/ai-answers/history?${query.toString()}`,
    signal ? { signal } : undefined
  );
}

function mergeHistoryItems(
  current: readonly SemanticAiAnswerHistoryItem[],
  next: readonly SemanticAiAnswerHistoryItem[]
): readonly SemanticAiAnswerHistoryItem[] {
  const seen = new Set(current.map(({ snapshotId }) => snapshotId));
  return [...current, ...next.filter(({ snapshotId }) => !seen.has(snapshotId))];
}

function historyError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    return error.status === 403
      ? "Недостаточно прав для просмотра истории ИИ-позиций."
      : error.status === 503
        ? "История временно недоступна. Повторите попытку позже."
        : error.message;
  }
  return "Не удалось загрузить историю ИИ-позиций.";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}
