"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminProviderAccount } from "@seo-platform/contracts";
import { UiText, useUiLocale } from "../../components/ui-locale";
import { adminApi } from "../../lib/admin-browser-api";

const money = (minor: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "RUB"
  }).format(minor / 100);

export function ProviderAdministration() {
  const uiLocale = useUiLocale().locale;
  const [accounts, setAccounts] = useState<readonly AdminProviderAccount[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    const result = await adminApi<readonly AdminProviderAccount[]>(
      "/api/provider-accounts"
    );
    if (result.ok) {
      setAccounts(result.data);
      setError(undefined);
    } else {
      setError(result.message);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function refresh(): Promise<void> {
    if (busy) return;
    setBusy("refresh");
    setError(undefined);
    const result = await adminApi<{ readonly requested: number }>(
      "/api/provider-accounts/refresh",
      { method: "POST", body: "{}" }
    );
    if (!result.ok) {
      setError(result.message);
      setBusy(undefined);
      return;
    }
    setAccounts(current => current?.map(account =>
      account.enabled ? { ...account, checking: true } : account
    ));
    window.setTimeout(() => void load(), 1_500);
    window.setTimeout(() => {
      void load().finally(() => setBusy(undefined));
    }, 6_000);
  }

  async function toggle(account: AdminProviderAccount): Promise<void> {
    if (busy) return;
    setBusy(account.id);
    setError(undefined);
    const result = await adminApi<AdminProviderAccount>(
      `/api/provider-accounts/${encodeURIComponent(account.id)}/enabled`,
      {
        method: "POST",
        body: JSON.stringify({ enabled: !account.enabled })
      }
    );
    if (result.ok) {
      setAccounts(current => current?.map(item =>
        item.id === result.data.id ? result.data : item
      ));
      if (result.data.enabled) {
        window.setTimeout(() => void load(), 1_500);
        window.setTimeout(() => void load(), 6_000);
      }
    } else {
      setError(result.message);
    }
    setBusy(undefined);
  }

  return (
    <div className="content">
      <section className="page-heading">
        <div>
          <p className="eyebrow"><UiText text="Данные и расходы" /></p>
          <h1><UiText text="Аккаунты SEO-сервисов" /></h1>
          <p><UiText text="Аккаунты из переменных окружения проверяются независимо от проектов. Отключённый аккаунт не участвует в новых операциях и фоновой проверке." /></p>
        </div>
        <button className="ghost" disabled={Boolean(busy)} type="button" onClick={() => void refresh()}>
          {busy === "refresh" ? <UiText text="Проверяем…" /> : <UiText text="Проверить сейчас" />}
        </button>
      </section>
      {error && <p className="error" role="alert"><UiText text={error} /></p>}
      {!accounts ? (
        <section className="panel"><UiText text="Загружаем состояние провайдеров…" /></section>
      ) : accounts.length === 0 ? (
        <section className="panel">
          <h2><UiText text="Системные аккаунты ещё не настроены" /></h2>
          <p><UiText text="Подключите XMLStock и Arsenkin в конфигурации сервера. Пользовательские API-ключи управляются в рабочих областях." /></p>
        </section>
      ) : (
        <div className="admin-provider-grid">
          {accounts.map(account => (
            <ProviderAccountCard
              account={account}
              busy={Boolean(busy)}
              key={account.id}
              locale={uiLocale}
              onToggle={() => void toggle(account)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderAccountCard({
  account,
  busy,
  locale,
  onToggle
}: Readonly<{
  account: AdminProviderAccount;
  busy: boolean;
  locale: string;
  onToggle: () => void;
}>) {
  const status = providerStatus(account);
  return (
    <article className={`panel admin-provider-card${account.enabled && account.lowBalance ? " is-low" : ""}${account.enabled ? "" : " is-disabled"}`}>
      <header>
        <div>
          <h2>{account.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin"} #{account.slot}</h2>
          <span className={`admin-provider-status ${status.tone}`}><UiText text={status.label} /></span>
        </div>
        <label className="admin-provider-switch">
          <input
            checked={account.enabled}
            disabled={busy}
            onChange={onToggle}
            type="checkbox"
          />
          <span aria-hidden="true" />
          <b><UiText text={account.enabled ? "Включён" : "Выключен"} /></b>
        </label>
      </header>
      <div className="admin-provider-amount">
        {account.estimatedBalanceMinor === null
          ? "—"
          : money(account.estimatedBalanceMinor, locale)}
      </div>
      {account.provider === "ARSENKIN" && account.remaining !== null && (
        <p><UiText text="{0} лимитов · денежная оценка по стоимости Standard" values={[new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(account.remaining))]} /></p>
      )}
      <p>{providerExplanation(account)}</p>
      <small>
        {account.checkedAt
          ? <><UiText text="Последняя проверка:" after=" " />{new Date(account.checkedAt).toLocaleString(locale)}</>
          : <UiText text="Проверка ещё не выполнялась" />}
      </small>
      <a className="ghost" href={account.provider === "XMLSTOCK" ? "https://xmlstock.com/" : "https://arsenkin.ru/tools/tariffs/all/"} target="_blank" rel="noopener noreferrer">
        <UiText text="Открыть кабинет провайдера ↗" />
      </a>
    </article>
  );
}

function providerStatus(account: AdminProviderAccount): {
  readonly label: string;
  readonly tone: "success" | "warning" | "danger" | "muted";
} {
  if (!account.enabled) return { label: "Отключён вручную", tone: "muted" };
  if (account.checking) return { label: "Проверяется", tone: "warning" };
  if (account.errorCode === "INVALID_CREDENTIAL") return { label: "Ключ отклонён", tone: "danger" };
  if (account.errorCode) return { label: "Ошибка проверки", tone: "danger" };
  if (!account.checkedAt) return { label: "Ожидает первой проверки", tone: "warning" };
  if (account.stale) return { label: "Данные устарели", tone: "warning" };
  if (account.lowBalance) return { label: "Низкий остаток", tone: "warning" };
  return { label: "Работает", tone: "success" };
}

function providerExplanation(account: AdminProviderAccount): string {
  if (!account.enabled) return "Аккаунт исключён из новых операций и фоновой проверки.";
  if (account.checking) return "Получаем актуальный остаток напрямую у провайдера.";
  if (account.errorCode === "INVALID_CREDENTIAL") return "Провайдер отклонил API-ключ или идентификатор аккаунта.";
  if (account.errorCode === "PROVIDER_RATE_LIMITED") return "Провайдер временно ограничил запросы. Следующая проверка выполнится позже.";
  if (account.errorCode === "PROVIDER_PLAN_OR_REQUEST_REJECTED") return "Тариф или доступ к API не разрешает проверку аккаунта.";
  if (account.errorCode) return "Провайдер не ответил корректно. Можно запустить проверку вручную.";
  if (!account.checkedAt) return "Первая фоновая проверка запустится автоматически после старта сервиса.";
  if (account.provider === "XMLSTOCK" && account.remaining === "0") return "На аккаунте XMLStock нет средств для новых платных запросов.";
  if (account.provider === "ARSENKIN" && account.remaining === "0") return "На аккаунте Arsenkin закончились лимиты.";
  return "Аккаунт доступен для новых операций.";
}
