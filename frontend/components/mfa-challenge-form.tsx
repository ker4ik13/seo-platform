"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { safeAppReturnTo } from "../lib/app-path";
import { UiText, useUiLocale } from "./ui-locale";


interface AuthenticationResult {
  readonly emailVerificationRequired: boolean;
}

export function MfaChallengeForm({
  returnTo
}: Readonly<{ returnTo: string }>) {
  const { t: uiText } = useUiLocale();
  const [challengeToken, setChallengeToken] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const token = sessionStorage.getItem("mfa-challenge-token") ?? "";
    const expiresAt = sessionStorage.getItem("mfa-challenge-expires-at");
    if (
      !token ||
      (expiresAt && new Date(expiresAt).getTime() <= Date.now())
    ) {
      clearChallenge();
      setError("Проверка истекла. Войдите ещё раз.");
    } else {
      setChallengeToken(token);
    }
    setReady(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !challengeToken) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);

    try {
      await browserApiRequest<AuthenticationResult>(
        "/app/api/auth/mfa/challenge/verify",
        {
          method: "POST",
          body: {
            challengeToken,
            code: String(form.get("code") ?? "").trim()
          }
        }
      );
      clearChallenge();
      window.location.assign(safeAppReturnTo(returnTo));
    } catch (requestError) {
      setBusy(false);
      setError(
        requestError instanceof BrowserApiError &&
          requestError.code === "RATE_LIMITED"
          ? "Слишком много попыток. Войдите заново позднее."
          : "Код неверен, уже использован или проверка истекла."
      );
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      {error && (
        <div className="inline-alert danger" role="alert">
          {<UiText text={error ?? ""} />}
        </div>
      )}
      <label className="form-field">
        <span><UiText text="Код подтверждения" /></span>
        <input
          autoComplete="one-time-code"
          disabled={!ready || !challengeToken}
          inputMode="numeric"
          name="code"
          placeholder={uiText("6 цифр или резервный код")}
          required
        />
        <small>
          <UiText text="Введите код из приложения-аутентификатора или один из сохранённых резервных кодов." /></small>
      </label>
      <button
        className="primary-button auth-submit"
        disabled={busy || !ready || !challengeToken}
        type="submit"
      >
        {busy ? <UiText text="Проверяем…" /> : <UiText text="Продолжить" />}
      </button>
      <p className="auth-switch">
        <a href="/app/login" onClick={clearChallenge}>
          <UiText text="Вернуться ко входу" /></a>
      </p>
    </form>
  );
}

function clearChallenge(): void {
  sessionStorage.removeItem("mfa-challenge-token");
  sessionStorage.removeItem("mfa-challenge-expires-at");
}
