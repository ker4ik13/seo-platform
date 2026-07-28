"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";

interface VerificationResult {
  readonly emailVerificationRequired: boolean;
}

interface AcceptedOperation {
  readonly accepted: true;
  readonly verificationTokenForDevelopment?: string;
}

export function VerifyEmailForm({
  initialEmail
}: Readonly<{ initialEmail: string | undefined }>) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setEmail(
      (value) =>
        value || sessionStorage.getItem("pending-verification-email") || ""
    );
    setToken(
      sessionStorage.getItem("development-verification-token") ?? ""
    );
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<VerificationResult>(
        "/app/api/auth/email-verification/verify",
        {
          method: "POST",
          body: { token: token.trim() }
        }
      );
      if (!result.emailVerificationRequired) {
        sessionStorage.removeItem("development-verification-token");
        sessionStorage.removeItem("pending-verification-email");
        window.location.assign("/app");
      }
    } catch (requestError) {
      setBusy(false);
      setError(
        requestError instanceof BrowserApiError &&
          requestError.code === "RESOURCE_STATE_CONFLICT"
          ? "Ссылка недействительна или уже использована."
          : "Не удалось подтвердить email. Проверьте ссылку и повторите."
      );
    }
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
          {message}
        </div>
      )}
      {error && (
        <div className="inline-alert danger" role="alert">
          {error}
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
        <span>Токен из ссылки</span>
        <input
          autoComplete="one-time-code"
          onChange={(event) => setToken(event.target.value)}
          placeholder="Вставьте токен подтверждения"
          required
          value={token}
        />
        <small>
          В production токен открывается из письма; в локальной среде он
          подставляется автоматически.
        </small>
      </label>
      <button className="primary-button auth-submit" disabled={busy} type="submit">
        {busy ? "Подтверждаем…" : "Подтвердить email"}
      </button>
      <button
        className="secondary-button auth-submit"
        disabled={!email || resending}
        onClick={resend}
        type="button"
      >
        {resending ? "Отправляем…" : "Отправить ссылку повторно"}
      </button>
      <p className="auth-switch">
        <a href="/app/login">Вернуться ко входу</a>
      </p>
    </form>
  );
}
