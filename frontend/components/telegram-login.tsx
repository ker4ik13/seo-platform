"use client";
import { useEffect, useRef, useState } from "react";
import type { LoginResult, TelegramAccountConnection, TelegramLoginConfiguration, TelegramLoginStart, TelegramLoginStatus } from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { safeAppReturnTo } from "../lib/app-path";
import { SemanticModal } from "./semantic-modal";
import { ConfirmationActions } from "./confirmation-actions";
import { UiText, useUiLocale } from "./ui-locale";


export function TelegramLogin({ mode = "LOGIN", locale = "ru", returnTo = "/app" }: Readonly<{ mode?: "LOGIN" | "LINK"; locale?: string; returnTo?: string }>) {
  const { t: uiText } = useUiLocale();
  const [available, setAvailable] = useState(false);
  const [connection, setConnection] = useState<TelegramAccountConnection>();
  const [challenge, setChallenge] = useState<TelegramLoginStart>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);
  const finishing = useRef(false);
  const en = locale.startsWith("en");
  useEffect(() => {
    const controller = new AbortController();
    if (mode === "LOGIN") {
      void browserApiRequest<TelegramLoginConfiguration>("/app/api/auth/telegram/config", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setAvailable(value.available); }).catch(() => {});
    } else {
      void browserApiRequest<TelegramAccountConnection>("/app/api/me/telegram", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setConnection(value); setAvailable(value.available); } }).catch(() => {});
    }
    return () => controller.abort();
  }, [mode]);
  useEffect(() => {
    if (!challenge) return;
    const controller = new AbortController();
    let polling = false;
    const poll = async () => {
      if (polling || finishing.current || controller.signal.aborted) return;
      polling = true;
      try {
        const status = await browserApiRequest<TelegramLoginStatus>(`/app/api/auth/telegram/status/${challenge.id}`, { signal: controller.signal });
        if (status.status === "EXPIRED" || status.status === "DENIED") {
          setChallenge(undefined); setBusy(false);
          setError(en ? "Request expired or cancelled. Start again." : "Запрос истёк или отменён. Начните заново.");
        } else if (status.status === "APPROVED") {
          finishing.current = true;
          if (mode === "LINK") {
            await browserApiRequest(`/app/api/me/telegram/finish/${challenge.id}`, { method: "POST", signal: controller.signal });
            setConnection(await browserApiRequest<TelegramAccountConnection>("/app/api/me/telegram"));
            setChallenge(undefined); setBusy(false); setNotice(en ? "Telegram connected." : "Telegram подключён.");
          } else {
            const result = await browserApiRequest<LoginResult>(`/app/api/auth/telegram/finish/${challenge.id}`, { method: "POST", signal: controller.signal });
            if ("mfaRequired" in result && result.mfaRequired) {
              sessionStorage.setItem("mfa-challenge-token", result.challengeToken);
              sessionStorage.setItem("mfa-challenge-expires-at", result.expiresAt);
              window.location.assign(`/app/mfa?returnTo=${encodeURIComponent(safeAppReturnTo(returnTo))}`);
            } else window.location.assign(safeAppReturnTo(returnTo));
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted) { setError(message(cause, en)); setChallenge(undefined); setBusy(false); }
      } finally { polling = false; }
    };
    void poll(); const interval = window.setInterval(() => void poll(), 2000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [challenge, mode, en, returnTo]);
  async function start() {
    if (busy) return; setBusy(true); setError(undefined); setNotice(undefined); finishing.current = false;
    try { setChallenge(await browserApiRequest<TelegramLoginStart>(mode === "LOGIN" ? "/app/api/auth/telegram/start" : "/app/api/me/telegram/start", { method: "POST", body: { locale: en ? "en" : "ru" } })); }
    catch (cause) { setBusy(false); setError(message(cause, en)); }
  }
  async function unlink() {
    setBusy(true); setError(undefined);
    try { await browserApiRequest("/app/api/me/telegram", { method: "DELETE" }); setConnection({ available, connected: false }); setUnlinkConfirm(false); setNotice(en ? "Telegram disconnected. Other sessions were closed." : "Telegram отключён. Другие сессии завершены."); }
    catch (cause) { setError(message(cause, en)); }
    finally { setBusy(false); }
  }
  if (mode === "LOGIN" && !available) return null;
  const content = <>
    {mode === "LINK" && <header className="security-card-header"><div><h2>{en ? "Telegram sign-in" : <UiText text="Вход через Telegram" />}</h2><p>{en ? "Connect your Telegram account to sign in with a confirmation in the bot. Two-factor protection still applies." : <UiText text="Подключите свой Telegram для входа с подтверждением в боте. Двухфакторная защита сохраняется." />}</p></div><span className={`security-status${connection?.connected ? " on" : ""}`}>{connection?.connected ? en ? "Connected" : <UiText text="Подключён" /> : en ? "Not connected" : <UiText text="Не подключён" />}</span></header>}
    {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
    {notice && <div className="inline-alert success" role="status">{<UiText text={notice ?? ""} />}</div>}
    {challenge ? <div className="telegram-login-challenge" role="status">
      <span>{en ? "Compare this code with the bot's message:" : <UiText text="Сравните код с сообщением в боте:" />}</span><strong>{challenge.code}</strong>
      <a className="primary-button" href={challenge.botUrl} target="_blank" rel="noopener noreferrer">{en ? "Open Telegram" : <UiText text="Открыть Telegram" />}</a>
      <small>{en ? "Confirm only your own request. This page will continue automatically." : <UiText text="Подтверждайте только свой запрос. Эта страница продолжит вход автоматически." />}</small>
      <button className="text-button" type="button" onClick={() => { void browserApiRequest(`/app/api/auth/telegram/cancel/${challenge.id}`, { method: "POST" }).finally(() => { setChallenge(undefined); setBusy(false); }).catch(() => {}); }}>{en ? "Cancel" : <UiText text="Отменить" />}</button>
    </div> : connection?.connected ? <div className="security-actions"><span>{connection.username ? `@${connection.username}` : "Telegram"}</span><button className="secondary-button" type="button" disabled={busy} onClick={() => setUnlinkConfirm(true)}>{en ? "Disconnect" : <UiText text="Отключить" />}</button></div> : available ? <button className="secondary-button telegram-login-button" type="button" disabled={busy} onClick={() => void start()}>{busy ? en ? "Preparing…" : <UiText text="Подготавливаем…" /> : mode === "LOGIN" ? en ? "Sign in with Telegram" : <UiText text="Войти через Telegram" /> : en ? "Connect Telegram" : <UiText text="Подключить Telegram" />}</button> : <p className="telegram-login-disabled">{en ? "Telegram sign-in will become available when the bot is configured." : <UiText text="Вход станет доступен после подключения бота." />}</p>}
    {unlinkConfirm && <SemanticModal title={en ? "Disconnect Telegram?" : uiText("Отключить Telegram?")} description={en ? "Other sessions will be closed. This session stays active." : uiText("Другие сессии завершатся. Текущая останется активной.")} onClose={() => !busy && setUnlinkConfirm(false)} size="small"><ConfirmationActions><button autoFocus className="secondary-button" type="button" disabled={busy} onClick={() => setUnlinkConfirm(false)}>{en ? "Keep connected" : <UiText text="Оставить подключённым" />}</button><button className="danger-button" type="button" disabled={busy} onClick={() => void unlink()}>{en ? "Disconnect" : <UiText text="Отключить" />}</button></ConfirmationActions></SemanticModal>}
  </>;
  return mode === "LINK" ? <section className="panel security-card">{content}</section> : <div className="telegram-login">{content}</div>;
}
function message(error: unknown, en: boolean): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "TELEGRAM_ACCOUNT_NOT_LINKED") return en ? "Create an account with email, then connect Telegram in security settings." : error.message;
    if (error.code === "TELEGRAM_CHALLENGE_INVALID") return en ? "This request expired or was already used. Start again." : error.message;
    return error.message;
  }
  return en ? "Telegram sign-in is temporarily unavailable." : "Не удалось завершить действие. Повторите попытку.";
}
