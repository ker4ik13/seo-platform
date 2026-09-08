"use client";

import type {
  PendingWorkspaceInviteSummary,
  ProjectTransferRequestSummary
} from "@seo-platform/contracts";
import { useEffect, useState } from "react";
import {
  browserApiCollectionRequest,
  browserApiRequest,
  BrowserApiError,
  type BrowserCursorPage
} from "../lib/browser-api";
import { publishUnreadCount } from "./notification-bell";
import { WorkspaceInviteNotificationList } from "./workspace-invite-notification-list";
import { ProjectTransferNotificationList } from "./project-transfer-notification-list";
import {
  activateTransferredProject,
  decideProjectTransfer,
  loadPendingProjectTransfers
} from "../lib/project-transfers";
import {
  activateAcceptedWorkspace,
  decideWorkspaceInvite,
  loadPendingWorkspaceInvites
} from "../lib/workspace-invitations";
import {
  eventLabel,
  type NotificationEventType
} from "./notification-settings";
import {
  parseOperationResultHref,
  type OperationResultKind
} from "../lib/operation-result-routes";
import { OperationResultModal } from "./operation-result-modal";
import { useUiLocale, UiText } from "./ui-locale";


type NotificationSeverity = "INFO" | "WARNING" | "CRITICAL";
const NOTIFICATION_REFRESH_INTERVAL_MS = 20_000;

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

interface NotificationOperation {
  readonly kind: OperationResultKind;
  readonly operationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
}

