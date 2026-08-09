"use client";

import {
  useEffect,
  useRef,
  type ReactNode
} from "react";

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly dividerBefore?: boolean;
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
  const estimatedExtraHeight = children ? 58 : 0;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const reposition = () => onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)"
    );
    first?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [onClose]);

  return (
    <div
      aria-label={label}
      className="context-menu"
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{
        left: Math.min(x, Math.max(8, viewportWidth - 236)),
        top: Math.min(
          y,
          Math.max(
            8,
            viewportHeight - items.length * 40 - estimatedExtraHeight - 20
          )
        )
      }}
    >
      {items.map((item) => (
        <div className="context-menu-entry" key={item.id}>
          <button
            className={`${item.danger ? "danger" : ""}${item.dividerBefore ? " divided" : ""}`}
            disabled={item.disabled}
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
          {children && item.id === afterItemId ? children : null}
        </div>
      ))}
    </div>
  );
}
