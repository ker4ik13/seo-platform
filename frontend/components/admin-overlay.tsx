"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icon";

export function AdminHeaderActions({ children }: Readonly<{ children: ReactNode }>) {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => { setHost(document.getElementById("admin-page-actions")); }, []);
  return host ? createPortal(children, host) : null;
}

export function AdminOverlay({ title, children, onClose, busy = false, drawer = false }: Readonly<{
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; drawer?: boolean;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => { setHost(document.querySelector(".admin-root")); }, []);
  useEffect(() => { if (host && !dialog.current?.open) dialog.current?.showModal(); }, [host]);
  if (!host) return null;
  return createPortal(<dialog ref={dialog} className={`admin-overlay${drawer ? " admin-overlay-drawer" : ""}`}
    aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => { if (event.target === dialog.current && !busy) {
      const bounds = dialog.current.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <header><h2>{title}</h2><button aria-label="Закрыть" className="icon-button" disabled={busy} onClick={onClose} type="button"><Icon name="close" /></button></header>
    <div className="admin-overlay-body">{children}</div>
  </dialog>, host);
}
