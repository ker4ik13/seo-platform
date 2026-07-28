"use client";

import { useState } from "react";
import type { AppUser } from "../lib/app-types";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";

export function AccountMenu({
  user,
  roleCode
}: Readonly<{ user: AppUser; roleCode: string | undefined }>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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
    <div className="account-menu">
      <button
        aria-expanded={open}
        className="avatar-button"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>{initials(user.displayName)}</span>
        <span className="avatar-copy">
          <strong>{user.displayName}</strong>
          <small>{roleLabel(roleCode)}</small>
        </span>
      </button>
      {open && (
        <div className="account-popover">
          <strong>{user.displayName}</strong>
          <span>{user.email}</span>
          <a className="account-menu-link" href="/app/settings/security">
            Безопасность и профиль
          </a>
          <a className="account-menu-link" href="/app/settings/notifications">
            Настройки уведомлений
          </a>
          <button disabled={busy} onClick={logout} type="button">
            {busy ? "Выходим…" : "Выйти"}
          </button>
          {error && <small role="alert">{error}</small>}
        </div>
      )}
    </div>
  );
}

function initials(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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
