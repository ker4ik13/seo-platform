"use client";

import { useEffect, useState } from "react";
import { browserApiCollectionRequest } from "../lib/browser-api";
import { Icon } from "./icon";

const NOTIFICATION_UPDATE_EVENT = "notification-center-updated";

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState<number>();

  useEffect(() => {
    const controller = new AbortController();
    void browserApiCollectionRequest<unknown>(
      "/app/api/notifications?limit=1&unreadOnly=true",
      { signal: controller.signal }
    )
      .then(({ page }) => {
        if (!controller.signal.aborted) {
          setUnreadCount(page.unreadCount ?? 0);
        }
      })
      .catch(() => {
        // The center remains reachable when its counter is temporarily degraded.
      });
    const update = (event: Event) => {
      const count = (event as CustomEvent<number>).detail;
      if (Number.isSafeInteger(count) && count >= 0) setUnreadCount(count);
    };
    window.addEventListener(NOTIFICATION_UPDATE_EVENT, update);
    return () => {
      controller.abort();
      window.removeEventListener(NOTIFICATION_UPDATE_EVENT, update);
    };
  }, []);

  const label =
    unreadCount === undefined
      ? "Открыть центр уведомлений"
      : unreadCount === 0
        ? "Уведомлений нет"
        : `Непрочитанных уведомлений: ${unreadCount}`;
  return (
    <a
      aria-label={label}
      className="icon-button notification-bell"
      href="/app/notifications"
      title={label}
    >
      <Icon name="bell" />
      {unreadCount !== undefined && unreadCount > 0 && (
        <span className="notification-count">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </a>
  );
}

export function publishUnreadCount(unreadCount: number): void {
  window.dispatchEvent(
    new CustomEvent<number>(NOTIFICATION_UPDATE_EVENT, {
      detail: unreadCount
    })
  );
}
