"use client";

import {
  useEffect,
  useRef,
  type RefObject,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { UiText } from "./ui-locale";

export interface ContextMenuItem {
  readonly id: string;
  /** Authored action copy; user text belongs in children/footer, not this label. */
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
  footer,
  items,
  label,
  onClose,
  presentation = "context",
  triggerRef,
  x,
  y
}: Readonly<{
  afterItemId?: string;
  children?: ReactNode;
  footer?: ReactNode;
  items: readonly ContextMenuItem[];
  label: string;
  onClose: () => void;
  presentation?: "context" | "dropdown";
  triggerRef?: RefObject<HTMLElement | null>;
  x: number;
  y: number;
}>) {
  const menuRef = useRef<HTMLDivElement>(null);
  const viewportWidth = typeof window === "undefined" ? 1920 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 1080 : window.innerHeight;
  const isMobileDropdown =
    presentation === "dropdown" && viewportWidth <= 620;
  const estimatedWidth = isMobileDropdown
    ? Math.min(260, viewportWidth - 16)
    : 204;
  const estimatedRowHeight = isMobileDropdown ? 44 : 34;
  const estimatedExtraHeight = (children ? 62 : 0) + (footer ? 64 : 0);
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
        <UiText text={item.label} />
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
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !triggerRef?.current?.contains(target)
      ) {
        onClose();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const openingAnchor = triggerRef?.current?.getBoundingClientRect();
    const scroll = () => {
      const anchor = triggerRef?.current?.getBoundingClientRect();
      // A horizontally scrolled toolbar can deliver its scroll event after
      // the click opened this menu. Keep it if the anchor has not moved since
      // opening; close on a real subsequent scroll, not the queued old event.
      if (presentation === "dropdown" && openingAnchor && anchor &&
        Math.abs(anchor.left - openingAnchor.left) < 0.5 &&
        Math.abs(anchor.top - openingAnchor.top) < 0.5) return;
      onClose();
    };
    // The fixed menu is already inside the viewport. Focusing it must not
    // scroll a mobile toolbar and asynchronously trigger our close listener.
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)"
    );
    first?.focus({ preventScroll: true });
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    const shouldCloseOnScroll =
      presentation === "dropdown" ||
      !window.matchMedia("(max-width: 620px)").matches;
    if (shouldCloseOnScroll) {
      window.addEventListener("scroll", scroll, true);
    }
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      if (shouldCloseOnScroll) {
        window.removeEventListener("scroll", scroll, true);
      }
    };
  }, [onClose, presentation, triggerRef]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-label={label}
      className={`context-menu context-menu-${presentation}`}
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{
        left: Math.min(
          Math.max(8, x),
          Math.max(8, viewportWidth - estimatedWidth - 8)
        ),
        top: Math.min(
          y,
          Math.max(
            8,
            viewportHeight -
              estimatedRows * estimatedRowHeight -
              estimatedExtraHeight -
              18
          )
        )
      }}
    >
      {entries}
      {footer ? <div className="context-menu-footer">{footer}</div> : null}
    </div>,
    document.body
  );
}
