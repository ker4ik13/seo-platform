"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AppUser } from "../lib/app-types";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { canViewWorkspaceIntegrations } from "../lib/app-permissions";
import {
  announceWorkspaceDropdownOpen,
  workspaceDropdownOpenEvent
} from "../lib/dropdown-events";
import { UserAvatar } from "./user-avatar";

export function AccountMenu({
  user,
  roleCode
}: Readonly<{ user: AppUser; roleCode: string | undefined }>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const rootRef = useRef<HTMLDivElement>(null);

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
    window.addEventListener(
      workspaceDropdownOpenEvent,
      closeForAnotherDropdown
    );
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener(
        workspaceDropdownOpenEvent,
        closeForAnotherDropdown
      );
    };
  }, [open]);

  async function logout(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest<never>("/app/api/auth/logout", {
        method: "POST"
      });
      window.location.assign("/");
    } catch (requestError) {
      setBusy(false);
      setError(
        requestError instanceof BrowserApiError
          ? requestError.message
          : "Не удалось завершить сессию"
      );
    }
  }

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        className="avatar-button"
        onClick={() => {
          setOpen((value) => {
            if (!value && rootRef.current) {
              announceWorkspaceDropdownOpen(rootRef.current);
            }
            return !value;
          });
        }}
        type="button"
      >
        <UserAvatar className="account-menu-avatar" size={34} user={user} />
        <span className="avatar-copy">
          <strong>{user.displayName}</strong>
          <small>{roleLabel(roleCode)}</small>
        </span>
      </button>
      {open && (
        <div className="account-popover" data-exclusive-dropdown-layer>
          <strong>{user.displayName}</strong>
          <span>{user.email}</span>
          <Link
            className="account-menu-link"
            href="/app/settings/security"
            onClick={() => setOpen(false)}
          >
            Безопасность и профиль
          </Link>
          <Link
            className="account-menu-link"
            href="/app/settings/notifications"
            onClick={() => setOpen(false)}
          >
            Настройки уведомлений
          </Link>
          {canViewWorkspaceIntegrations(roleCode) && (
            <Link
              className="account-menu-link"
              href="/app/settings/integrations"
              onClick={() => setOpen(false)}
            >
              API-интеграции
            </Link>
          )}
          <button disabled={busy} onClick={logout} type="button">
            {busy ? "Выходим…" : "Выйти"}
          </button>
          {error && <small role="alert">{error}</small>}
        </div>
      )}
    </div>
  );
}

function roleLabel(roleCode: string | undefined): string {
  const labels: Readonly<Record<string, string>> = {
    OWNER: "Владелец",
    ADMIN: "Администратор",
    SEO_LEAD: "SEO Lead",
    SEO_SPECIALIST: "SEO-специалист",
    ANALYST: "Аналитик",
    CONTENT_EDITOR: "Контент-редактор",
    CLIENT: "Клиент",
    VIEWER: "Наблюдатель"
  };
  return roleCode ? (labels[roleCode] ?? roleCode) : "Профиль";
}
