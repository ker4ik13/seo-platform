"use client";
import { useCallback, useEffect, useState } from "react";
import type { AdminRefundRequest } from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { UiText } from "../../components/ui-locale";
import { useUiLocale } from "../../components/ui-locale";



const statuses = { REQUESTED: "На рассмотрении", APPROVED: "Одобрено", PROCESSING: "Обрабатывается", MANUAL_REQUIRED: "Ручной возврат", SUCCEEDED: "Завершено", REJECTED: "Отклонено", FAILED: "Не выполнено" };
const money = (minor: number, uiLocale: string = "ru-RU") => new Intl.NumberFormat(uiLocale, { style: "currency", currency: "RUB" }).format(minor / 100);
export function RefundAdministration({ canDecide }: { canDecide: boolean }) {
  const { locale: uiLocale, t: uiText } = useUiLocale();
  const [rows, setRows] = useState<readonly AdminRefundRequest[]>();
  const [selected, setSelected] = useState<string>();
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const load = useCallback(async () => {
    const result = await adminApi<readonly AdminRefundRequest[]>("/api/refund-requests");
    if (result.ok) setRows(result.data); else setError(result.message);
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [load]);
  const request = rows?.find(row => row.id === selected);
  async function command(action: "decision" | "confirm-manual" | "reconcile-provider", decision?: "APPROVE" | "REJECT") {
    if (!request || busy) return;
    if (action === "decision" && reason.trim().length < 3) { setError("Укажите понятную клиенту причину решения."); return; }
    if (action !== "reconcile-provider" && !confirmed) { setError("Подтвердите проверку суммы и действия."); return; }
    setBusy(true); setError(undefined); setNotice(undefined);
    const body = action === "decision" ? { decision, reason: reason.trim() } : action === "confirm-manual" ? { confirmedTransferred: true, reference: reference.trim() } : { externalRefundId: reference.trim() };
    const result = await adminApi(`/api/refund-requests/${request.id}/${action}`, { method: "POST", headers: { "If-Match": `"v${request.version}"` }, body: JSON.stringify(body) });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setConfirmed(false); setNotice(action === "decision" ? "Решение сохранено. Статус возврата обновится автоматически." : "Результат проверен и сохранён.");
    await load();
  }
  return <div className="content"><section className="page-heading"><div><p className="eyebrow"><UiText text="Финансы" /></p><h1><UiText text="Заявки на возврат" /></h1><p><UiText text="Решение владельца, проверенный остаток и состояние выплаты." /></p></div><button className="ghost" type="button" onClick={() => void load()}><UiText text="Обновить" /></button></section>
    {error && <p className="error" role="alert">{<UiText text={error ?? ""} />}</p>}{notice && <p className="notice" role="status">{<UiText text={notice ?? ""} />}</p>}
    <div className="admin-refund-layout"><section className="panel"><h2><UiText text="Заявки" /></h2>{!rows ? <p><UiText text="Загружаем…" /></p> : rows.length === 0 ? <p className="muted"><UiText text="Заявок пока нет." /></p> : <div className="admin-refund-list">{rows.map(row => <button type="button" key={row.id} className={row.id === selected ? "selected" : undefined} onClick={() => { setSelected(row.id); setReason(""); setReference(""); setConfirmed(false); setNotice(undefined); }}><span><strong>{row.workspaceName}</strong><small>{row.description}</small><small>{uiText(statuses[row.status])} · {new Date(row.createdAt).toLocaleDateString(uiLocale)}</small></span><b>{money(row.approvedAmountMinor ?? row.requestedAmountMinor, uiLocale)}</b></button>)}</div>}</section>
      <section className="panel admin-refund-detail">{!request ? <p className="muted"><UiText text="Выберите заявку для проверки." /></p> : <><h2>{request.workspaceName}</h2><p>{request.description}</p><dl><div><dt><UiText text="Запрошено" /></dt><dd>{money(request.requestedAmountMinor, uiLocale)}</dd></div><div><dt>{request.status === "REQUESTED" ? <UiText text="Можно одобрить сейчас" /> : <UiText text="Одобрено" />}</dt><dd>{money(request.status === "REQUESTED" ? Math.min(request.maximumAmountMinor, request.requestedAmountMinor) : request.approvedAmountMinor ?? 0, uiLocale)}</dd></div><div><dt><UiText text="Способ оплаты" /></dt><dd>{request.provider === "YOOKASSA" ? <UiText text="ЮKassa" /> : "Crypto Pay"}</dd></div></dl><p className="admin-refund-reason">{request.reason}</p>
        {request.decisionReason && <p>{request.decisionReason}</p>}
        {canDecide && request.status === "REQUESTED" && <><label><UiText text="Причина решения" /><textarea maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label><label className="admin-refund-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><UiText text="Я проверил заявку и сумму. При одобрении средства будут зарезервированы, а оплаченные дни пересчитаны." /></label><div className="action-row"><button className="primary" type="button" disabled={busy || !confirmed || request.maximumAmountMinor < 1} onClick={() => void command("decision", "APPROVE")}>{request.provider === "YOOKASSA" ? <UiText text="Одобрить возврат через ЮKassa" /> : <UiText text="Одобрить ручной возврат" />}</button><button className="ghost" type="button" disabled={busy || !confirmed} onClick={() => void command("decision", "REJECT")}><UiText text="Отклонить" /></button></div></>}
        {canDecide && request.status === "MANUAL_REQUIRED" && <><p><UiText text="Выполните возврат вручную и сохраните подтверждение. Деньги на балансе клиента уже зарезервированы." /></p><label><UiText text="Номер или ссылка подтверждения" /><input maxLength={180} value={reference} onChange={event => setReference(event.target.value)} /></label><label className="admin-refund-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><UiText text="Подтверждаю: перевод клиенту выполнен на одобренную сумму." /></label><button className="primary" type="button" disabled={busy || !confirmed || reference.trim().length < 5} onClick={() => void command("confirm-manual")}><UiText text="Подтвердить выполненный возврат" /></button></>}
        {canDecide && request.status === "PROCESSING" && request.provider === "YOOKASSA" && <><p><UiText text="Если автоматическая сверка задержалась, укажите ID возврата из ЮKassa. Система проверит платёж, сумму и статус." /></p><label><UiText text="ID возврата ЮKassa" /><input maxLength={255} value={reference} onChange={event => setReference(event.target.value)} /></label><button className="ghost" type="button" disabled={busy || !reference.trim()} onClick={() => void command("reconcile-provider")}><UiText text="Сверить с ЮKassa" /></button></>}
      </>}</section></div>
  </div>;
}
