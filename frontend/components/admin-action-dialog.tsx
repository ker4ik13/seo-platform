"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icon";
import { ConfirmationActions } from "./confirmation-actions";

export function AdminActionDialog({ title, description, defaultReason, onClose, onConfirm }: Readonly<{ title: string; description: string; defaultReason?: string; onClose: () => void; onConfirm: (reason: string) => Promise<string | undefined> }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState(defaultReason ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [host, setHost] = useState<Element>();
  useEffect(() => { setHost(document.querySelector(".admin-root") ?? document.body); }, []);
  useEffect(() => { if (host && !dialog.current?.open) dialog.current?.showModal(); }, [host]);
  if (!host) return null;
  return createPortal(<dialog className="admin-action-dialog" ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => {
      event.preventDefault(); if (busy || !confirmed || reason.trim().length < 8) return;
      setBusy(true); setError(undefined);
      void onConfirm(reason.trim()).then((message) => { setBusy(false); if (message) setError(message); else onClose(); }).catch(() => { setBusy(false); setError("Не удалось выполнить действие. Попробуйте ещё раз."); });
    }}>
      <header><span className="admin-action-icon"><Icon name="warning" /></span><h2>{title}</h2><button aria-label="Закрыть" className="icon-button" disabled={busy} onClick={onClose} type="button"><Icon name="close" /></button></header>
      <p>{description}</p>
      <label className="admin-action-reason">Причина для журнала аудита<textarea autoFocus minLength={8} maxLength={500} required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Кратко объясните причину действия" /></label>
      <label className="admin-action-confirm"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />Подтверждаю действие</label>
      {error && <div className="form-alert" role="alert">{error}</div>}
      <footer><ConfirmationActions><button className="ghost" disabled={busy} onClick={onClose} type="button">Отмена</button><button className="primary" disabled={busy || !confirmed || reason.trim().length < 8} type="submit">{busy ? "Выполняем…" : "Подтвердить"}</button></ConfirmationActions></footer>
    </form>
  </dialog>, host);
}
