"use client";

import { useEffect } from "react";
import {
  sidebarCollapsedCookieName,
  sidebarCollapsedStorageKey
} from "../lib/sidebar-preference";
import { Icon } from "./icon";

export function SidebarCollapseButton({
  collapsed,
  onCollapsedChange
}: Readonly<{
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}>) {
  useEffect(() => {
    const stored = readCollapsedPreference();
    if (stored === undefined) {
      writeCollapsedPreference(collapsed);
      return;
    }
    onCollapsedChange(stored);
    writeCollapsedPreference(stored);
  }, [collapsed, onCollapsedChange]);

  function toggle(): void {
    const next = !collapsed;
    writeCollapsedPreference(next);
    onCollapsedChange(next);
  }

  const label = collapsed ? "Развернуть сайдбар" : "Свернуть сайдбар";
  return (
    <button
      aria-expanded={!collapsed}
      aria-label={label}
      className="sidebar-collapse-button"
      onClick={toggle}
      title={label}
      type="button"
    >
      <Icon name="panelLeftClose" />
    </button>
  );
}

function readCollapsedPreference(): boolean | undefined {
  try {
    const value = window.localStorage.getItem(sidebarCollapsedStorageKey);
    return value === null ? undefined : value === "true";
  } catch {
    return undefined;
  }
}

function writeCollapsedPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(sidebarCollapsedStorageKey, String(collapsed));
  } catch {
    // The sidebar still works when browser storage is unavailable.
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${sidebarCollapsedCookieName}=${collapsed ? "1" : "0"}; Path=/app; Max-Age=31536000; SameSite=Lax${secure}`;
}
