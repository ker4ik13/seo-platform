"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import type {
  RankHistoryItem,
  TrackingContextSettings,
  TrackingContextSummary
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiCollectionRequest,
  browserApiRequest,
  type BrowserCursorPage
} from "../lib/browser-api";
import {
  defaultRankHistoryDateSelection,
  mergeRankHistoryItems,
  parseRankHistoryCollection,
  rankHistoryApiPath,
  rankHistoryKeywordPageSize,
  rankHistoryPageSize,
  rankHistoryRangeFromDates,
  rankHistoryReturnTo,
  type RankHistoryRequest
} from "../lib/rank-history";
import {
  trackingContextApiPath,
  trackingContextsApiPath,
  trackingContextsReturnTo
} from "../lib/tracking-contexts";
import {
  trackingDeviceLabel,
  trackingGeographyLabel,
  trackingSearchEngineLabel
} from "../lib/tracking-context-presentation";

interface HistoryFailure {
  readonly kind:
    | "forbidden"
    | "invalid-response"
    | "not-found"
    | "offline"
    | "rate-limited"
    | "recoverable"
    | "validation";
  readonly message: string;
  readonly requestId?: string;
}

interface KeywordOption {
  readonly keywordId: string;
  readonly textOriginal: string;
}

export function RankHistory({
  projectId,
  projectStatus,
  workspaceStatus
}: Readonly<{
  projectId: string;
  projectStatus: "DRAFT" | "ACTIVE" | "ARCHIVED";
  workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
}>) {
  const initialDates = useMemo(
    () => defaultRankHistoryDateSelection(),
    []
  );
  const initialRange = useMemo(
    () =>
      rankHistoryRangeFromDates(
        initialDates.fromDate,
        initialDates.toDate
      ),
    [initialDates]
  );
  const returnTo = rankHistoryReturnTo(projectId);
  const [online, setOnline] = useState(true);
  const [settings, setSettings] = useState<TrackingContextSettings>();
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsFailure, setSettingsFailure] =
    useState<HistoryFailure>();
  const [settingsRetryVersion, setSettingsRetryVersion] = useState(0);
  const [selectedContextId, setSelectedContextId] = useState("");
  const [fromDate, setFromDate] = useState(initialDates.fromDate);
  const [toDate, setToDate] = useState(initialDates.toDate);
  const [keywordOptions, setKeywordOptions] =
    useState<readonly KeywordOption[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [keywordsTruncated, setKeywordsTruncated] = useState(false);
  const [keywordsFailure, setKeywordsFailure] = useState<string>();
  const [selectedKeywordId, setSelectedKeywordId] = useState("");
  const [appliedRequest, setAppliedRequest] =
    useState<RankHistoryRequest>();
  const [items, setItems] =
    useState<readonly RankHistoryItem[]>([]);
  const [page, setPage] =
    useState<BrowserCursorPage>({ hasNext: false });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyFailure, setHistoryFailure] =
    useState<HistoryFailure>();
  const [historyRetryVersion, setHistoryRetryVersion] = useState(0);
  const loadMoreLock = useRef(false);
  const appliedRequestRef = useRef(appliedRequest);
  appliedRequestRef.current = appliedRequest;
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
    if (!online) {
      setSettingsLoading(false);
      setSettingsFailure(offlineFailure());
      return () => controller.abort();
    }
    setSettingsLoading(true);
    setSettingsFailure(undefined);
    void browserApiRequest<TrackingContextSettings>(
      trackingContextsApiPath(projectId),
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setSettings(result);
        setSelectedContextId((current) => {
          if (result.contexts.some(({ id }) => id === current)) {
            return current;
          }
          return (
            result.contexts.find(({ status }) => status === "ACTIVE")
              ?.id ??
            result.contexts[0]?.id ??
            ""
          );
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (redirectForExpiredSession(error, returnTo)) return;
        setSettingsFailure(historyFailureFrom(error, navigator.onLine));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettingsLoading(false);
      });
    return () => controller.abort();
  }, [online, projectId, returnTo, settingsRetryVersion]);

  useEffect(() => {
    if (!selectedContextId) {
      setAppliedRequest(undefined);
      setItems([]);
      setPage({ hasNext: false });
      return;
    }
    setSelectedKeywordId("");
    setItems([]);
    setPage({ hasNext: false });
    try {
      setHistoryFailure(undefined);
      setAppliedRequest({
        ...rankHistoryRangeFromDates(
          dateDraftRef.current.fromDate,
          dateDraftRef.current.toDate
        ),
        trackingContextId: selectedContextId,
        limit: rankHistoryPageSize
      });
    } catch {
      setAppliedRequest(undefined);
      setHistoryFailure(invalidRangeFailure());
    }
  }, [selectedContextId]);

  useEffect(() => {
    const controller = new AbortController();
    setKeywordOptions([]);
    setKeywordsTruncated(false);
    setKeywordsFailure(undefined);
    if (!selectedContextId) {
      setKeywordsLoading(false);
      return () => controller.abort();
    }
    if (!online) {
      setKeywordsLoading(false);
      setKeywordsFailure(
        "Нет соединения: фильтр по запросу временно недоступен."
      );
      return () => controller.abort();
    }
    setKeywordsLoading(true);
    const query = new URLSearchParams({
      limit: String(rankHistoryKeywordPageSize)
    });
    void browserApiCollectionRequest<unknown>(
      `${trackingContextApiPath(projectId, selectedContextId)}/keywords?${query.toString()}`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        const options = parseKeywordOptions(
          result.data,
          selectedContextId
        );
        setKeywordOptions(options);
        setKeywordsTruncated(result.page.hasNext);
        setSelectedKeywordId((current) =>
          current &&
          options.some(({ keywordId }) => keywordId === current)
            ? current
            : ""
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (redirectForExpiredSession(error, returnTo)) return;
        setKeywordsFailure(keywordFailureMessage(error, navigator.onLine));
      })
      .finally(() => {
        if (!controller.signal.aborted) setKeywordsLoading(false);
      });
    return () => controller.abort();
  }, [online, projectId, returnTo, selectedContextId]);

  useEffect(() => {
    const controller = new AbortController();
    if (!appliedRequest) {
      setHistoryLoading(false);
      return () => controller.abort();
    }
    if (!online) {
      setHistoryLoading(false);
      setHistoryFailure(offlineFailure());
      return () => controller.abort();
    }
    setHistoryLoading(true);
    setHistoryFailure(undefined);
    void loadHistoryPage(projectId, appliedRequest, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.data);
        setPage(result.page);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (redirectForExpiredSession(error, returnTo)) return;
        setHistoryFailure(historyFailureFrom(error, navigator.onLine));
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [
    appliedRequest,
    historyRetryVersion,
    online,
    projectId,
    returnTo
  ]);

  const selectedContext = useMemo(
    () =>
      settings?.contexts.find(({ id }) => id === selectedContextId),
    [selectedContextId, settings]
  );
  const keywordLabels = useMemo(
    () =>
      new Map(
        keywordOptions.map(({ keywordId, textOriginal }) => [
          keywordId,
          textOriginal
        ])
      ),
    [keywordOptions]
  );
  const filtersApplied =
    Boolean(appliedRequest?.keywordId) ||
    appliedRequest?.observedFrom !== initialRange.observedFrom ||
    appliedRequest?.observedBefore !== initialRange.observedBefore;

  function selectContext(contextId: string): void {
    setSelectedContextId(contextId);
  }

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedContextId) return;
    try {
      const range = rankHistoryRangeFromDates(fromDate, toDate);
      setItems([]);
      setPage({ hasNext: false });
      setHistoryFailure(undefined);
      setAppliedRequest({
        ...range,
        trackingContextId: selectedContextId,
        ...(selectedKeywordId
          ? { keywordId: selectedKeywordId }
          : {}),
        limit: rankHistoryPageSize
      });
    } catch {
      setHistoryFailure(invalidRangeFailure());
    }
  }

  async function loadMore(): Promise<void> {
    if (
      loadMoreLock.current ||
      historyLoading ||
      historyLoadingMore ||
      !appliedRequest ||
      !page.hasNext ||
      !page.nextCursor
    ) {
      return;
    }
    if (!online) {
      setHistoryFailure(offlineFailure());
      return;
    }
    loadMoreLock.current = true;
    setHistoryLoadingMore(true);
    setHistoryFailure(undefined);
    try {
      const request = appliedRequest;
      const currentItems = items;
      const nextCursor = page.nextCursor;
      const result = await loadHistoryPage(projectId, {
        ...request,
        cursor: nextCursor
      });
      if (appliedRequestRef.current !== request) return;
      const merged = mergeRankHistoryItems(currentItems, result.data);
      setItems(merged);
      setPage(result.page);
    } catch (error) {
      if (redirectForExpiredSession(error, returnTo)) return;
      setHistoryFailure(historyFailureFrom(error, navigator.onLine));
    } finally {
      loadMoreLock.current = false;
      setHistoryLoadingMore(false);
    }
  }

  const restrictionMessage = historyRestrictionMessage(
    projectStatus,
    workspaceStatus,
    selectedContext
  );

  return (
    <section
      aria-busy={settingsLoading || historyLoading}
      className="rank-history-stack"
    >
      <div className="inline-alert info rank-history-boundary-note">
        <strong>Только сохранённые снимки.</strong>{" "}
        Экран читает нормализованную историю; запуск и опрос внешнего
        провайдера здесь не выполняются.
      </div>

      {!online && (
        <div className="inline-alert warning rank-history-offline" role="status">
          <strong>Нет соединения.</strong>{" "}
          Уже загруженные строки остаются видимыми. Новая страница загрузится
          автоматически после восстановления сети.
        </div>
      )}

      {restrictionMessage && (
        <div className="inline-alert warning" role="status">
          {restrictionMessage}
        </div>
      )}

      {settingsFailure && settings && (
        <HistoryAlert
          failure={settingsFailure}
          onRetry={() =>
            setSettingsRetryVersion((version) => version + 1)
          }
        />
      )}

      {settingsLoading && !settings ? (
        <HistoryLoading label="Загружаем контексты отслеживания…" />
      ) : settingsFailure && !settings ? (
        <HistoryFailureCard
          failure={settingsFailure}
          onRetry={() =>
            setSettingsRetryVersion((version) => version + 1)
          }
        />
      ) : settings && settings.contexts.length === 0 ? (
        <section className="security-card panel-card rank-history-empty">
          <span aria-hidden="true" className="rank-history-empty-mark">
            ↗
          </span>
          <h2>Сначала создайте контекст отслеживания</h2>
          <p>
            История привязана к версии поисковых параметров и назначенным
            запросам. Без контекста корректно отфильтровать снимки нельзя.
          </p>
          <a
            className="primary-button"
            href={trackingContextsReturnTo(projectId)}
          >
            Открыть контексты
          </a>
        </section>
      ) : settings ? (
        <>
          <form
            className="security-card panel-card rank-history-filters"
            onSubmit={submitFilters}
          >
            <header>
              <div>
                <h2>Фильтр истории</h2>
                <p>
                  Даты интерпретируются как полные календарные дни UTC.
                </p>
              </div>
              <span className="security-status">
                {items.length} на экране
              </span>
            </header>
            <div className="rank-history-filter-grid">
              <label className="form-field rank-history-context-field">
                <span>Контекст</span>
                <select
                  onChange={(event) => selectContext(event.target.value)}
                  required
                  value={selectedContextId}
                >
                  {settings.contexts.map((context) => (
                    <option key={context.id} value={context.id}>
                      {context.name} ·{" "}
                      {trackingSearchEngineLabel(
                        context.configuration.searchEngine
                      )}{" "}
                      ·{" "}
                      {trackingDeviceLabel(
                        context.configuration.device
                      )}
                      {context.status === "ARCHIVED"
                        ? " · архив"
                        : ""}
                    </option>
                  ))}
                </select>
                {selectedContext && (
                  <small>
                    {trackingGeographyLabel(selectedContext)} · конфигурация v
                    {selectedContext.configuration.configurationVersion}
                  </small>
                )}
              </label>
              <label className="form-field">
                <span>С даты, UTC</span>
                <input
                  onChange={(event) => setFromDate(event.target.value)}
                  required
                  type="date"
                  value={fromDate}
                />
              </label>
              <label className="form-field">
                <span>По дату, UTC</span>
                <input
                  onChange={(event) => setToDate(event.target.value)}
                  required
                  type="date"
                  value={toDate}
                />
              </label>
              <label className="form-field rank-history-keyword-field">
                <span>Назначенный запрос</span>
                <select
                  disabled={keywordsLoading || keywordOptions.length === 0}
                  onChange={(event) =>
                    setSelectedKeywordId(event.target.value)
                  }
                  value={selectedKeywordId}
                >
                  <option value="">
                    {keywordsLoading
                      ? "Загружаем запросы…"
                      : "Все назначенные запросы"}
                  </option>
                  {keywordOptions.map((keyword) => (
                    <option
                      key={keyword.keywordId}
                      value={keyword.keywordId}
                    >
                      {keyword.textOriginal}
                    </option>
                  ))}
                </select>
                <small>
                  {keywordsFailure ??
                    (keywordsTruncated
                      ? `Показаны первые ${rankHistoryKeywordPageSize} назначений. История без фильтра включает остальные.`
                      : "Фильтр необязателен.")}
                </small>
              </label>
              <button
                className="primary-button rank-history-submit"
                disabled={!selectedContextId || historyLoading}
                type="submit"
              >
                {historyLoading ? "Загружаем…" : "Показать"}
              </button>
            </div>
            {settings.contextsTruncated && (
              <p className="rank-history-truncated-note">
                Список контекстов ограничен ответом сервиса. Нужный контекст
                можно открыть и уточнить в разделе «Контексты».
              </p>
            )}
          </form>

          <section
            aria-live="polite"
            className="security-card panel-card rank-history-results"
          >
            <header className="rank-history-results-heading">
              <div>
                <h2>Снимки позиций</h2>
                <p>
                  Новые сверху · время наблюдения UTC · immutable history
                </p>
              </div>
              {selectedContext && (
                <span
                  className={
                    selectedContext.status === "ARCHIVED"
                      ? "security-status"
                      : "security-status on"
                  }
                >
                  {selectedContext.status === "ARCHIVED"
                    ? "Архивный контекст"
                    : "Активный контекст"}
                </span>
              )}
            </header>

            {historyLoading && items.length === 0 ? (
              <HistoryLoading label="Загружаем историю позиций…" compact />
            ) : historyFailure && items.length === 0 ? (
              <HistoryFailureCard
                failure={historyFailure}
                onRetry={() =>
                  setHistoryRetryVersion((version) => version + 1)
                }
              />
            ) : items.length === 0 ? (
              <div className="rank-history-empty rank-history-empty-inline">
                <span aria-hidden="true" className="rank-history-empty-mark">
                  {filtersApplied ? "⌕" : "○"}
                </span>
                <h2>
                  {filtersApplied
                    ? "По фильтрам ничего не найдено"
                    : "История пока пуста"}
                </h2>
                <p>
                  {filtersApplied
                    ? "Измените период или снимите фильтр по запросу. Пустой ответ не означает ошибку провайдера."
                    : "Для выбранного контекста ещё нет сохранённых нормализованных снимков. Этот экран не запускает внешний сбор."}
                </p>
              </div>
            ) : (
              <>
                {historyFailure && (
                  <HistoryAlert
                    failure={historyFailure}
                    onRetry={() =>
                      setHistoryRetryVersion((version) => version + 1)
                    }
                  />
                )}
                <HistoryRows items={items} keywordLabels={keywordLabels} />
                <footer className="rank-history-footer">
                  <span>
                    Показано: {formatInteger(items.length)}
                    {page.hasNext ? " · есть продолжение" : " · конец выборки"}
                  </span>
                  {page.hasNext && (
                    <button
                      className="secondary-button"
                      disabled={!online || historyLoadingMore}
                      onClick={() => void loadMore()}
                      type="button"
                    >
                      {historyLoadingMore
                        ? "Загружаем…"
                        : "Показать ещё"}
                    </button>
                  )}
                </footer>
              </>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function HistoryRows({
  items,
  keywordLabels
}: Readonly<{
  items: readonly RankHistoryItem[];
  keywordLabels: ReadonlyMap<string, string>;
}>) {
  return (
    <>
      <div
        aria-label="Таблица истории позиций. Доступна горизонтальная прокрутка."
        className="rank-history-table-wrap"
        role="region"
        tabIndex={0}
      >
        <table className="rank-history-table">
          <caption className="visually-hidden">
            Сохранённые снимки позиций по выбранному контексту
          </caption>
          <thead>
            <tr>
              <th scope="col">Наблюдение, UTC</th>
              <th scope="col">Запрос</th>
              <th scope="col">Позиция</th>
              <th scope="col">Страница</th>
              <th scope="col">Источник</th>
              <th scope="col">Качество</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.snapshotId}>
                <td>
                  <strong>{formatUtcDateTime(item.observedAt)}</strong>
                  <small>сохранено {formatUtcDateTime(item.storedAt)}</small>
                </td>
                <td>
                  <strong>
                    {keywordLabels.get(item.keywordId) ??
                      `Запрос ${shortId(item.keywordId)}`}
                  </strong>
                  <small>{shortId(item.keywordId)}</small>
                </td>
                <td>
                  <PositionValue item={item} />
                </td>
                <td>
                  <RankingUrl item={item} />
                </td>
                <td>
                  <strong>Arsenkin</strong>
                  <small>
                    {item.connectorVersion} · cfg v
                    {item.configurationVersion}
                  </small>
                </td>
                <td>
                  <QualityValue item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ol className="rank-history-cards">
        {items.map((item) => (
          <li className="rank-history-card" key={item.snapshotId}>
            <header>
              <div>
                <strong>
                  {keywordLabels.get(item.keywordId) ??
                    `Запрос ${shortId(item.keywordId)}`}
                </strong>
                <small>{formatUtcDateTime(item.observedAt)} UTC</small>
              </div>
              <PositionValue item={item} />
            </header>
            <dl>
              <div>
                <dt>Страница</dt>
                <dd>
                  <RankingUrl item={item} />
                </dd>
              </div>
              <div>
                <dt>Источник</dt>
                <dd>
                  Arsenkin · {item.connectorVersion} · cfg v
                  {item.configurationVersion}
                </dd>
              </div>
              <div>
                <dt>Качество</dt>
                <dd>
                  <QualityValue item={item} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
}

function PositionValue({
  item
}: Readonly<{ item: RankHistoryItem }>) {
  return item.found ? (
    <span className="rank-position found">№ {item.position}</span>
  ) : (
    <span className="rank-position not-found">Не найдено</span>
  );
}

function RankingUrl({
  item
}: Readonly<{ item: RankHistoryItem }>) {
  if (!item.found) return <span className="rank-history-muted">—</span>;
  return (
    <a
      aria-label={`Открыть страницу результата: ${item.rankingUrl}`}
      className="rank-history-url"
      href={item.rankingUrl}
      rel="noreferrer noopener"
      target="_blank"
      title={item.rankingUrl}
    >
      {compactUrl(item.rankingUrl)}
    </a>
  );
}

function QualityValue({
  item
}: Readonly<{ item: RankHistoryItem }>) {
  if (item.dataQualityFlags.length === 0) {
    return <span className="rank-quality-ok">Без предупреждений</span>;
  }
  const label = item.dataQualityFlags.map(qualityFlagLabel).join("; ");
  return (
    <span className="rank-quality-warning" title={label}>
      {item.dataQualityFlags.length}{" "}
      {item.dataQualityFlags.length === 1
        ? "предупреждение"
        : "предупреждения"}
    </span>
  );
}

function HistoryLoading({
  compact = false,
  label
}: Readonly<{ compact?: boolean; label: string }>) {
  return (
    <div
      className={
        compact
          ? "rank-history-loading compact"
          : "security-card panel-card rank-history-loading"
      }
      role="status"
    >
      <span aria-hidden="true" className="spinner" />
      <div>
        <strong>{label}</strong>
        <p>Проверяем доступ и читаем нормализованные снимки.</p>
      </div>
    </div>
  );
}

function HistoryFailureCard({
  failure,
  onRetry
}: Readonly<{
  failure: HistoryFailure;
  onRetry: () => void;
}>) {
  return (
    <div className="rank-history-failure" role="alert">
      <span aria-hidden="true" className="rank-history-empty-mark">
        !
      </span>
      <h2>{failureTitle(failure.kind)}</h2>
      <p>{failure.message}</p>
      {failure.requestId && <small>Request ID: {failure.requestId}</small>}
      {failure.kind !== "forbidden" &&
        failure.kind !== "not-found" &&
        failure.kind !== "validation" && (
          <button
            className="secondary-button"
            disabled={failure.kind === "offline"}
            onClick={onRetry}
            type="button"
          >
            Повторить
          </button>
        )}
    </div>
  );
}

function HistoryAlert({
  failure,
  onRetry
}: Readonly<{
  failure: HistoryFailure;
  onRetry: () => void;
}>) {
  return (
    <div
      className={
        failure.kind === "offline"
          ? "inline-alert warning rank-history-alert"
          : "inline-alert danger rank-history-alert"
      }
      role="alert"
    >
      <span>
        {failure.message}
        {failure.requestId && (
          <small>Request ID: {failure.requestId}</small>
        )}
      </span>
      {failure.kind !== "forbidden" &&
        failure.kind !== "not-found" &&
        failure.kind !== "validation" && (
          <button
            className="inline-alert-action"
            disabled={failure.kind === "offline"}
            onClick={onRetry}
            type="button"
          >
            Повторить
          </button>
        )}
    </div>
  );
}

async function loadHistoryPage(
  projectId: string,
  request: RankHistoryRequest,
  signal?: AbortSignal
) {
  const collection = await browserApiCollectionRequest<unknown>(
    rankHistoryApiPath(projectId, request),
    signal ? { signal } : {}
  );
  return parseRankHistoryCollection(collection);
}

function parseKeywordOptions(
  values: readonly unknown[],
  contextId: string
): readonly KeywordOption[] {
  if (values.length > rankHistoryKeywordPageSize) {
    throw invalidKeywordResponse();
  }
  const options = values.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw invalidKeywordResponse();
    }
    const item = value as Readonly<Record<string, unknown>>;
    if (
      item.contextId !== contextId ||
      typeof item.keywordId !== "string" ||
      item.keywordId.length < 1 ||
      item.keywordId.length > 128 ||
      typeof item.textOriginal !== "string" ||
      item.textOriginal.length < 1 ||
      item.textOriginal.length > 4_096
    ) {
      throw invalidKeywordResponse();
    }
    return {
      keywordId: item.keywordId,
      textOriginal: item.textOriginal
    };
  });
  if (
    new Set(options.map(({ keywordId }) => keywordId)).size !==
    options.length
  ) {
    throw invalidKeywordResponse();
  }
  return options;
}

function invalidKeywordResponse(): BrowserApiError {
  return new BrowserApiError(
    502,
    "INVALID_RESPONSE",
    "Сервис вернул некорректный список назначенных запросов"
  );
}

function historyFailureFrom(
  error: unknown,
  online: boolean
): HistoryFailure {
  if (!online || error instanceof TypeError) return offlineFailure();
  if (!(error instanceof BrowserApiError)) {
    return {
      kind: "recoverable",
      message:
        "Не удалось загрузить историю. Сохранённые данные не изменены."
    };
  }
  const requestId = error.requestId ? { requestId: error.requestId } : {};
  if (error.code === "INVALID_RESPONSE") {
    return {
      kind: "invalid-response",
      message:
        "Ответ не прошёл проверку публичного контракта и не был показан.",
      ...requestId
    };
  }
  if (error.status === 403) {
    return {
      kind: "forbidden",
      message:
        "Недостаточно права ranking.view для просмотра истории этого проекта.",
      ...requestId
    };
  }
  if (error.status === 404) {
    return {
      kind: "not-found",
      message:
        "Проект, контекст или история больше недоступны в текущей рабочей области.",
      ...requestId
    };
  }
  if (error.status === 429) {
    return {
      kind: "rate-limited",
      message:
        "Сервис временно ограничил частоту чтения. Повторите запрос позже.",
      ...requestId
    };
  }
  return {
    kind: "recoverable",
    message: error.retryable
      ? "Сервис истории временно недоступен. Уже загруженные строки сохранены на экране."
      : error.message,
    ...requestId
  };
}

function keywordFailureMessage(error: unknown, online: boolean): string {
  if (!online || error instanceof TypeError) {
    return "Нет соединения: фильтр по запросу временно недоступен.";
  }
  if (error instanceof BrowserApiError) {
    if (error.status === 403) {
      return "Недостаточно прав для просмотра назначенных запросов.";
    }
    if (error.status === 404) {
      return "Выбранный контекст больше недоступен.";
    }
    if (error.code === "INVALID_RESPONSE") {
      return "Список запросов не прошёл проверку ответа.";
    }
  }
  return "Не удалось загрузить фильтр запросов. История доступна без него.";
}

function offlineFailure(): HistoryFailure {
  return {
    kind: "offline",
    message:
      "Нет соединения. Повтор станет доступен после восстановления сети."
  };
}

function invalidRangeFailure(): HistoryFailure {
  return {
    kind: "validation",
    message:
      "Укажите корректный диапазон: начальная дата не должна быть позже конечной."
  };
}

function historyRestrictionMessage(
  projectStatus: "DRAFT" | "ACTIVE" | "ARCHIVED",
  workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED",
  context: TrackingContextSummary | undefined
): string | undefined {
  if (projectStatus === "ARCHIVED") {
    return "Проект архивирован. История сохранена и доступна только для чтения; новый сбор здесь не запускается.";
  }
  if (workspaceStatus !== "ACTIVE") {
    return workspaceStatus === "SUSPENDED"
      ? "Рабочая область приостановлена. Доступная история открыта только для чтения."
      : "Рабочая область работает в режиме read-only. Просмотр истории не изменяет данные.";
  }
  if (context?.status === "ARCHIVED") {
    return "Выбран архивный контекст. Его immutable-снимки доступны для чтения, настройки и назначения не меняются.";
  }
  return undefined;
}

function failureTitle(kind: HistoryFailure["kind"]): string {
  const titles: Readonly<Record<HistoryFailure["kind"], string>> = {
    forbidden: "Недостаточно прав",
    "invalid-response": "Ответ отклонён",
    "not-found": "Данные недоступны",
    offline: "Нет соединения",
    "rate-limited": "Слишком много запросов",
    recoverable: "Не удалось загрузить историю",
    validation: "Проверьте даты"
  };
  return titles[kind];
}

function qualityFlagLabel(
  flag: RankHistoryItem["dataQualityFlags"][number]
): string {
  const labels: Readonly<
    Record<RankHistoryItem["dataQualityFlags"][number], string>
  > = {
    PROVIDER_OBSERVED_AT_UNAVAILABLE:
      "провайдер не передал время наблюдения",
    ABSOLUTE_POSITION_UNAVAILABLE: "нет абсолютной позиции",
    PIXEL_POSITION_UNAVAILABLE: "нет пиксельной позиции",
    TITLE_UNAVAILABLE: "нет заголовка",
    SNIPPET_UNAVAILABLE: "нет сниппета"
  };
  return labels[flag];
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

function formatUtcDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function redirectForExpiredSession(
  error: unknown,
  returnTo: string
): boolean {
  if (!(error instanceof BrowserApiError) || error.status !== 401) {
    return false;
  }
  window.location.assign(
    `/app/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`
  );
  return true;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
