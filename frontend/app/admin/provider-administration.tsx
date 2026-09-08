"use client";
import { useCallback, useEffect, useState } from "react";
import type { AdminProviderAccount } from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { UiText } from "../../components/ui-locale";
import { useUiLocale } from "../../components/ui-locale";


const money = (minor: number, uiLocale: string = "ru-RU") => new Intl.NumberFormat(uiLocale, { style: "currency", currency: "RUB" }).format(minor / 100);
export function ProviderAdministration() {
  const uiLocale = useUiLocale().locale;
  const [accounts, setAccounts] = useState<readonly AdminProviderAccount[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    const result = await adminApi<readonly AdminProviderAccount[]>("/api/provider-accounts");
    if (result.ok) { setAccounts(result.data); setError(undefined); } else setError(result.message);
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [load]);
  return <div className="content"><section className="page-heading"><div><p className="eyebrow"><UiText text="Данные и расходы" /></p><h1><UiText text="Аккаунты SEO-сервисов" /></h1><p><UiText text="Физические API-аккаунты проверяются в фоне. При остатке ниже 500 ₽ приходит сообщение в Telegram." /></p></div><button className="ghost" type="button" onClick={() => void load()}><UiText text="Обновить" /></button></section>
    {error && <p className="error" role="alert">{<UiText text={error ?? ""} />}</p>}
    {!accounts ? <section className="panel"><UiText text="Загружаем состояние провайдеров…" /></section> : accounts.length === 0 ? <section className="panel"><h2><UiText text="Системные аккаунты ещё не настроены" /></h2><p><UiText text="Подключите XMLStock и Arsenkin в конфигурации сервера. Пользовательские API-ключи управляются в рабочих областях." /></p></section> : <div className="admin-provider-grid">{accounts.map(account => <article className={`panel admin-provider-card${account.enabled && account.lowBalance ? " is-low" : ""}`} key={account.id}><header><h2>{account.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin"} #{account.slot}</h2><span className="muted">{!account.enabled ? <UiText text="Выключен" /> : account.stale || account.errorCode ? <UiText text="Нужна проверка" /> : account.lowBalance ? <UiText text="Низкий остаток" /> : <UiText text="В порядке" />}</span></header><div className="admin-provider-amount">{account.estimatedBalanceMinor === null ? "—" : money(account.estimatedBalanceMinor, uiLocale)}</div>{account.provider === "ARSENKIN" && <p>{account.remaining === null ? <UiText text="Лимиты пока неизвестны" /> : <UiText text="{0} лимитов · денежная оценка по стоимости Standard" values={[String(new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 2 }).format(Number(account.remaining)))]} />}</p>}
      <small><UiText text="Последняя проверка:" after=" " />{account.checkedAt ? new Date(account.checkedAt).toLocaleString(uiLocale) : <UiText text="ещё не завершена" />}</small>{account.errorCode && <p className="error">{account.errorCode === "INVALID_CREDENTIAL" ? <UiText text="Проверьте ключ аккаунта." /> : account.errorCode === "CREDENTIAL_UNAVAILABLE" ? <UiText text="Сначала подготовьте системное подключение в проекте." /> : <UiText text="Не удалось получить свежий баланс. Проверка повторится автоматически." />}</p>}<a className="ghost" href={account.provider === "XMLSTOCK" ? "https://xmlstock.com/" : "https://arsenkin.ru/tools/tariffs/all/"} target="_blank" rel="noopener noreferrer"><UiText text="Открыть кабинет провайдера ↗" /></a></article>)}</div>}
  </div>;
}