export function NotificationCenter({ projectId }: Readonly<{ projectId?: string }>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [items, setItems] = useState<readonly NotificationItem[]>([]);
  const [invites, setInvites] = useState<readonly PendingWorkspaceInviteSummary[]>([]);
  const [transfers, setTransfers] = useState<readonly ProjectTransferRequestSummary[]>([]);
  const [page, setPage] = useState<BrowserCursorPage>({
    hasNext: false,
    unreadCount: 0
  });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingId, setMarkingId] = useState<string>();
  const [markingAll, setMarkingAll] = useState(false);
  const [busyInviteId, setBusyInviteId] = useState<string>();
  const [busyTransferId, setBusyTransferId] = useState<string>();
  const [error, setError] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);
  const [selectedOperation, setSelectedOperation] = useState<NotificationOperation>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void Promise.allSettled([
      loadPage(unreadOnly, undefined, controller.signal),
      loadPendingWorkspaceInvites(controller.signal),
      loadPendingProjectTransfers(controller.signal)
    ])
      .then(([notificationResult, inviteResult, transferResult]) => {
        if (controller.signal.aborted) return;
        if (notificationResult.status === "fulfilled") {
          setItems(notificationResult.value.data);
          setPage(notificationResult.value.page);
          publishUnreadCount(
            notificationResult.value.page.unreadCount ?? 0
          );
        }
        if (inviteResult.status === "fulfilled") {
          setInvites(inviteResult.value.data);
        }
        if (transferResult.status === "fulfilled") {
          setTransfers(transferResult.value.data);
        }
        const failed = [
          notificationResult,
          inviteResult,
          transferResult
        ].find((result) => result.status === "rejected");
        if (failed?.status === "rejected") {
          setError(notificationCenterError(failed.reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retryVersion, unreadOnly]);

  useEffect(() => {
    let active = true;
    const refreshLatest = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      try {
        const [result, pendingInvites, pendingTransfers] = await Promise.all([
          loadPage(unreadOnly),
          loadPendingWorkspaceInvites(),
          loadPendingProjectTransfers()
        ]);
        if (!active) return;
        setItems((current) => mergeLatestNotifications(result.data, current));
        setInvites(pendingInvites.data);
        setTransfers(pendingTransfers.data);
        setPage((current) => ({
          ...current,
          unreadCount: result.page.unreadCount ?? 0
        }));
        publishUnreadCount(result.page.unreadCount ?? 0);
      } catch {
        // The primary loading/error state remains authoritative; polling is best-effort.
      }
    };
    const timer = window.setInterval(
      () => void refreshLatest(),
      NOTIFICATION_REFRESH_INTERVAL_MS
    );
    const refreshAfterVisibility = () => void refreshLatest();
    document.addEventListener("visibilitychange", refreshAfterVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshAfterVisibility);
    };
  }, [unreadOnly]);

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

  async function openItem(item: NotificationItem, uiLocale: string = "ru-RU"): Promise<void> {
    if (!item.deepLink) return;
    if (!item.readAt) await markRead(item.id);
    const operation = parseOperationResultHref(item.deepLink);
    const operationProjectId = item.projectId ?? projectId;
    if (operation && operationProjectId) {
      setSelectedOperation({
        ...operation,
        projectId: operationProjectId,
        title: notificationOperationTitle(operation.kind, item.title),
        description: `${item.title} · ${formatNotificationTime(item.createdAt, uiLocale)}`
      });
      return;
    }
    window.location.assign(item.deepLink);
  }

  async function decideInvite(
    invite: PendingWorkspaceInviteSummary,
    decision: "accept" | "decline"
  ): Promise<void> {
    if (busyInviteId) return;
    setBusyInviteId(invite.id);
    setError(undefined);
    try {
      if (decision === "accept") {
        const member = await decideWorkspaceInvite(invite.id, "accept");
        activateAcceptedWorkspace(member.workspaceId);
        return;
      }
      await decideWorkspaceInvite(invite.id, "decline");
      setInvites((current) => current.filter(({ id }) => id !== invite.id));
    } catch (requestError) {
      setError(notificationCenterError(requestError));
    } finally {
      setBusyInviteId(undefined);
    }
  }

  async function decideTransfer(
    transfer: ProjectTransferRequestSummary,
    decision: "accept" | "decline",
    destinationWorkspaceId?: string
  ): Promise<void> {
    if (busyTransferId) return;
    setBusyTransferId(transfer.id);
    setError(undefined);
    try {
      const decided = await decideProjectTransfer(
        transfer.id,
        decision,
        destinationWorkspaceId
      );
      if (decided.status === "ACCEPTED") {
        activateTransferredProject(decided);
        return;
      }
      setTransfers((current) =>
        decision === "decline"
          ? current.filter(({ id }) => id !== transfer.id)
          : current.map((item) => (item.id === decided.id ? decided : item))
      );
    } catch (requestError) {
      setError(notificationCenterError(requestError));
    } finally {
      setBusyTransferId(undefined);
    }
  }

  const totalUnread = (page.unreadCount ?? 0) + invites.length + transfers.length;

  return (
    <div className="notification-center-stack">
      <section className="panel notification-center-toolbar">
        <div className="notification-filter" role="group" aria-label={uiText("Фильтр")}>
          <button
            aria-pressed={!unreadOnly}
            className={!unreadOnly ? "active" : undefined}
            onClick={() => setUnreadOnly(false)}
            type="button"
          >
            <UiText text="Все" /></button>
          <button
            aria-pressed={unreadOnly}
            className={unreadOnly ? "active" : undefined}
            onClick={() => setUnreadOnly(true)}
            type="button"
          >
            <UiText text="Непрочитанные" />{totalUnread > 0 && (
              <span>{totalUnread}</span>
            )}
          </button>
        </div>
        <div className="notification-center-actions">
          <a className="text-button" href="/app/settings/notifications">
            <UiText text="Настроить доставку" /></a>
          <button
            className="secondary-button"
            disabled={markingAll || (page.unreadCount ?? 0) === 0}
            onClick={() => void markAllRead()}
            type="button"
          >
            {markingAll ? <UiText text="Отмечаем…" /> : <UiText text="Прочитать всё" />}
          </button>
        </div>
      </section>

      {error && (
        <div className="inline-alert danger notification-center-error" role="alert">
          <span>{<UiText text={error ?? ""} />}</span>
          <button
            className="text-button"
            onClick={() => setRetryVersion((value) => value + 1)}
            type="button"
          >
            <UiText text="Повторить" /></button>
        </div>
      )}

      <WorkspaceInviteNotificationList
        {...(busyInviteId ? { busyInviteId } : {})}
        invites={invites}
        onAccept={(invite) => void decideInvite(invite, "accept")}
        onDecline={(invite) => void decideInvite(invite, "decline")}
      />
      <ProjectTransferNotificationList
        {...(busyTransferId ? { busyTransferId } : {})}
        onAccept={(transfer, destinationWorkspaceId) =>
          void decideTransfer(transfer, "accept", destinationWorkspaceId)
        }
        onDecline={(transfer) => void decideTransfer(transfer, "decline")}
        transfers={transfers}
      />

      {loading ? (
        <section
          className="panel notification-center-loading"
          aria-busy="true"
          aria-label={uiText("Загружаем уведомления")}
        >
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} />
          ))}
        </section>
      ) : items.length === 0 ? (
        invites.length === 0 && transfers.length === 0 ? (
          <section className="panel panel-empty notification-center-empty">
            <span className="state-icon">✓</span>
            <strong>
              {unreadOnly
                ? <UiText text="Все уведомления прочитаны" />
                : <UiText text="Уведомлений пока нет" />}
            </strong>
            <p>
              {unreadOnly
                ? <UiText text="Новые события появятся здесь после выполнения работ." />
                : <UiText text="Здесь будут результаты заданий, упоминания, предупреждения и отчёты." />}
            </p>
          </section>
        ) : null
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
                  <span>{<UiText text={eventLabel(item.eventType) ?? ""} />}</span>
                  <time dateTime={item.createdAt}>
                    {formatNotificationTime(item.createdAt, uiLocale)}
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
                        ? <UiText text="Отмечаем…" />
                        : <UiText text="Отметить прочитанным" />}
                    </button>
                  )}
                  {item.deepLink && (
                    <button
                      className="text-button"
                      onClick={() => void openItem(item, uiLocale)}
                      type="button"
                    >
                      <UiText text="Открыть" /></button>
                  )}
                </div>
              </div>
              {!item.readAt && (
                <span className="notification-unread-dot" aria-label={uiText("Не прочитано")} />
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
          {loadingMore ? <UiText text="Загружаем…" /> : <UiText text="Показать ещё" />}
        </button>
      )}
      {selectedOperation && (
        <OperationResultModal
          description={selectedOperation.description}
          kind={selectedOperation.kind}
          onClose={() => setSelectedOperation(undefined)}
          operationId={selectedOperation.operationId}
          projectId={selectedOperation.projectId}
          title={selectedOperation.title}
        />
      )}
    </div>
  );
}

function notificationOperationTitle(
  kind: OperationResultKind,
  notificationTitle: string
): string {
  if (
    kind === "crawl" &&
    (notificationTitle.includes("HTTP-статусов") ||
      notificationTitle.includes("Обход сайта"))
  ) {
    return "Обход сайта";
  }
  return ({
    frequency: "Сбор частотности",
    "ai-answer": "Сбор ИИ-ответов",
    clustering: "Кластеризация запросов",
    rank: "Проверка позиций",
    crawl: "Технический аудит",
    research: "Сбор конкурентов"
  } as const)[kind];
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
    signal ? { signal } : {}
  );
}

function mergeNotifications(
  current: readonly NotificationItem[],
  incoming: readonly NotificationItem[]
): readonly NotificationItem[] {
  const seen = new Set(current.map(({ id }) => id));
  return [...current, ...incoming.filter(({ id }) => !seen.has(id))];
}

function mergeLatestNotifications(
  latest: readonly NotificationItem[],
  current: readonly NotificationItem[]
): readonly NotificationItem[] {
  const latestIds = new Set(latest.map(({ id }) => id));
  return [...latest, ...current.filter(({ id }) => !latestIds.has(id))];
}

function formatNotificationTime(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, {
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
