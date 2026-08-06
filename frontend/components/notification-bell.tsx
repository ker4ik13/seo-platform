"use client";

import type {
  NotificationReadAllResult,
  PendingWorkspaceInviteSummary,
  ProjectTransferRequestSummary
} from "@seo-platform/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  browserApiCollectionRequest,
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  announceWorkspaceDropdownOpen,
  workspaceDropdownOpenEvent
} from "../lib/dropdown-events";
import { Icon } from "./icon";
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
  parseOperationResultHref,
  type OperationResultKind
} from "../lib/operation-result-routes";
import { OperationResultModal } from "./operation-result-modal";

const NOTIFICATION_UPDATE_EVENT = "notification-center-updated";
const POLL_INTERVAL_MS = 20_000;

type NotificationSeverity = "INFO" | "WARNING" | "CRITICAL";

interface HeaderNotification {
  readonly id: string;
  readonly projectId?: string;
  readonly eventType: string;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body?: string;
  readonly deepLink?: string;
  readonly readAt?: string;
  readonly createdAt: string;
}

interface NotificationToast extends HeaderNotification {
  readonly toastId: string;
}

interface NotificationOperation {
  readonly kind: OperationResultKind;
  readonly operationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
}

export function NotificationBell({ projectId }: Readonly<{ projectId?: string }>) {
  const [unreadCount, setUnreadCount] = useState<number>();
  const [items, setItems] = useState<readonly HeaderNotification[]>([]);
  const [invites, setInvites] = useState<readonly PendingWorkspaceInviteSummary[]>([]);
  const [transfers, setTransfers] = useState<readonly ProjectTransferRequestSummary[]>([]);
  const [busyInviteId, setBusyInviteId] = useState<string>();
  const [busyTransferId, setBusyTransferId] = useState<string>();
  const [toasts, setToasts] = useState<readonly NotificationToast[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedOperation, setSelectedOperation] = useState<NotificationOperation>();
  const rootRef = useRef<HTMLDivElement>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const openRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    let active = true;

    const refresh = async (announceNew: boolean): Promise<void> => {
      try {
        const [notificationResult, inviteResult, transferResult] = await Promise.allSettled([
          browserApiCollectionRequest<HeaderNotification>(
            "/app/api/notifications?limit=12&unreadOnly=false"
          ),
          loadPendingWorkspaceInvites(),
          loadPendingProjectTransfers()
        ]);
        if (!active) return;
        if (inviteResult.status === "fulfilled") {
          setInvites(inviteResult.value.data);
        }
        if (transferResult.status === "fulfilled") {
          setTransfers(transferResult.value.data);
        }
        if (notificationResult.status === "rejected") {
          throw notificationResult.reason;
        }
        const result = notificationResult.value;
        const incoming = result.data;
        const unseen = initializedRef.current
          ? incoming.filter(
              (item) => !item.readAt && !knownIdsRef.current.has(item.id)
            )
          : [];
        knownIdsRef.current = new Set(incoming.map(({ id }) => id));
        initializedRef.current = true;
        setItems(incoming);
        setUnreadCount(result.page.unreadCount ?? 0);
        setError(undefined);
        if (announceNew && unseen.length > 0) {
          const operationItems = unseen.filter(isOperationNotification);
          if (operationItems.length > 0) {
            playOperationCompletionSound();
          }
          setToasts((current) =>
            [
              ...current,
              ...unseen.slice(0, 3).map((item) => ({
                ...item,
                toastId: item.id
              }))
            ].slice(0, 4)
          );
        }
      } catch (requestError) {
        if (active && openRef.current) setError(notificationError(requestError));
      } finally {
        if (active) setLoading(false);
      }
    };

    setLoading(true);
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), POLL_INTERVAL_MS);
    const refreshAfterVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", refreshAfterVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshAfterVisibility);
    };
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setToasts((current) => current.slice(1));
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    const update = (event: Event) => {
      const count = (event as CustomEvent<number>).detail;
      if (Number.isSafeInteger(count) && count >= 0) setUnreadCount(count);
    };
    window.addEventListener(NOTIFICATION_UPDATE_EVENT, update);
    return () => window.removeEventListener(NOTIFICATION_UPDATE_EVENT, update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeForAnotherDropdown = (event: Event) => {
      if ((event as CustomEvent<EventTarget>).detail !== rootRef.current) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener(workspaceDropdownOpenEvent, closeForAnotherDropdown);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener(
        workspaceDropdownOpenEvent,
        closeForAnotherDropdown
      );
    };
  }, [open]);

  async function markRead(item: HeaderNotification): Promise<void> {
    if (item.readAt) return;
    try {
      const updated = await browserApiRequest<HeaderNotification>(
        `/app/api/notifications/${encodeURIComponent(item.id)}/read`,
        { method: "PATCH" }
      );
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate
        )
      );
      setUnreadCount((current) => {
        const next = Math.max(0, (current ?? 1) - 1);
        publishUnreadCount(next);
        return next;
      });
    } catch (requestError) {
      setError(notificationError(requestError));
    }
  }

  async function markAllRead(): Promise<void> {
    if (markingAll || (unreadCount ?? 0) === 0) return;
    setMarkingAll(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<NotificationReadAllResult>(
        "/app/api/notifications/read-all",
        { method: "POST" }
      );
      setItems((current) =>
        current.map((item) =>
          item.readAt ? item : { ...item, readAt: result.readAt }
        )
      );
      setUnreadCount(0);
      publishUnreadCount(0);
    } catch (requestError) {
      setError(notificationError(requestError));
    } finally {
      setMarkingAll(false);
    }
  }

  async function openItem(item: HeaderNotification): Promise<void> {
    if (!item.readAt) await markRead(item);
    if (!item.deepLink) return;
    const operation = parseOperationResultHref(item.deepLink);
    const operationProjectId = item.projectId ?? projectId;
    if (operation && operationProjectId) {
      setOpen(false);
      setSelectedOperation({
        ...operation,
        projectId: operationProjectId,
        title: operationTitle(operation.kind, item.title),
        description: `${item.title} · ${formatTime(item.createdAt)}`
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
      setError(notificationError(requestError));
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
      setError(notificationError(requestError));
    } finally {
      setBusyTransferId(undefined);
    }
  }

  const totalUnread = (unreadCount ?? 0) + invites.length + transfers.length;
  const label =
    unreadCount === undefined
      ? "Открыть центр уведомлений"
      : totalUnread === 0
        ? "Новых уведомлений нет"
        : `Непрочитанных уведомлений: ${totalUnread}`;
  const unread = items.filter(({ readAt }) => !readAt);
  const read = items.filter(({ readAt }) => Boolean(readAt));

  return (
    <>
      <div className="notification-bell-root" ref={rootRef}>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={label}
          className="icon-button notification-bell"
          onClick={() => {
            setOpen((current) => {
              if (!current && rootRef.current) {
                announceWorkspaceDropdownOpen(rootRef.current);
              }
              return !current;
            });
          }}
          title={label}
          type="button"
        >
          <Icon name="bell" />
          {unreadCount !== undefined && totalUnread > 0 && (
            <span className="notification-count">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </button>

        {open && (
          <section
            aria-label="Последние уведомления"
            className="notification-popover"
            data-exclusive-dropdown-layer
          >
            <header>
              <h2>Уведомления</h2>
              <div className="notification-popover-actions">
                <button
                  aria-label="Прочитать все"
                  disabled={markingAll || (unreadCount ?? 0) === 0}
                  onClick={() => void markAllRead()}
                  title="Прочитать все"
                  type="button"
                >
                  <Icon name="checkDouble" />
                </button>
                <a
                  aria-label="Настроить уведомления"
                  href="/app/settings/notifications"
                  title="Настроить уведомления"
                >
                  <Icon name="settings" />
                </a>
              </div>
            </header>
            {error && <div className="notification-popover-error" role="alert">{error}</div>}
            {loading && items.length === 0 && invites.length === 0 && transfers.length === 0 ? (
              <div className="notification-popover-loading" aria-busy="true">
                <i /><i /><i />
              </div>
            ) : items.length === 0 && invites.length === 0 && transfers.length === 0 ? (
              <div className="notification-popover-empty">
                <strong>Уведомлений пока нет</strong>
                <p>Результаты операций и системные сообщения появятся здесь.</p>
              </div>
            ) : (
              <div className="notification-popover-scroll">
                <WorkspaceInviteNotificationList
                  {...(busyInviteId ? { busyInviteId } : {})}
                  compact
                  invites={invites}
                  onAccept={(invite) => void decideInvite(invite, "accept")}
                  onDecline={(invite) => void decideInvite(invite, "decline")}
                />
                <ProjectTransferNotificationList
                  {...(busyTransferId ? { busyTransferId } : {})}
                  compact
                  onAccept={(transfer, destinationWorkspaceId) =>
                    void decideTransfer(
                      transfer,
                      "accept",
                      destinationWorkspaceId
                    )
                  }
                  onDecline={(transfer) => void decideTransfer(transfer, "decline")}
                  transfers={transfers}
                />
                {unread.length > 0 && (
                  <NotificationGroup
                    items={unread}
                    label="Новые"
                    onOpen={openItem}
                  />
                )}
                {read.length > 0 && (
                  <NotificationGroup
                    items={read}
                    label="Ранее"
                    onOpen={openItem}
                  />
                )}
              </div>
            )}
            <footer>
              <Link href="/app/notifications" onClick={() => setOpen(false)}>
                Показать все уведомления
              </Link>
            </footer>
          </section>
        )}
      </div>

      {toasts.length > 0 && (
        <div className="notification-toast-stack" aria-live="polite">
          {toasts.slice(0, 1).map((toast) => (
            <article className={`notification-toast severity-${toast.severity.toLowerCase()}`} key={toast.toastId}>
              <button
                aria-label="Закрыть уведомление"
                className="notification-toast-close"
                onClick={() => setToasts((current) => current.filter(({ toastId }) => toastId !== toast.toastId))}
                type="button"
              >
                ×
              </button>
              <span>{eventLabel(toast.eventType)}</span>
              <strong>{toast.title}</strong>
              {toast.body && <p>{toast.body}</p>}
              {toast.deepLink && (
                <button className="text-button" onClick={() => void openItem(toast)} type="button">
                  Открыть результат
                </button>
              )}
            </article>
          ))}
        </div>
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
    </>
  );
}

function operationTitle(kind: OperationResultKind, notificationTitle: string): string {
  if (kind === "crawl" && notificationTitle.includes("HTTP-статусов")) {
    return "Проверка HTTP-статусов";
  }
  return ({
    frequency: "Сбор частотности",
    rank: "Проверка позиций",
    crawl: "Технический аудит",
    research: "Сбор конкурентов"
  } as const)[kind];
}

function NotificationGroup({
  items,
  label,
  onOpen
}: Readonly<{
  items: readonly HeaderNotification[];
  label: string;
  onOpen: (item: HeaderNotification) => Promise<void>;
}>) {
  return (
    <section className="notification-popover-group">
      <h3>{label}</h3>
      {items.map((item) => (
        <button
          className={item.readAt ? "read" : "unread"}
          key={item.id}
          onClick={() => void onOpen(item)}
          type="button"
        >
          <span className={`notification-popover-severity severity-${item.severity.toLowerCase()}`} />
          <span>
            <small>{eventLabel(item.eventType)} · {formatTime(item.createdAt)}</small>
            <strong>{item.title}</strong>
            {item.body && <em>{item.body}</em>}
          </span>
          {!item.readAt && <i aria-label="Не прочитано" />}
        </button>
      ))}
    </section>
  );
}

function isOperationNotification(item: HeaderNotification): boolean {
  return [
    "SEMANTIC_IMPORT",
    "RANK_TRACKING",
    "FREQUENCY_COLLECTION",
    "SERP_COLLECTION",
    "CLUSTERING",
    "CRAWL_RADAR",
    "SITEMAP",
    "MAGNET",
    "AUTOMATION",
    "JOB",
    "REPORT"
  ].includes(item.eventType);
}

function playOperationCompletionSound(): void {
  try {
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    gain.connect(context.destination);
    const first = context.createOscillator();
    const second = context.createOscillator();
    first.frequency.value = 660;
    second.frequency.value = 880;
    first.connect(gain);
    second.connect(gain);
    first.start(context.currentTime);
    first.stop(context.currentTime + 0.14);
    second.start(context.currentTime + 0.12);
    second.stop(context.currentTime + 0.28);
    window.setTimeout(() => void context.close(), 450);
  } catch {
    // Browsers may block audio until the user interacts with the page.
  }
}

function eventLabel(eventType: string): string {
  const labels: Readonly<Record<string, string>> = {
    ASSIGNMENT: "Назначение",
    MENTION: "Упоминание",
    SEMANTIC_IMPORT: "Импорт семантики",
    RANK_TRACKING: "Проверка позиций",
    FREQUENCY_COLLECTION: "Сбор частотности",
    SERP_COLLECTION: "Сбор выдачи",
    CLUSTERING: "Кластеризация",
    CRAWL_RADAR: "Проверка сайта",
    SITEMAP: "Карта сайта",
    MAGNET: "Поисковый инструмент",
    AUTOMATION: "Автоматизация",
    INTEGRATION: "Интеграция",
    JOB: "Операция",
    REPORT: "Отчёт",
    SECURITY: "Безопасность",
    BILLING: "Биллинг",
    PRODUCT: "Новости продукта"
  };
  return labels[eventType] ?? "Системное событие";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function notificationError(error: unknown): string {
  if (error instanceof BrowserApiError) return error.message;
  return "Не удалось обновить уведомления.";
}

export function publishUnreadCount(unreadCount: number): void {
  window.dispatchEvent(
    new CustomEvent<number>(NOTIFICATION_UPDATE_EVENT, {
      detail: unreadCount
    })
  );
}
