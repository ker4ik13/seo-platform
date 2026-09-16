"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { safeAppReturnTo } from "../lib/app-path";
import {
  fragmentFreeBrowserPath,
  readOneTimeTokenFragment
} from "../lib/one-time-link";
import { UiText, useUiLocale } from "./ui-locale";


interface VerificationResult {
  readonly emailVerificationRequired: boolean;
}

interface AcceptedOperation {
  readonly accepted: true;
  readonly verificationTokenForDevelopment?: string;
}

const VERIFICATION_RESEND_COOLDOWN_MS = 60_000;

export function VerifyEmailForm({
  initialEmail,
  initialReturnTo
}: Readonly<{
  initialEmail: string | undefined;
  initialReturnTo: string;
}>) {
  const { t: uiText } = useUiLocale();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const automaticVerificationStarted = useRef(false);
  const verificationInFlight = useRef(false);

  const confirmToken = useCallback(
    async (tokenValue: string): Promise<void> => {
      if (verificationInFlight.current || !tokenValue) return;
      verificationInFlight.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const result = await browserApiRequest<VerificationResult>(
          "/app/api/auth/email-verification/verify",
          {
            method: "POST",
            body: { token: tokenValue }
          }
        );
        if (!result.emailVerificationRequired) {
          sessionStorage.removeItem("development-verification-token");
          sessionStorage.removeItem("pending-verification-email");
          sessionStorage.removeItem("pending-verification-sent-at");
          const pendingInvite = sessionStorage.getItem(
            "pending-workspace-invite-token"
          );
          const storedReturnTo = sessionStorage.getItem(
            "pending-verification-return-to"
          );
          sessionStorage.removeItem("pending-verification-return-to");
          window.location.assign(
            pendingInvite
              ? "/app/workspace-invites/accept"
              : safeAppReturnTo(storedReturnTo, initialReturnTo)
          );
          return;
        }
        setError("Подтверждение не завершено. Запросите новую ссылку.");
      } catch (requestError) {
        setError(
          requestError instanceof BrowserApiError &&
            requestError.code === "RESOURCE_STATE_CONFLICT"
            ? "Ссылка недействительна или уже использована."
            : "Не удалось подтвердить email. Проверьте ссылку и повторите."
        );
      } finally {
        verificationInFlight.current = false;
        setBusy(false);
      }
    },
    [initialReturnTo]
  );

  useEffect(() => {
    setEmail(
      (value) =>
        value || sessionStorage.getItem("pending-verification-email") || ""
    );
    const fragment = readOneTimeTokenFragment(window.location.hash, 256);
    if (fragment.shouldScrub) {
      window.history.replaceState(
        null,
        "",
        fragmentFreeBrowserPath(window.location)
      );
    }
    const developmentToken = sessionStorage.getItem(
      "development-verification-token"
    );
    const sentAt = Number(
      sessionStorage.getItem("pending-verification-sent-at") ?? "0"
    );
    if (Number.isFinite(sentAt) && sentAt > 0) {
      setResendAvailableAt(sentAt + VERIFICATION_RESEND_COOLDOWN_MS);
    }
    setToken(developmentToken || "");
    if (fragment.token && !automaticVerificationStarted.current) {
      automaticVerificationStarted.current = true;
      void confirmToken(fragment.token);
    }
  }, [confirmToken]);

  useEffect(() => {
    if (resendAvailableAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= resendAvailableAt) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [resendAvailableAt]);

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await confirmToken(token.trim());
  }

  async function resend(): Promise<void> {
    if (!email || resending) return;
    setResending(true);
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await browserApiRequest<AcceptedOperation>(
        "/app/api/auth/email-verification/resend",
        {
          method: "POST",
          body: { email }
        }
      );
      if (result.verificationTokenForDevelopment) {
        setToken(result.verificationTokenForDevelopment);
        sessionStorage.setItem(
          "development-verification-token",
          result.verificationTokenForDevelopment
        );
      }
      const sentAt = Date.now();
      sessionStorage.setItem("pending-verification-sent-at", String(sentAt));
      setNow(sentAt);
      setResendAvailableAt(sentAt + VERIFICATION_RESEND_COOLDOWN_MS);
      setMessage(
        "Запрос принят. Доставка может занять несколько минут. Проверьте папку «Спам» и используйте самую новую ссылку."
      );
    } catch (requestError) {
      setError(
        requestError instanceof BrowserApiError &&
          requestError.code === "RATE_LIMITED"
          ? "Слишком много запросов. Подождите несколько минут и повторите."
          : "Не удалось отправить ссылку. Попробуйте позже."
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={verify}>
      {message && (
        <div className="inline-alert success" role="status">
          {<UiText text={message ?? ""} />}
        </div>
      )}
      {error && (
        <div className="inline-alert danger" role="alert">
          {<UiText text={error ?? ""} />}
        </div>
      )}
      <label className="form-field">
        <span>Email</span>
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label className="form-field">
        <span><UiText text="Токен из ссылки" /></span>
        <input
          autoComplete="one-time-code"
          onChange={(event) => setToken(event.target.value)}
          placeholder={uiText("Вставьте токен подтверждения")}
          required
          value={token}
        />
        <small>
          <UiText text="В production токен открывается из письма; в локальной среде он подставляется автоматически." /></small>
      </label>
      <button className="primary-button auth-submit" disabled={busy} type="submit">
        {busy ? <UiText text="Подтверждаем…" /> : <UiText text="Подтвердить email" />}
      </button>
      <button
        className="secondary-button auth-submit"
        disabled={!email || resending || resendAvailableAt > now}
        onClick={resend}
        type="button"
      >
        {resending
          ? <UiText text="Отправляем…" />
          : resendAvailableAt > now
            ? <UiText text="Повторить через {0} с" values={[String(Math.ceil((resendAvailableAt - now) / 1_000))]} />
            : <UiText text="Отправить ссылку повторно" />}
      </button>
      <small className="auth-delivery-note">
        <UiText text="Письмо отправляется через очередь и может задержаться у почтового провайдера. Не запрашивайте несколько ссылок подряд." /></small>
      <p className="auth-switch">
        <a href="/app/login"><UiText text="Вернуться ко входу" /></a>
      </p>
    </form>
  );
}
