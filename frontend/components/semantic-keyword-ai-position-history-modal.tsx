"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseSemanticRankDimensionKey,
  type SemanticAiAnswerCompetitorSnapshot,
  type SemanticAiAnswerHistoryItem
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiCollectionRequest
} from "../lib/browser-api";
import {
  rankChangePresentation,
  semanticDisplayUrl
} from "../lib/semantic-rank-presentation";
import { serpMovementKey, serpMovements } from "../lib/serp-movement";
import { SemanticCompetitorSnapshots } from "./semantic-competitor-snapshots";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticModal } from "./semantic-modal";
import { useUiLocale, UiText } from "./ui-locale";


export function SemanticKeywordAiPositionHistoryModal({
  currentUserId,
  dimensionKey,
  keywordId,
  keywordText,
  onClose,
  onOpenAiAnswer,
  projectDomain,
  projectId
}: Readonly<{
  currentUserId: string;
  dimensionKey?: string;
  keywordId: string;
  keywordText: string;
  onClose: () => void;
  onOpenAiAnswer: () => void;
  projectDomain: string;
  projectId: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [items, setItems] = useState<readonly SemanticAiAnswerHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [showMovement, setShowMovement] = useState(false);
  const loadingMoreRef = useRef(false);
  const loadMoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setShowMovement(readMovementPreference(currentUserId));
  }, [currentUserId]);

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

  const selectedDimension = dimensionKey
    ? parseSemanticRankDimensionKey(dimensionKey)
    : undefined;
  const visibleItems = useMemo(
    () => selectedDimension
      ? items.filter((item) =>
          item.searchEngine === selectedDimension.searchEngine &&
          item.regionCode === selectedDimension.regionCode &&
          item.device === selectedDimension.device
        )
      : items,
    [items, selectedDimension]
  );
  const snapshots = useMemo<readonly SemanticAiAnswerCompetitorSnapshot[]>(
    () => visibleItems
      .filter(({ results }) => results.length > 0)
      .map((item) => ({
        snapshotId: item.snapshotId,
        searchEngine: item.searchEngine,
        regionCode: item.regionCode,
        device: item.device,
        provider: item.provider,
        observedAt: item.observedAt,
        results: item.results
      })),
    [visibleItems]
  );
  const movements = useMemo(() => serpMovements(snapshots), [snapshots]);
  const canShowMovement = snapshots.length > 1;
  const movementForResult = showMovement && canShowMovement
    ? (snapshotId: string, resultUrl: string) =>
        movements.get(serpMovementKey(snapshotId, resultUrl))
    : undefined;
  const itemsWithoutSources = visibleItems.filter(({ results }) => results.length === 0);

  return (
    <SemanticModal
      bodyLayout="edge"
      description={uiText(dimensionKey ? "Все сохранённые ИИ-ответы и источники выбранного города и устройства." : "Все сохранённые ИИ-ответы и источники этого запроса.")}
      headerActions={<div className="semantic-ai-history-actions">
        <button className="secondary-button" onClick={() => { onClose(); onOpenAiAnswer(); }} type="button"><UiText text="Открыть ИИ-ответ" /></button>
        <label className="semantic-serp-movement-toggle" title={canShowMovement ? undefined : uiText("Для сравнения нужны минимум два съёма")}>
          <input checked={showMovement} disabled={!canShowMovement} onChange={(event) => { setShowMovement(event.target.checked); writeMovementPreference(currentUserId, event.target.checked); }} type="checkbox" />
          <UiText text="Показать движение" />
        </label>
      </div>}
      onClose={onClose}
      size="large"
      title={uiText("История ИИ-выдачи и конкурентов · {0}", [String(keywordText)])}
    >
      <div className="semantic-position-history-full semantic-ai-position-history-full">
        <header>
          <span><UiText text="Загружено записей:" after=" " /><strong>{items.length.toLocaleString(uiLocale)}</strong></span>
          <span><UiText text="Новые съёмы выше, старые ниже" /></span>
        </header>

        {loading ? (
          <div className="semantic-position-history-state" role="status">
            <UiText text="Загружаем историю ИИ-позиций…" /></div>
        ) : visibleItems.length === 0 && !error ? (
          <div className="semantic-position-history-state">
            <UiText text="Сохранённых проверок ИИ-ответов пока нет." /></div>
        ) : (
          <>
            <SemanticCompetitorSnapshots
              heading={uiText("Сохранённая ИИ-выдача")}
              projectDomain={projectDomain}
              showEmpty={false}
              snapshots={snapshots}
              {...(movementForResult ? { movementForResult } : {})}
            />
            {itemsWithoutSources.length > 0 && <ol className="semantic-position-history-list semantic-ai-position-history-list">
              {itemsWithoutSources.map((item) => <HistoryRow item={item} key={item.snapshotId} />)}
            </ol>}
          </>
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

function HistoryRow({ item }: Readonly<{ item: SemanticAiAnswerHistoryItem }>) {
  const uiLocale = useUiLocale().locale;
  const status = aiHistoryStatus(item);
  return (
    <li className={item.siteFound ? undefined : "not-found"}>
      <div className="semantic-position-history-row-head">
        <time dateTime={item.observedAt}>{formatDateTime(item.observedAt, uiLocale)}</time>
        <span>
          <SearchEngineLogo engine={item.searchEngine} size="compact" />
          <b>{item.searchEngine === "YANDEX" ? <UiText text="ИИ-ответ Яндекса" /> : <UiText text="ИИ-ответ Google" />}</b>
        </span>
        <small>{item.regionCode} · {item.device === "DESKTOP" ? <UiText text="десктоп" /> : <UiText text="мобильное" />}</small>
        <div className={`semantic-position-history-row-actions semantic-ai-position-history-row-actions ${status.tone}`}>
          <strong title={status.title}>{status.label}</strong>
        </div>
      </div>
      <div className="semantic-position-history-row-body">
        <small>{item.answerPresent ? <UiText text="ИИ-ответ найден" /> : <UiText text="ИИ-ответ не найден" />}{item.brandFound ? <UiText text="· бренд упомянут" before=" " /> : ""}</small>
        {item.rankingUrl ? (
          <a href={item.rankingUrl} rel="noopener noreferrer" target="_blank" title={item.rankingUrl}>
            {semanticDisplayUrl(item.rankingUrl)}
          </a>
        ) : (
          <span><UiText text="Сайт проекта в источниках этой проверки не найден." /></span>
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

function formatDateTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}

function movementPreferenceKey(currentUserId: string): string {
  return `seonorita:ai-serp-history-movement:v1:${currentUserId}`;
}

function readMovementPreference(currentUserId: string): boolean {
  try {
    return localStorage.getItem(movementPreferenceKey(currentUserId)) === "true";
  } catch {
    return false;
  }
}

function writeMovementPreference(currentUserId: string, value: boolean): void {
  try {
    localStorage.setItem(movementPreferenceKey(currentUserId), String(value));
  } catch {
    // The current modal still keeps the preference while it is open.
  }
}
