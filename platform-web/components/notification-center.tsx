"use client";

import { useEffect, useState } from "react";
import {
  browserApiCollectionRequest,
  browserApiRequest,
  BrowserApiError,
  type BrowserCursorPage
} from "../lib/browser-api";
import { publishUnreadCount } from "./notification-bell";
import {
  eventLabel,
  type NotificationEventType
} from "./notification-settings";

type NotificationSeverity = "INFO" | "WARNING" | "CRITICAL";

interface NotificationItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly eventType: NotificationEventType;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body?: string;
  readonly deepLink?: string;
  readonly readAt?: string;
  readonly createdAt: string;
}

interface ReadAllResult {
  readonly updated: number;
  readonly readAt: string;
}

export function NotificationCenter() {
  const [items, setItems] = useState<readonly NotificationItem[]>([]);
  const [page, setPage] = useState<BrowserCursorPage>({
    hasNext: false,
    unreadCount: 0
  });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingId, setMarkingId] = useState<string>();
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void loadPage(unreadOnly, undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.data);
        setPage(result.page);
        publishUnreadCount(result.page.unreadCount ?? 0);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(notificationCenterError(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retryVersion, unreadOnly]);

  async function loadMore(): Promise<void> {
    if (!page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(undefined);
    try {
      const result = await loadPage(unreadOnly, page.nextCursor);
      setItems((current) => mergeNotifications(current, result.data));
      setPage(result.page);
      publishUnreadCount(result.page.unreadCount ?? 0);
    } catch (requestError) {
      setError(notificationCenterError(requestError));
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(id: string): Promise<void> {
    if (markingId) return;
    const current = items.find((item) => item.id === id);
    if (!current || current.readAt) return;
    setMarkingId(id);
    setError(undefined);
    try {
      const updated = await browserApiRequest<NotificationItem>(
        `/app/api/notifications/${encodeURIComponent(id)}/read`,
        { method: "PATCH" }
      );
      const nextItems = unreadOnly
        ? items.filter((item) => item.id !== id)
        : items.map((item) => (item.id === id ? updated : item));
      const unreadCount = Math.max(0, (page.unreadCount ?? 0) - 1);
      setItems(nextItems);
      setPage((currentPage) => ({ ...currentPage, unreadCount }));
      publishUnreadCount(unreadCount);
    } catch (requestError) {
      setError(notificationCenterError(requestError));
    } finally {
      setMarkingId(undefined);
    }
  }

  async function markAllRead(): Promise<void> {
    if (markingAll || (page.unreadCount ?? 0) === 0) return;
    setMarkingAll(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<ReadAllResult>(
        "/app/api/notifications/read-all",
        { method: "POST" }
      );
      setItems((current) =>
        unreadOnly
          ? []
          : current.map((item) =>
              item.readAt ? item : { ...item, readAt: result.readAt }
            )
      );
      setPage((current) => {
        if (!unreadOnly) return { ...current, unreadCount: 0 };
        const {
          nextCursor: _nextCursor,
          ...withoutCursor
        } = current;
        return {
          ...withoutCursor,
          hasNext: false,
          unreadCount: 0
        };
      });
      publishUnreadCount(0);
    } catch (requestError) {
      setError(notificationCenterError(requestError));
    } finally {
      setMarkingAll(false);
    }
  }

  async function openItem(item: NotificationItem): Promise<void> {
    if (!item.deepLink) return;
    if (!item.readAt) await markRead(item.id);
    window.location.assign(item.deepLink);
  }

  return (
    <div className="notification-center-stack">
      <section className="panel notification-center-toolbar">
        <div className="notification-filter" role="group" aria-label="Фильтр">
          <button
            aria-pressed={!unreadOnly}
            className={!unreadOnly ? "active" : undefined}
            onClick={() => setUnreadOnly(false)}
            type="button"
          >
            Все
          </button>
          <button
            aria-pressed={unreadOnly}
            className={unreadOnly ? "active" : undefined}
            onClick={() => setUnreadOnly(true)}
            type="button"
          >
            Непрочитанные
            {(page.unreadCount ?? 0) > 0 && (
              <span>{page.unreadCount}</span>
            )}
          </button>
        </div>
        <div className="notification-center-actions">
          <a className="text-button" href="/app/settings/notifications">
            Настроить доставку
          </a>
          <button
            className="secondary-button"
            disabled={markingAll || (page.unreadCount ?? 0) === 0}
            onClick={() => void markAllRead()}
            type="button"
          >
            {markingAll ? "Отмечаем…" : "Прочитать всё"}
          </button>
        </div>
      </section>

      {error && (
        <div className="inline-alert danger notification-center-error" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            onClick={() => setRetryVersion((value) => value + 1)}
            type="button"
          >
            Повторить
          </button>
        </div>
      )}

      {loading ? (
        <section
          className="panel notification-center-loading"
          aria-busy="true"
          aria-label="Загружаем уведомления"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} />
          ))}
        </section>
      ) : items.length === 0 ? (
        <section className="panel panel-empty notification-center-empty">
          <span className="state-icon">✓</span>
          <strong>
            {unreadOnly
              ? "Все уведомления прочитаны"
              : "Уведомлений пока нет"}
          </strong>
          <p>
            {unreadOnly
              ? "Новые события появятся здесь после выполнения работ."
              : "Здесь будут результаты заданий, упоминания, предупреждения и отчёты."}
          </p>
        </section>
      ) : (
        <section className="panel notification-list" aria-live="polite">
          {items.map((item) => (
            <article
              className={`notification-item ${item.readAt ? "read" : "unread"}`}
              key={item.id}
            >
              <span
                aria-label={severityLabel(item.severity)}
                className={`notification-severity severity-${item.severity.toLowerCase()}`}
                title={severityLabel(item.severity)}
              />
              <div className="notification-item-copy">
                <div>
                  <span>{eventLabel(item.eventType)}</span>
                  <time dateTime={item.createdAt}>
                    {formatNotificationTime(item.createdAt)}
                  </time>
                </div>
                <h2>{item.title}</h2>
                {item.body && <p>{item.body}</p>}
                <div className="notification-item-actions">
                  {!item.readAt && (
                    <button
                      className="text-button"
                      disabled={markingId === item.id}
                      onClick={() => void markRead(item.id)}
                      type="button"
                    >
                      {markingId === item.id
                        ? "Отмечаем…"
                        : "Отметить прочитанным"}
                    </button>
                  )}
                  {item.deepLink && (
                    <button
                      className="text-button"
                      onClick={() => void openItem(item)}
                      type="button"
                    >
                      Открыть
                    </button>
                  )}
                </div>
              </div>
              {!item.readAt && (
                <span className="notification-unread-dot" aria-label="Не прочитано" />
              )}
            </article>
          ))}
        </section>
      )}

      {!loading && page.hasNext && (
        <button
          className="secondary-button notification-load-more"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          type="button"
        >
          {loadingMore ? "Загружаем…" : "Показать ещё"}
        </button>
      )}
    </div>
  );
}

function loadPage(
  unreadOnly: boolean,
  cursor?: string,
  signal?: AbortSignal
) {
  const parameters = new URLSearchParams({
    limit: "30",
    unreadOnly: String(unreadOnly)
  });
  if (cursor) parameters.set("cursor", cursor);
  return browserApiCollectionRequest<NotificationItem>(
    `/app/api/notifications?${parameters.toString()}`,
    { ...(signal ? { signal } : {}) }
  );
}

function mergeNotifications(
  current: readonly NotificationItem[],
  incoming: readonly NotificationItem[]
): readonly NotificationItem[] {
  const seen = new Set(current.map(({ id }) => id));
  return [...current, ...incoming.filter(({ id }) => !seen.has(id))];
}

function formatNotificationTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function severityLabel(severity: NotificationSeverity): string {
  if (severity === "CRITICAL") return "Критическое событие";
  if (severity === "WARNING") return "Предупреждение";
  return "Информация";
}

function notificationCenterError(error: unknown): string {
  if (error instanceof BrowserApiError) return error.message;
  return "Не удалось загрузить центр уведомлений.";
}
