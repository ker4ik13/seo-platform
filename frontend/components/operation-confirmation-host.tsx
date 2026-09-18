"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { OperationEstimate } from "@seo-platform/contracts";
import { registerOperationConfirmation, type OperationConfirmationRequest } from "../lib/operation-confirmation";
import { operationConfirmationExpiryDelay } from "../lib/operation-confirmation-expiry";
import { SemanticModal } from "./semantic-modal";
import { ProviderLogo } from "./provider-logo";
import { useUiLocale, UiText } from "./ui-locale";


interface Pending extends OperationConfirmationRequest { resolve: (quote: OperationEstimate | null) => void }
export function OperationConfirmationHost({ workspaceId, locale = "ru" }: { workspaceId?: string | undefined; locale?: string }) {
  const { t: uiText } = useUiLocale();
  const [pending, setPending] = useState<Pending>();
  const current = useRef<Pending | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [expired, setExpired] = useState(false);
  const en = locale === "en";
  useEffect(() => {
    setPending(undefined);
    const unregister = registerOperationConfirmation(request => new Promise(resolve => {
      if (!workspaceId || request.quote.workspaceId !== workspaceId || current.current || request.signal?.aborted) { resolve(null); return; }
      const cancel = () => { if (current.current?.resolve === entry.resolve) { current.current = undefined; setPending(undefined); } entry.resolve(null); };
      const entry: Pending = { ...request, resolve: quote => { request.signal?.removeEventListener("abort", cancel); resolve(quote); } };
      current.current = entry; setPending(entry); setRefreshing(false); setError(undefined); setExpired(Date.parse(request.quote.expiresAt) <= Date.now());
      request.signal?.addEventListener("abort", cancel, { once: true });
    }));
    return () => { unregister(); current.current?.resolve(null); current.current = undefined; };
  }, [workspaceId]);
  useEffect(() => {
    if (!pending) return;
    const remainingMs = operationConfirmationExpiryDelay(
      pending.quote.expiresAt
    );
    if (remainingMs <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    const timer = window.setTimeout(
      () => setExpired(true),
      remainingMs
    );
    return () => window.clearTimeout(timer);
  }, [pending]);
  if (!pending || pending.quote.workspaceId !== workspaceId) return null;
  const quote = pending.quote;
  const money = (minor: number) => new Intl.NumberFormat(en ? "en-US" : "ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(minor / 100);
  function finish(value: OperationEstimate | null) { const entry = current.current; current.current = undefined; setPending(undefined); entry?.resolve(value); }
  async function refresh() {
    const entry = current.current; if (!entry || refreshing) return;
    setRefreshing(true); setError(undefined);
    try {
      const fresh = await entry.refresh();
      if (current.current !== entry) return;
      if (fresh.workspaceId !== entry.quote.workspaceId || fresh.projectId !== entry.quote.projectId || fresh.kind !== entry.quote.kind || fresh.credentialMode !== "PLATFORM_PAID") throw new Error();
      const updated = { ...entry, quote: fresh }; current.current = updated; setPending(updated);
    } catch { if (current.current === entry) setError(en ? "Could not update the estimate. Please try again." : "Не удалось обновить расчёт. Попробуйте ещё раз."); }
    finally { if (current.current?.resolve === entry.resolve) setRefreshing(false); }
  }
  return <SemanticModal size="small" title={en ? "Confirm operation cost" : uiText("Подтвердите стоимость")} closeLabel={en ? "Close" : "Закрыть окно"} onClose={() => finish(null)} description={en ? "The operation will use the platform API account." : uiText("Операция будет выполнена через API-аккаунт платформы.")} footer={<div className="operation-charge-actions"><button className="secondary-button" type="button" onClick={() => finish(null)}>{en ? "Cancel" : <UiText text="Отмена" />}</button><button className="primary-button" type="button" disabled={!quote.affordable || expired || refreshing} onClick={() => finish(quote)}>{en ? `Run for up to ${money(quote.maximumChargeMinor)}` : <UiText text="Запустить до {0}" values={[String(money(quote.maximumChargeMinor))]} />}</button></div>}>
    <div className="operation-charge-card"><span>{en ? "Maximum cost" : <UiText text="Не больше" />}</span><strong>{money(quote.maximumChargeMinor)}</strong><div><ProviderLogo provider={quote.provider} size="compact" /><span>{quote.provider === "ARSENKIN" ? "Arsenkin" : "XMLStock"} · {quote.quantity.toLocaleString(en ? "en-US" : "ru-RU")} {en ? "keywords" : <UiText text="запросов" />}</span></div></div>
    <p className="operation-charge-explanation">{en ? "This amount will be reserved from your data balance. We charge for requests accepted by the provider and release the unused remainder. Cancelling an operation does not undo requests already sent." : <UiText text="Зарезервируем эту сумму на балансе данных. Спишем стоимость принятых провайдером запросов, остаток вернём на баланс. Отмена операции не отменяет уже отправленные запросы." />}</p>
    {!quote.affordable && <div className="inline-error">{en ? "Insufficient data balance." : <UiText text="Недостаточно средств на балансе данных." />} <Link href="/app/settings/billing" target="_blank" rel="noopener">{en ? "Top up in a new tab" : <UiText text="Пополнить в новой вкладке" />}</Link></div>}
    {expired && <p className="inline-error">{en ? "The estimate expired. Update it before starting." : <UiText text="Срок расчёта истёк. Обновите его перед запуском." />}</p>}
    {error && <p role="alert" className="inline-error">{<UiText text={error ?? ""} />}</p>}
    <button className="secondary-button" type="button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? (en ? "Updating…" : "Обновляем…") : (en ? "Refresh estimate and balance" : "Обновить расчёт и баланс")}</button>
  </SemanticModal>;
}
