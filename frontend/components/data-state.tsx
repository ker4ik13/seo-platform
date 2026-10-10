"use client";

import { BrowserApiError } from "../lib/browser-api";
import { UiText } from "./ui-locale";

export function dataFailureKind(error: unknown): "ERROR" | "FORBIDDEN" | "DISABLED" | "NO_CONNECTION" {
  if (!(error instanceof BrowserApiError)) return "ERROR";
  if (error.status === 401 || error.status === 403) return "FORBIDDEN";
  if (["FEATURE_DISABLED", "TOOL_DISABLED"].includes(error.code)) return "DISABLED";
  if (["INTEGRATION_ROUTE_REQUIRED", "PROVIDER_NOT_CONFIGURED", "INTEGRATION_REQUIRED"].includes(error.code)) return "NO_CONNECTION";
  return "ERROR";
}

export function canRetainReadData(error: unknown): boolean {
  return !(error instanceof BrowserApiError && [401, 403, 404].includes(error.status));
}

export function DataState({ kind, title, actionLabel, onAction, href }: Readonly<{
  kind: "EMPTY" | "ERROR" | "FORBIDDEN" | "DISABLED" | "NO_CONNECTION";
  title?: string | undefined;
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
}>) {
  const labels = { EMPTY: "Нет данных", ERROR: "Не удалось загрузить данные", FORBIDDEN: "Недостаточно прав для просмотра",
    DISABLED: "Функция отключена администратором", NO_CONNECTION: "Подключение не настроено" } as const;
  return <div className="workspace-data-state" role={kind === "EMPTY" ? "status" : "alert"}>
    <strong><UiText text={title ?? labels[kind]} /></strong>
    {kind === "FORBIDDEN" && <span><UiText text="Обратитесь к администратору рабочей области" /></span>}
    {kind === "NO_CONNECTION" ? <a className="secondary-button" href="/app/settings/integrations"><UiText text="Настроить подключение" /></a>
      : kind !== "DISABLED" && kind !== "FORBIDDEN" && actionLabel && (href
        ? <a className="secondary-button" href={href}><UiText text={actionLabel} /></a>
        : onAction && <button className="secondary-button" type="button" onClick={onAction}><UiText text={actionLabel} /></button>)}
  </div>;
}
