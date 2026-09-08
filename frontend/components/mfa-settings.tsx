"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { UiText } from "./ui-locale";


interface MfaOverview {
  readonly totp?: {
    readonly id: string;
    readonly status: "ACTIVE";
    readonly confirmedAt: string;
    readonly lastUsedAt?: string;
  };
  readonly remainingRecoveryCodes: number;
}

interface TotpSetup {
  readonly methodId: string;
  readonly secret: string;
  readonly otpauthUri: string;
}

interface ConfirmTotpResult {
  readonly enabled: true;
  readonly recoveryCodes: readonly string[];
}

export function MfaSettings() {
  const [overview, setOverview] = useState<MfaOverview>();
  const [setup, setSetup] = useState<TotpSetup>();
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>();
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setOverview(
        await browserApiRequest<MfaOverview>("/app/api/auth/mfa")
      );
    } catch {
      setError("Не удалось загрузить настройки двухфакторной защиты.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startSetup(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      setSetup(
        await browserApiRequest<TotpSetup>("/app/api/auth/mfa/totp/setup", {
          method: "POST"
        })
      );
    } catch (requestError) {
      setError(settingsError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!setup || busy) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await browserApiRequest<ConfirmTotpResult>(
        "/app/api/auth/mfa/totp/confirm",
        {
          method: "POST",
          body: {
            methodId: setup.methodId,
            code: String(form.get("code") ?? "").trim()
          }
        }
      );
      setRecoveryCodes(result.recoveryCodes);
      setSetup(undefined);
      await load();
    } catch (requestError) {
      setError(settingsError(requestError, "Проверьте шестизначный код."));
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await browserApiRequest("/app/api/auth/mfa/totp", {
        method: "DELETE",
        body: {
          password: String(form.get("password") ?? ""),
          code: String(form.get("code") ?? "").trim()
        }
      });
      setDisabling(false);
      await load();
    } catch (requestError) {
      setError(
        settingsError(
          requestError,
          "Проверьте текущий пароль и код подтверждения."
        )
      );
    } finally {
      setBusy(false);
    }
  }

  if (!overview && !error) {
    return (
      <section className="panel security-card" aria-busy="true">
        <span className="spinner" />
        <p><UiText text="Загружаем настройки безопасности…" /></p>
      </section>
    );
  }

  return (
    <section className="panel security-card">
      <header className="security-card-header">
        <div>
          <h2><UiText text="Приложение-аутентификатор" /></h2>
          <p>
            <UiText text="TOTP-код защищает вход, даже если пароль оказался скомпрометирован." /></p>
        </div>
        <span className={overview?.totp ? "security-status on" : "security-status"}>
          {overview?.totp ? <UiText text="Включено" /> : <UiText text="Выключено" />}
        </span>
      </header>

      {error && (
        <div className="inline-alert danger" role="alert">
          {<UiText text={error ?? ""} />}
        </div>
      )}

      {recoveryCodes ? (
        <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(undefined)} />
      ) : setup ? (
        <form className="security-flow" onSubmit={confirm}>
          <div className="inline-alert warning">
            <UiText text="Не закрывайте страницу до сохранения резервных кодов на следующем шаге." /></div>
          <div>
            <strong><UiText text="1. Добавьте аккаунт в аутентификатор" /></strong>
            <p>
              <UiText text="Откройте ссылку на устройстве с приложением или введите ключ вручную. QR-код появится после подключения согласованного локального генератора." /></p>
          </div>
          <a className="secondary-button setup-link" href={setup.otpauthUri}>
            <UiText text="Открыть в аутентификаторе" /></a>
          <code className="secret-value">{setup.secret}</code>
          <label className="form-field">
            <span><UiText text="2. Введите код из приложения" /></span>
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              name="code"
              pattern="[0-9]{6}"
              placeholder="000000"
              required
            />
          </label>
          <div className="security-actions">
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? <UiText text="Проверяем…" /> : <UiText text="Подтвердить и включить" />}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setSetup(undefined)}
              type="button"
            >
              <UiText text="Отмена" /></button>
          </div>
        </form>
      ) : overview?.totp ? (
        <div className="security-flow">
          <div className="security-facts">
            <span>
              <UiText text="Подключено" />{" "}
              <strong>{formatDate(overview.totp.confirmedAt)}</strong>
            </span>
            <span>
              <UiText text="Резервных кодов осталось" />{" "}
              <strong>{overview.remainingRecoveryCodes}</strong>
            </span>
          </div>
          {disabling ? (
            <form className="security-flow" onSubmit={disable}>
              <div className="inline-alert warning">
                <UiText text="Отключение 2FA завершит все другие сессии аккаунта." /></div>
              <label className="form-field">
                <span><UiText text="Текущий пароль" /></span>
                <input
                  autoComplete="current-password"
                  name="password"
                  required
                  type="password"
                />
              </label>
              <label className="form-field">
                <span><UiText text="Код TOTP или резервный код" /></span>
                <input
                  autoComplete="one-time-code"
                  name="code"
                  required
                />
              </label>
              <div className="security-actions">
                <button className="danger-button" disabled={busy} type="submit">
                  {busy ? <UiText text="Отключаем…" /> : <UiText text="Отключить 2FA" />}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setDisabling(false)}
                  type="button"
                >
                  <UiText text="Отмена" /></button>
              </div>
            </form>
          ) : (
            <button
              className="secondary-button"
              onClick={() => setDisabling(true)}
              type="button"
            >
              <UiText text="Отключить" /></button>
          )}
        </div>
      ) : (
        <div className="security-flow">
          <p>
            <UiText text="При каждом новом входе после пароля потребуется одноразовый код. Будут созданы десять резервных кодов для аварийного доступа." /></p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={startSetup}
            type="button"
          >
            {busy ? <UiText text="Подготавливаем…" /> : <UiText text="Настроить 2FA" />}
          </button>
        </div>
      )}
    </section>
  );
}

function RecoveryCodes({
  codes,
  onDone
}: Readonly<{
  codes: readonly string[];
  onDone: () => void;
}>) {
  const text = codes.join("\n");
  return (
    <div className="security-flow">
      <div className="inline-alert success" role="status">
        <UiText text="Двухфакторная защита включена. Каждый резервный код работает один раз." /></div>
      <div>
        <strong><UiText text="Сохраните резервные коды сейчас" /></strong>
        <p><UiText text="После ухода с этой страницы они больше не будут показаны." /></p>
      </div>
      <div className="recovery-code-grid">
        {codes.map((code) => (
          <code key={code}>{code}</code>
        ))}
      </div>
      <div className="security-actions">
        <button
          className="secondary-button"
          onClick={() => void navigator.clipboard.writeText(text)}
          type="button"
        >
          <UiText text="Скопировать" /></button>
        <button
          className="secondary-button"
          onClick={() => downloadCodes(text)}
          type="button"
        >
          <UiText text="Скачать" /></button>
        <button className="primary-button" onClick={onDone} type="button">
          <UiText text="Я сохранил коды" /></button>
      </div>
    </div>
  );
}

function settingsError(error: unknown, fallback?: string): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "REAUTHENTICATION_REQUIRED") {
      return "Для этой операции нужен недавний вход. Выйдите и войдите снова.";
    }
    if (error.code === "UNAUTHENTICATED") {
      return fallback ?? "Код подтверждения неверен или уже использован.";
    }
  }
  return fallback ?? "Не удалось изменить настройки. Повторите попытку.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function downloadCodes(value: string): void {
  const url = URL.createObjectURL(
    new Blob([value, "\n"], { type: "text/plain;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "seo-workspace-recovery-codes.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}
