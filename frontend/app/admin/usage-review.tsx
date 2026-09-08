"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminPaidUsageReview, PaidUsageReviewTicket, PaidUsageResolution } from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { useUiLocale } from "../../components/ui-locale";

export function UsageReview() {
  const { locale } = useUiLocale(), en = locale === "en";
  const [rows, setRows] = useState<readonly AdminPaidUsageReview[]>(), [error, setError] = useState(false), [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const result = await adminApi<readonly AdminPaidUsageReview[]>("/api/usage-reviews");
    setLoading(false); setError(!result.ok); if (result.ok) setRows(result.data);
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [load]);
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "RUB" }).format(minor / 100);
  return <div className="content admin-usage-review"><section className="page-heading"><div><p className="eyebrow">{en ? "Finance" : "Финансы"}</p><h1>{en ? "Uncertain provider charges" : "Расходы на проверке"}</h1><p>{en ? "Reconcile an uncertain submission before charging the customer or releasing their reservation." : "Проверьте неопределённую отправку перед списанием или освобождением резерва клиента."}</p></div><button className="ghost" disabled={loading} type="button" onClick={() => void load()}>{loading ? en ? "Refreshing…" : "Обновляем…" : en ? "Refresh" : "Обновить"}</button></section>
    {error && <p role="alert" className="error">{en ? "Could not load reviews. Refresh to try again." : "Не удалось загрузить проверки. Обновите страницу для повтора."}</p>}
    {!rows ? <section className="panel"><p>{en ? "Loading reviews…" : "Загружаем проверки…"}</p></section> : rows.length === 0 ? <section className="panel"><h2>{en ? "No charges awaiting review" : "Спорных списаний нет"}</h2><p>{en ? "Uncertain submissions will appear here. They are never retried automatically." : "Неопределённые отправки появятся здесь. Автоматически они не повторяются."}</p></section> : rows.map(row => <section className="panel admin-usage-operation" key={row.quoteId}><header><div><h2>{row.workspaceName}</h2><p>{row.provider} · {row.kind.replaceAll("_", " ")} · {new Date(row.createdAt).toLocaleString(locale)}</p><small>{en ? "Operation" : "Операция"}: {row.jobId}</small></div><div className="admin-usage-totals"><span>{en ? "Reserved" : "В резерве"}<strong>{money(row.reservedMinor)}</strong></span><span>{en ? "Already charged" : "Уже списано"}<strong>{money(row.capturedMinor)}</strong></span></div></header>
      <p className="notice">{en ? "A review settles money only. It does not fabricate a missing result or repeat the provider request. Release the reservation if the charge cannot be substantiated." : "Решение касается только денег: оно не создаёт отсутствующий результат и не повторяет запрос провайдеру. Если расход не подтверждается, освободите резерв."}</p>
      {row.tickets.length >= 100 && <p>{en ? "Showing the first 100 tickets. Remaining tickets appear as these are resolved." : "Показаны первые 100 отправок. Остальные появятся по мере разбора."}</p>}
      {row.tickets.map(ticket => <TicketReview key={ticket.id} ticket={ticket} quoteId={row.quoteId} terminal={row.terminal} onResolved={load} provider={row.provider} rank={row.kind === "RANK"} />)}
    </section>)}
  </div>;
}
function TicketReview({ ticket, quoteId, terminal, provider, rank, onResolved }: { ticket: PaidUsageReviewTicket; quoteId: string; terminal: boolean; provider: string; rank: boolean; onResolved: () => Promise<void> }) {
  const { locale } = useUiLocale(), en = locale === "en";
  const [resolution, setResolution] = useState<PaidUsageResolution>("RELEASE"), [reason, setReason] = useState(""), [reference, setReference] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const command = useRef<{ signature: string; key: string } | undefined>(undefined);
  const ready = terminal && Date.parse(ticket.eligibleAt) <= Date.now();
  async function resolve() {
    if (!ready || busy || !confirmed) return;
    const body = { resolution, reason: reason.trim(), ...(reference.trim() ? { providerReference: reference.trim() } : {}), confirmed: true };
    const signature = JSON.stringify(body); if (command.current?.signature !== signature) command.current = { signature, key: `usage-review:${crypto.randomUUID()}` };
    setBusy(true); setError(false);
    const result = await adminApi(rank ? `/api/usage-reviews/rank/${quoteId}/resolve` : `/api/usage-reviews/${quoteId}/tickets/${ticket.id}/resolve`, { method: "POST", headers: { "Idempotency-Key": command.current.key }, body: signature });
    setBusy(false); setError(!result.ok); if (result.ok) await onResolved();
  }
  return <div className="admin-usage-ticket"><div><strong>{ticket.part}</strong><span>{new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(Number(ticket.unitsMilli) / 1000)} {rank ? en ? "submission" : "отправка" : provider === "XMLSTOCK" ? en ? "requests" : "запросов" : en ? "provider credits" : "лимитов провайдера"}</span><small>{ticket.id}</small></div>
    {ticket.resolution ? <p>{ticket.resolution === "CHARGE" ? en ? "Charge confirmed" : "Расход подтверждён" : en ? "Reservation released" : "Резерв освобождён"} · {ticket.resolutionReason}</p> : <div className="admin-usage-form">
      {!ready && <p role="status">{!terminal ? en ? "Wait for execution to end." : "Дождитесь окончания операции." : `${en ? "Review available after" : "Решение доступно после"} ${new Date(ticket.eligibleAt).toLocaleString(locale)}`}</p>}
      <fieldset disabled={!ready || busy}><legend>{en ? "Decision" : "Решение"}</legend><label><input type="radio" checked={resolution === "RELEASE"} onChange={() => { setResolution("RELEASE"); setConfirmed(false); }} />{en ? "Release the customer's reservation" : "Освободить резерв клиента"}</label><label><input type="radio" checked={resolution === "CHARGE"} onChange={() => { setResolution("CHARGE"); setConfirmed(false); }} />{en ? "Charge: provider acceptance is confirmed" : "Списать: принятие запроса подтверждено провайдером"}</label></fieldset>
      <label>{en ? "Reason and verification details" : "Причина и результат проверки"}<textarea rows={2} maxLength={500} disabled={busy || !ready} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {resolution === "CHARGE" && <label>{en ? "Provider operation reference (no URL or API key)" : "Номер операции провайдера (без URL и API-ключа)"}<input maxLength={128} value={reference} disabled={busy || !ready} onChange={event => setReference(event.target.value)} /></label>}
      <label className="admin-usage-confirm"><input type="checkbox" checked={confirmed} disabled={busy || !ready} onChange={event => setConfirmed(event.target.checked)} />{en ? "I verified this submission and confirm the final financial decision." : "Я проверил эту отправку и подтверждаю окончательное решение по деньгам."}</label>
      {error && <p role="alert" className="error">{en ? "Could not confirm the decision. Refresh the list before changing it." : "Не удалось подтвердить решение. Обновите список перед изменением выбора."}</p>}
      <button type="button" className="primary" disabled={!ready || busy || !confirmed || reason.trim().length < 5 || resolution === "CHARGE" && !/^[A-Za-z0-9][A-Za-z0-9._:-]{4,127}$/u.test(reference.trim())} onClick={() => void resolve()}>{busy ? en ? "Saving…" : "Сохраняем…" : en ? "Confirm decision" : "Подтвердить решение"}</button>
    </div>}
  </div>;
}
