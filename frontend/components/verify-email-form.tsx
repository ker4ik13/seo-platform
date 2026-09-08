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
    setToken(developmentToken || "");
    if (fragment.token && !automaticVerificationStarted.current) {
      automaticVerificationStarted.current = true;
      void confirmToken(fragment.token);
    }
  }, [confirmToken]);

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
      setMessage("Новая ссылка отправлена. Проверьте почту.");
    } catch {
      setError("Не удалось отправить ссылку. Попробуйте позже.");
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
        disabled={!email || resending}
        onClick={resend}
        type="button"
      >
        {resending ? <UiText text="Отправляем…" /> : <UiText text="Отправить ссылку повторно" />}
      </button>
      <p className="auth-switch">
        <a href="/app/login"><UiText text="Вернуться ко входу" /></a>
      </p>
    </form>
  );
}
