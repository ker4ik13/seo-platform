"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  fragmentFreeBrowserPath,
  readOneTimeTokenFragment
} from "../lib/one-time-link";

interface PasswordResetAccepted {
  readonly accepted: true;
  readonly resetTokenForDevelopment?: string;
}

export function RequestPasswordResetForm() {
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);

    try {
      const result = await browserApiRequest<PasswordResetAccepted>(
        "/app/api/auth/password/request",
        {
          method: "POST",
          body: { email: String(form.get("email") ?? "").trim() }
        }
      );
      if (result.resetTokenForDevelopment) {
        sessionStorage.setItem(
          "development-password-reset-token",
          result.resetTokenForDevelopment
        );
        window.location.assign("/app/reset-password");
        return;
      }
      setAccepted(true);
    } catch (requestError) {
      setError(
        requestError instanceof BrowserApiError &&
          requestError.code === "RATE_LIMITED"
          ? "Слишком много запросов. Повторите попытку позже."
          : "Не удалось отправить запрос. Проверьте соединение и повторите."
      );
    } finally {
      setBusy(false);
    }
  }

  if (accepted) {
    return (
      <div className="auth-form">
        <div className="inline-alert success" role="status">
          Если аккаунт с таким email существует, мы отправили ссылку для
          восстановления. Проверьте также папку «Спам».
        </div>
        <a className="secondary-button auth-submit" href="/app/login">
          Вернуться ко входу
        </a>
      </div>
    );
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      {error && (
        <div className="inline-alert danger" role="alert">
          {error}
        </div>
      )}
      <label className="form-field">
        <span>Email</span>
        <input
          autoComplete="email"
          name="email"
          placeholder="name@company.com"
          required
          type="email"
        />
      </label>
      <button className="primary-button auth-submit" disabled={busy} type="submit">
        {busy ? "Отправляем…" : "Получить ссылку"}
      </button>
      <p className="auth-switch">
        <a href="/app/login">Вернуться ко входу</a>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const token = useRef("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();

  useEffect(() => {
    const fragment = readOneTimeTokenFragment(window.location.hash, 256);
    if (fragment.shouldScrub) {
      window.history.replaceState(
        null,
        "",
        fragmentFreeBrowserPath(window.location)
      );
    }
    const developmentToken = sessionStorage.getItem(
      "development-password-reset-token"
    );
    token.current = fragment.token || developmentToken || "";
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(undefined);
    setFieldError(undefined);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");

    if (password !== confirmation) {
      setFieldError("Пароли не совпадают.");
      return;
    }
    if (!token.current) {
      setError("Ссылка восстановления неполная. Запросите новую.");
      return;
    }

    setBusy(true);
    try {
      await browserApiRequest("/app/api/auth/password/reset", {
        method: "POST",
        body: { token: token.current, password }
      });
      sessionStorage.removeItem("development-password-reset-token");
      window.location.assign("/app");
    } catch (requestError) {
      setBusy(false);
      if (requestError instanceof BrowserApiError) {
        const passwordIssue = requestError.fieldErrors.find(
          ({ path }) => path === "password"
        );
        if (passwordIssue) {
          setFieldError(passwordErrorMessage(passwordIssue.code));
          return;
        }
        if (requestError.code === "RESOURCE_STATE_CONFLICT") {
          setError(
            "Ссылка недействительна, просрочена или уже использована. Запросите новую."
          );
          return;
        }
        if (requestError.code === "RATE_LIMITED") {
          setError("Слишком много попыток. Повторите позже.");
          return;
        }
      }
      setError("Не удалось изменить пароль. Повторите попытку.");
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      {error && (
        <div className="inline-alert danger" role="alert">
          {error}
        </div>
      )}
      <PasswordField
        error={fieldError}
        label="Новый пароль"
        name="password"
      />
      <PasswordField
        label="Повторите пароль"
        name="passwordConfirmation"
      />
      <button className="primary-button auth-submit" disabled={busy} type="submit">
        {busy ? "Сохраняем…" : "Сохранить новый пароль"}
      </button>
      <p className="auth-switch">
        <a href="/app/forgot-password">Запросить новую ссылку</a>
      </p>
    </form>
  );
}

function PasswordField({
  error,
  label,
  name
}: Readonly<{
  error?: string | undefined;
  label: string;
  name: string;
}>) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        aria-describedby={error ? `${name}-error` : `${name}-hint`}
        aria-invalid={Boolean(error)}
        autoComplete="new-password"
        minLength={12}
        name={name}
        required
        type="password"
      />
      {error ? (
        <small className="field-error" id={`${name}-error`}>
          {error}
        </small>
      ) : (
        <small id={`${name}-hint`}>Минимум 12 символов</small>
      )}
    </label>
  );
}

function passwordErrorMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    PASSWORD_TOO_SHORT: "Пароль должен содержать минимум 12 символов.",
    PASSWORD_TOO_LONG: "Пароль слишком длинный.",
    PASSWORD_COMPROMISED: "Выберите менее распространённый пароль."
  };
  return messages[code] ?? "Проверьте пароль.";
}
