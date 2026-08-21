"use client";

import {
  useEffect,
  useRef,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly dividerBefore?: boolean;
  readonly inlineGroup?: string;
  readonly onSelect: () => void;
}

export function ContextMenu({
  afterItemId,
  children,
  items,
  label,
  onClose,
  x,
  y
}: Readonly<{
  afterItemId?: string;
  children?: ReactNode;
  items: readonly ContextMenuItem[];
  label: string;
  onClose: () => void;
  x: number;
  y: number;
}>) {
  const menuRef = useRef<HTMLDivElement>(null);
  const viewportWidth = typeof window === "undefined" ? 1920 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 1080 : window.innerHeight;
  const estimatedExtraHeight = children ? 62 : 0;
  const estimatedRows = items.reduce(
    (count, item, index) =>
      item.inlineGroup && items[index - 1]?.inlineGroup === item.inlineGroup
        ? count
        : count + 1,
    0
  );

  function menuButton(item: ContextMenuItem) {
    return (
      <button
        className={`${item.danger ? "danger" : ""}${item.dividerBefore && !item.inlineGroup ? " divided" : ""}`}
        disabled={item.disabled}
        key={item.id}
        onClick={() => {
          item.onSelect();
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        {item.icon && <span aria-hidden="true">{item.icon}</span>}
        {item.label}
      </button>
    );
  }

  const entries: ReactNode[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    if (item.inlineGroup) {
      if (items[index - 1]?.inlineGroup === item.inlineGroup) continue;
      const boundedInlineItems: ContextMenuItem[] = [];
      for (
        let cursor = index;
        items[cursor]?.inlineGroup === item.inlineGroup;
        cursor += 1
      ) {
        const candidate = items[cursor];
        if (candidate) boundedInlineItems.push(candidate);
      }
      entries.push(
        <div className="context-menu-entry" key={`inline:${item.inlineGroup}`}>
          <div
            className={`context-menu-inline-row${item.dividerBefore ? " divided" : ""}`}
            role="group"
          >
            {boundedInlineItems.map(menuButton)}
          </div>
          {children && boundedInlineItems.some(({ id }) => id === afterItemId)
            ? children
            : null}
        </div>
      );
      continue;
    }
    entries.push(
      <div className="context-menu-entry" key={item.id}>
        {menuButton(item)}
        {children && item.id === afterItemId ? children : null}
      </div>
    );
  }

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const reposition = () => onClose();
    // Сначала переводим фокус внутрь уже открытого меню. На телефоне браузер
    // может прокрутить drawer к сфокусированной кнопке; если подписаться на
    // scroll раньше, меню тут же закроется собственным автофокусом.
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)"
    );
    first?.focus();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", reposition);
    const shouldCloseOnScroll = !window.matchMedia("(max-width: 620px)").matches;
    if (shouldCloseOnScroll) {
      window.addEventListener("scroll", reposition, true);
    }
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", reposition);
      if (shouldCloseOnScroll) {
        window.removeEventListener("scroll", reposition, true);
      }
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-label={label}
      className="context-menu"
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{
        left: Math.min(x, Math.max(8, viewportWidth - 212)),
        top: Math.min(
          y,
          Math.max(
            8,
            viewportHeight - estimatedRows * 34 - estimatedExtraHeight - 18
          )
        )
      }}
    >
      {entries}
    </div>,
    document.body
  );
}
