"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

const SIDEBAR_COLLAPSED_KEY = "seo-sidebar-collapsed";

export function SidebarCollapseButton() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = readCollapsedPreference();
    setCollapsed(stored);
    setShellCollapsed(buttonRef.current, stored);
  }, []);

  function toggle(): void {
    setCollapsed((current) => {
      const next = !current;
      writeCollapsedPreference(next);
      setShellCollapsed(buttonRef.current, next);
      return next;
    });
  }

  const label = collapsed ? "Развернуть сайдбар" : "Свернуть сайдбар";
  return (
    <button
      aria-expanded={!collapsed}
      aria-label={label}
      className="sidebar-collapse-button"
      onClick={toggle}
      ref={buttonRef}
      title={label}
      type="button"
    >
      <Icon name="panelLeftClose" />
    </button>
  );
}

function setShellCollapsed(
  target: HTMLElement | null,
  collapsed: boolean
): void {
  target?.closest(".app-shell")?.classList.toggle("sidebar-collapsed", collapsed);
}

function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // The sidebar still works when browser storage is unavailable.
  }
}
