"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import type {
  SemanticKeywordListItem,
  TrackingContextKeywordAssignmentItem,
  TrackingContextKeywordAssignmentState,
  TrackingContextMutationRestriction,
  TrackingContextSummary
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiCollectionRequest,
  browserApiRequest,
  type BrowserCursorPage
} from "../lib/browser-api";
import { trackingContextApiPath } from "../lib/tracking-contexts";

interface KeywordFeedback {
  readonly tone: "danger" | "success" | "warning";
  readonly message: string;
  readonly requestId?: string;
}

export function TrackingContextKeywords({
  canMutate,
  context,
  onAccessRevalidate,
  onBusyChange,
  onContextChange,
  onRestriction,
  online,
  projectId,
  returnTo
}: Readonly<{
  canMutate: boolean;
  context: TrackingContextSummary;
  onAccessRevalidate: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onContextChange: (context: TrackingContextSummary) => void;
  onRestriction: (
    restriction: TrackingContextMutationRestriction
  ) => void;
  online: boolean;
  projectId: string;
  returnTo: string;
}>) {
  const [assigned, setAssigned] =
    useState<readonly TrackingContextKeywordAssignmentItem[]>([]);
  const [assignedPage, setAssignedPage] =
    useState<BrowserCursorPage>({ hasNext: false });
  const [assignedLoading, setAssignedLoading] = useState(true);
  const [assignedLoadingMore, setAssignedLoadingMore] =
    useState(false);
  const [assignedError, setAssignedError] = useState<string>();
  const [assignedRetryVersion, setAssignedRetryVersion] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] =
    useState<readonly SemanticKeywordListItem[]>([]);
  const [candidatePage, setCandidatePage] =
    useState<BrowserCursorPage>({ hasNext: false });
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateLoadingMore, setCandidateLoadingMore] =
    useState(false);
  const [candidateError, setCandidateError] = useState<string>();
  const [busyKeywordId, setBusyKeywordId] = useState<string>();
  const [feedback, setFeedback] = useState<KeywordFeedback>();
  const mutationLock = useRef(false);
  const candidateRequestLock = useRef(false);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setAssignedLoading(true);
    setAssignedError(undefined);
    void loadAssignedKeywords(
      projectId,
      context.id,
      undefined,
      controller.signal
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setAssigned(result.data);
        setAssignedPage(result.page);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (redirectForExpiredSession(error, returnTo)) return;
        setAssigned([]);
        setAssignedPage({ hasNext: false });
        setAssignedError(
          keywordLoadError(error, navigator.onLine)
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setAssignedLoading(false);
      });
    return () => controller.abort();
  }, [
    assignedRetryVersion,
    context.id,
    projectId,
    returnTo
  ]);

  useEffect(() => {
    setSearchDraft("");
    setSearch("");
    setCandidates([]);
    setCandidatePage({ hasNext: false });
    setCandidateError(undefined);
    setFeedback(undefined);
  }, [context.id]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  const assignedIds = useMemo(
    () => new Set(assigned.map(({ keywordId }) => keywordId)),
    [assigned]
  );

  async function loadMoreAssigned(): Promise<void> {
    if (
      !online ||
      assignedLoading ||
      !assignedPage.hasNext ||
      !assignedPage.nextCursor ||
      assignedLoadingMore
    ) {
      return;
    }
    setAssignedLoadingMore(true);
    setAssignedError(undefined);
    try {
      const result = await loadAssignedKeywords(
        projectId,
        context.id,
        assignedPage.nextCursor
      );
      setAssigned((current) =>
        mergeById(current, result.data, ({ assignmentId }) => assignmentId)
      );
      setAssignedPage(result.page);
    } catch (error) {
      if (redirectForExpiredSession(error, returnTo)) return;
      setAssignedError(keywordLoadError(error, online));
    } finally {
      setAssignedLoadingMore(false);
    }
  }

  async function submitSearch(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (candidateRequestLock.current) return;
    const query = searchDraft.trim();
    setSearch(query);
    setCandidates([]);
    setCandidatePage({ hasNext: false });
    setCandidateError(undefined);
    setFeedback(undefined);
    if (!query) {
      setCandidateError(
        "Введите часть запроса, чтобы найти его в семантическом ядре."
      );
      return;
    }
    if (!online) {
      setCandidateError(
        "Поиск требует соединения и не выполняется из локального кэша."
      );
      return;
    }
    candidateRequestLock.current = true;
    setCandidateLoading(true);
    try {
      const result = await loadKeywordCandidates(
        projectId,
        query
      );
      setCandidates(result.data);
      setCandidatePage(result.page);
    } catch (error) {
      if (redirectForExpiredSession(error, returnTo)) return;
      setCandidateError(keywordLoadError(error, online));
    } finally {
      setCandidateLoading(false);
      candidateRequestLock.current = false;
    }
  }

  async function loadMoreCandidates(): Promise<void> {
    if (
      !online ||
      !search ||
      !candidatePage.hasNext ||
      !candidatePage.nextCursor ||
      candidateLoadingMore ||
      candidateRequestLock.current
    ) {
      return;
    }
    candidateRequestLock.current = true;
    setCandidateLoadingMore(true);
    setCandidateError(undefined);
    try {
      const result = await loadKeywordCandidates(
        projectId,
        search,
        candidatePage.nextCursor
      );
      setCandidates((current) =>
        mergeById(current, result.data, ({ id }) => id)
      );
      setCandidatePage(result.page);
    } catch (error) {
      if (redirectForExpiredSession(error, returnTo)) return;
      setCandidateError(keywordLoadError(error, online));
    } finally {
      setCandidateLoadingMore(false);
      candidateRequestLock.current = false;
    }
  }

  async function changeAssignment(
    keywordId: string,
    assign: boolean
  ): Promise<void> {
    if (
      !canMutate ||
      !online ||
      mutationLock.current ||
      assignedLoading ||
      assignedLoadingMore ||
      busyKeywordId
    ) {
      return;
    }
    mutationLock.current = true;
    setBusyKeywordId(keywordId);
    onBusyChange(true);
    setFeedback(undefined);
    try {
      await browserApiRequest<TrackingContextKeywordAssignmentState>(
        `${trackingContextApiPath(projectId, context.id)}/keywords/${encodeURIComponent(keywordId)}`,
        {
          method: assign ? "PUT" : "DELETE"
        }
      );
      setFeedback({
        tone: "success",
        message: assignmentSuccessMessage(assign)
      });
      try {
        const [currentContext, assignedResult] = await Promise.all([
          browserApiRequest<TrackingContextSummary>(
            trackingContextApiPath(projectId, context.id)
          ),
          loadAssignedKeywords(projectId, context.id)
        ]);
        onContextChange(currentContext);
        setAssigned(assignedResult.data);
        setAssignedPage(assignedResult.page);
        setAssignedError(undefined);
      } catch (error) {
        if (redirectForExpiredSession(error, returnTo)) return;
        if (error instanceof BrowserApiError) {
          if (error.status === 402) {
            onRestriction("WORKSPACE_READ_ONLY");
          }
          if (error.status === 403) {
            onRestriction("MISSING_PERMISSION");
            await onAccessRevalidate();
          }
        }
        setFeedback({
          tone: "warning",
          message:
            "Изменение принято сервером, но перечитать счётчик и список пока не удалось. Обновите назначения.",
          ...(error instanceof BrowserApiError && error.requestId
            ? { requestId: error.requestId }
            : {})
        });
      }
    } catch (error) {
      if (redirectForExpiredSession(error, returnTo)) return;
      await handleAssignmentError(error);
    } finally {
      mutationLock.current = false;
      setBusyKeywordId(undefined);
      onBusyChange(false);
    }
  }

  async function handleAssignmentError(error: unknown): Promise<void> {
    if (error instanceof BrowserApiError) {
      if (error.status === 402 || error.code === "PAYMENT_REQUIRED") {
        onRestriction("WORKSPACE_READ_ONLY");
      }
      if (error.status === 403) {
        onRestriction("MISSING_PERMISSION");
        await onAccessRevalidate();
      }
      if (error.status === 409) {
        try {
          const current = await browserApiRequest<TrackingContextSummary>(
            trackingContextApiPath(projectId, context.id)
          );
          onContextChange(current);
        } catch {
          // Preserve the original mutation error below.
        }
      }
    }
    setFeedback(keywordMutationError(error, online));
  }

  return (
    <section
      aria-label={`Запросы контекста ${context.name}`}
      className="tracking-context-keywords"
    >
      <header>
        <div>
          <h3>Запросы контекста</h3>
          <p>
            Точечные назначения являются отдельным temporal-ресурсом.
            Повторное добавление безопасно и не создаёт дубликат.
          </p>
        </div>
        <span>
          {formatInteger(context.assignedKeywordCount)} назначено
        </span>
      </header>

      {!canMutate && (
        <div className="inline-alert warning compact" role="note">
          {context.status === "ARCHIVED"
            ? "Архивный контекст доступен только для просмотра. Восстановите его перед изменением назначений."
            : online
              ? "Назначения доступны только для просмотра из-за текущих прав или статуса workspace."
              : "Офлайн: назначения не добавляются в локальную очередь."}
        </div>
      )}

      {feedback && (
        <div
          className={`inline-alert ${feedback.tone}`}
          ref={feedbackRef}
          role={feedback.tone === "success" ? "status" : "alert"}
          tabIndex={-1}
        >
          <span>{feedback.message}</span>
          {feedback.requestId && (
            <small>Код запроса: {feedback.requestId}</small>
          )}
        </div>
      )}

      <div className="tracking-keyword-grid">
        <section className="tracking-keyword-column">
          <div className="tracking-keyword-column-heading">
            <div>
              <h4>Назначенные запросы</h4>
              <p>Authoritative список именно этого контекста.</p>
            </div>
            <button
              className="text-button"
              disabled={
                !online ||
                assignedLoading ||
                assignedLoadingMore ||
                Boolean(busyKeywordId)
              }
              onClick={() =>
                setAssignedRetryVersion((value) => value + 1)
              }
              type="button"
            >
              Обновить
            </button>
          </div>

          {assignedError && (
            <div className="inline-alert danger compact" role="alert">
              {assignedError}
            </div>
          )}

          {assignedLoading ? (
            <div
              aria-label="Загружаем назначения"
              className="tracking-keyword-skeleton"
              role="status"
            >
              <i />
              <i />
              <i />
            </div>
          ) : assigned.length === 0 ? (
            <div className="tracking-keyword-empty">
              <strong>Запросов пока нет</strong>
              <p>
                Найдите запрос в семантическом ядре и назначьте его этому
                контексту.
              </p>
            </div>
          ) : (
            <ul className="tracking-keyword-list">
              {assigned.map((item) => (
                <li key={item.assignmentId}>
                  <span>
                    <strong>{item.textOriginal}</strong>
                    <small>
                      {item.language.toUpperCase()} · назначен{" "}
                      {formatShortDate(item.assignedAt)}
                    </small>
                  </span>
                  <button
                    className="text-button danger-text"
                    disabled={
                      !canMutate ||
                      assignedLoadingMore ||
                      Boolean(busyKeywordId)
                    }
                    onClick={() =>
                      void changeAssignment(item.keywordId, false)
                    }
                    type="button"
                  >
                    {busyKeywordId === item.keywordId
                      ? "Удаляем…"
                      : "Убрать"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {assignedPage.hasNext && (
            <div className="tracking-keyword-truncated">
              <p>
                Назначения показаны частично. Продолжение загружается по
                cursor, без offset.
              </p>
              <button
                className="secondary-button"
                disabled={
                  !online ||
                  assignedLoading ||
                  assignedLoadingMore ||
                  Boolean(busyKeywordId)
                }
                onClick={() => void loadMoreAssigned()}
                type="button"
              >
                {assignedLoadingMore ? "Загружаем…" : "Показать ещё"}
              </button>
            </div>
          )}
        </section>

        <section className="tracking-keyword-column">
          <div className="tracking-keyword-column-heading">
            <div>
              <h4>Найти и добавить</h4>
              <p>Поиск выполняется по семантическому ядру проекта.</p>
            </div>
          </div>
          <form
            className="tracking-keyword-search"
            onSubmit={(event) => void submitSearch(event)}
          >
            <label>
              <span className="visually-hidden">
                Поиск запроса для назначения
              </span>
              <input
                disabled={
                  !online ||
                  candidateLoading ||
                  candidateLoadingMore
                }
                maxLength={200}
                onChange={(event) =>
                  setSearchDraft(event.target.value)
                }
                placeholder="Например, seo audit"
                type="search"
                value={searchDraft}
              />
            </label>
            <button
              className="primary-button"
              disabled={
                !online ||
                candidateLoading ||
                candidateLoadingMore
              }
              type="submit"
            >
              {candidateLoading ? "Ищем…" : "Найти"}
            </button>
          </form>

          {candidateError && (
            <div className="inline-alert danger compact" role="alert">
              {candidateError}
            </div>
          )}

          {candidateLoading ? (
            <div
              aria-label="Ищем запросы"
              className="tracking-keyword-skeleton"
              role="status"
            >
              <i />
              <i />
              <i />
            </div>
          ) : search && candidates.length === 0 && !candidateError ? (
            <div className="tracking-keyword-empty">
              <strong>Ничего не найдено</strong>
              <p>
                Измените формулировку или сначала импортируйте запрос в
                семантическое ядро.
              </p>
            </div>
          ) : candidates.length > 0 ? (
            <ul className="tracking-keyword-list candidate">
              {candidates.map((item) => {
                const knownAssigned = assignedIds.has(item.id);
                return (
                  <li key={item.id}>
                    <span>
                      <strong>{item.textOriginal}</strong>
                      <small>
                        {item.language.toUpperCase()}
                        {item.groupPath ? ` · ${item.groupPath}` : ""}
                      </small>
                    </span>
                    <button
                      className={
                        knownAssigned
                          ? "text-button"
                          : "secondary-button"
                      }
                      disabled={
                        !canMutate ||
                        assignedLoading ||
                        assignedLoadingMore ||
                        Boolean(busyKeywordId) ||
                        knownAssigned
                      }
                      onClick={() =>
                        void changeAssignment(item.id, true)
                      }
                      type="button"
                    >
                      {busyKeywordId === item.id
                        ? "Добавляем…"
                        : knownAssigned
                          ? "Назначен"
                          : "Добавить"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="tracking-keyword-empty quiet">
              <p>
                Введите часть запроса. Глобальный флаг{" "}
                <code>isTracked</code> не используется как источник истины для
                этого контекста.
              </p>
            </div>
          )}

          {candidatePage.hasNext && (
            <div className="tracking-keyword-truncated">
              <p>
                Результаты поиска усечены. Уточните запрос или загрузите
                следующую cursor-страницу.
              </p>
              <button
                className="secondary-button"
                disabled={!online || candidateLoadingMore}
                onClick={() => void loadMoreCandidates()}
                type="button"
              >
                {candidateLoadingMore
                  ? "Загружаем…"
                  : "Показать ещё"}
              </button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

async function loadAssignedKeywords(
  projectId: string,
  contextId: string,
  cursor?: string,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({ limit: "100" });
  if (cursor) query.set("cursor", cursor);
  return browserApiCollectionRequest<TrackingContextKeywordAssignmentItem>(
    `${trackingContextApiPath(projectId, contextId)}/keywords?${query.toString()}`,
    signal ? { signal } : {}
  );
}

async function loadKeywordCandidates(
  projectId: string,
  search: string,
  cursor?: string
) {
  const query = new URLSearchParams({
    limit: "50",
    search
  });
  if (cursor) query.set("cursor", cursor);
  return browserApiCollectionRequest<SemanticKeywordListItem>(
    `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`
  );
}

function assignmentSuccessMessage(
  requestedAssignment: boolean
): string {
  return requestedAssignment
    ? "Запрос назначен контексту."
    : "Назначение запроса снято.";
}

function keywordLoadError(error: unknown, online: boolean): string {
  if (!online || error instanceof TypeError) {
    return "Нет соединения. Загруженные ранее строки остаются видимыми.";
  }
  if (error instanceof BrowserApiError) {
    if (error.status === 403) {
      return "Недостаточно прав для просмотра запросов этого проекта.";
    }
    if (error.status === 404) {
      return "Контекст или проект больше недоступен.";
    }
    if (error.status === 429) {
      return "Слишком много запросов. Повторите поиск позже.";
    }
    return error.message;
  }
  return "Не удалось загрузить запросы.";
}

function keywordMutationError(
  error: unknown,
  online: boolean
): KeywordFeedback {
  if (!online || error instanceof TypeError) {
    return {
      tone: "danger",
      message:
        "Соединение потеряно. Изменение не добавлено в локальную очередь."
    };
  }
  if (error instanceof BrowserApiError) {
    const requestId = error.requestId
      ? { requestId: error.requestId }
      : {};
    if (error.status === 402 || error.code === "PAYMENT_REQUIRED") {
      return {
        tone: "warning",
        message:
          "Workspace доступен только для чтения. Просмотр назначений сохранён.",
        ...requestId
      };
    }
    if (error.status === 403) {
      return {
        tone: "warning",
        message: "Право изменения назначений отозвано.",
        ...requestId
      };
    }
    if (error.status === 409) {
      return {
        tone: "warning",
        message:
          "Контекст или проект архивирован. Список перечитан без локального изменения.",
        ...requestId
      };
    }
    return {
      tone: "danger",
      message: error.retryable
        ? "Сервис временно недоступен. Состояние назначения следует перечитать перед повтором."
        : error.message,
      ...requestId
    };
  }
  return {
    tone: "danger",
    message: "Не удалось изменить назначение запроса."
  };
}

function mergeById<Item>(
  current: readonly Item[],
  next: readonly Item[],
  id: (item: Item) => string
): readonly Item[] {
  const byId = new Map(current.map((item) => [id(item), item]));
  for (const item of next) byId.set(id(item), item);
  return [...byId.values()];
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
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
