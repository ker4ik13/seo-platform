"use client";

import type { ReactNode } from "react";
import { Icon } from "./icon";
import { useUiLocale } from "./ui-locale";

export function SemanticSideDrawer({
  ariaLabel,
  children,
  className,
  closeLabel,
  eyebrow,
  footer,
  onClose,
  presenceKey,
  title
}: Readonly<{
  ariaLabel: string;
  children: ReactNode;
  className: string;
  closeLabel: string;
  eyebrow: string;
  footer?: ReactNode;
  onClose: () => void;
  presenceKey: string;
  title: string;
}>) {
  const { t } = useUiLocale();
  return (
    <aside
      aria-label={t(ariaLabel)}
      className={`semantic-side-drawer ${className}`}
      data-presence-cursor-anchor="true"
      data-presence-key={presenceKey}
    >
      <header className="semantic-sidebar-header">
        <div>
          <span>{t(eyebrow)}</span>
          <h2>{t(title)}</h2>
        </div>
        <button aria-label={t(closeLabel)} onClick={onClose} type="button">
          <Icon name="close" />
        </button>
      </header>
      <div className="semantic-side-drawer-body">{children}</div>
      {footer && <footer className="semantic-side-drawer-footer">{footer}</footer>}
    </aside>
  );
}
