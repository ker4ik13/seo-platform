"use client";
import { legalDocumentVersion } from "../lib/legal-versions";

import { TelegramLogin } from "./telegram-login";
import { CustomSelect } from "./custom-select";

import { useState, type FormEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { safeAppReturnTo } from "../lib/app-path";
import { UiText, useUiLocale } from "./ui-locale";


interface AuthenticationResult {
  readonly emailVerificationRequired: boolean;
  readonly verificationTokenForDevelopment?: string;
}

interface MfaChallengeResult {
  readonly mfaRequired: true;
  readonly challengeToken: string;
  readonly expiresAt: string;
}

export function AuthForm({
  mode,
  returnTo = "/app",
  sessionExpired = false,
  sessionRevoked = false
}: Readonly<{
  mode: "login" | "register";
  returnTo?: string;
  sessionExpired?: boolean;
  sessionRevoked?: boolean;
}>) {
  const { t: uiText } = useUiLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setFieldErrors({});
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();

    try {
      const result = await browserApiRequest<
        AuthenticationResult | MfaChallengeResult
      >(
        `/app/api/auth/${isRegister ? "register" : "login"}`,
        {
          method: "POST",
          body: isRegister
            ? {
                email,
                password: String(form.get("password") ?? ""),
                displayName: String(form.get("displayName") ?? "").trim(),
                country: optionalValue(form.get("country")),
                locale: document.documentElement.lang || "ru",
                timezone:
                  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                termsVersion:
                  process.env.NEXT_PUBLIC_TERMS_VERSION ??
                  legalDocumentVersion,
                privacyVersion:
                  process.env.NEXT_PUBLIC_PRIVACY_VERSION ??
                  legalDocumentVersion,
                termsAccepted: form.get("termsAccepted") === "on",
                privacyAccepted: form.get("privacyAccepted") === "on",
                marketingAccepted: form.get("marketingAccepted") === "on",
                marketingVersion:
                  process.env.NEXT_PUBLIC_MARKETING_VERSION ??
                  "2026-07-28-draft"
              }
            : {
                email,
                password: String(form.get("password") ?? "")
              }
        }
      );

      if (isMfaChallenge(result)) {
        sessionStorage.setItem("mfa-challenge-token", result.challengeToken);
        sessionStorage.setItem("mfa-challenge-expires-at", result.expiresAt);
        window.location.assign(
          `/app/mfa?returnTo=${encodeURIComponent(safeAppReturnTo(returnTo))}`
        );
        return;
      }
      if (result.emailVerificationRequired) {
        sessionStorage.setItem("pending-verification-email", email);
        sessionStorage.setItem(
          "pending-verification-return-to",
          safeAppReturnTo(returnTo)
        );
        if (result.verificationTokenForDevelopment) {
          sessionStorage.setItem(
            "development-verification-token",
            result.verificationTokenForDevelopment
          );
        }
        window.location.assign(
          `/app/verify-email?email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(
            safeAppReturnTo(returnTo)
          )}`
        );
        return;
      }
      window.location.assign(safeAppReturnTo(returnTo));
    } catch (requestError) {
      setBusy(false);
      if (requestError instanceof BrowserApiError) {
        if (
          !isRegister &&
          requestError.code === "RESOURCE_STATE_CONFLICT"
        ) {
          sessionStorage.setItem("pending-verification-email", email);
          sessionStorage.setItem(
            "pending-verification-return-to",
            safeAppReturnTo(returnTo)
          );
          window.location.assign(
            `/app/verify-email?email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(
              safeAppReturnTo(returnTo)
            )}`
          );
          return;
        }
        setError(errorMessage(requestError));
        setFieldErrors(
          Object.fromEntries(
            requestError.fieldErrors.map((item) => [
              item.path,
              fieldErrorMessage(item.code)
            ])
          )
        );
      } else {
        setError("Не удалось связаться с сервером. Повторите попытку.");
      }
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      {sessionExpired && (
        <div className="inline-alert warning" role="status">
          <UiText text="Сессия истекла. Войдите снова — ваши проекты и результаты сохранены." /></div>
      )}
      {sessionRevoked && (
        <div className="inline-alert success" role="status">
          <UiText text="Сессия на этом устройстве завершена. Для продолжения войдите снова." /></div>
      )}
      {error && (
        <div className="inline-alert danger" role="alert">
          {<UiText text={error ?? ""} />}
        </div>
      )}

      {isRegister && (
        <FormField
          autoComplete="name"
          error={fieldErrors.displayName}
          label={uiText("Имя")}
          name="displayName"
          placeholder={uiText("Как к вам обращаться")}
          required
        />
      )}
      <FormField
        autoComplete="email"
        error={fieldErrors.email}
        label="Email"
        name="email"
        placeholder="name@company.com"
        required
        type="email"
      />
      <FormField
        autoComplete={isRegister ? "new-password" : "current-password"}
        error={fieldErrors.password}
        hint={isRegister ? uiText("Минимум 12 символов") : undefined}
        label={uiText("Пароль")}
        minLength={isRegister ? 12 : undefined}
        name="password"
        required
        type="password"
      />
      {!isRegister && (
        <p className="auth-inline-link">
          <a href="/app/forgot-password"><UiText text="Забыли пароль?" /></a>
        </p>
      )}

      {isRegister && (
        <>
          <label className="form-field">
            <span><UiText text="Страна" /></span>
            <CustomSelect defaultValue="" name="country">
              <option value=""><UiText text="Не выбрана" /></option>
              <option value="RU"><UiText text="Россия" /></option>
              <option value="KZ"><UiText text="Казахстан" /></option>
              <option value="US"><UiText text="США" /></option>
              <option value="GB"><UiText text="Великобритания" /></option>
              <option value="DE"><UiText text="Германия" /></option>
              <option value="AE"><UiText text="ОАЭ" /></option>
            </CustomSelect>
          </label>
          <label className="checkbox-field">
            <input name="termsAccepted" required type="checkbox" />
            <span>
              <UiText text="Принимаю" after=" " /><a href="/terms" target="_blank" rel="noopener noreferrer"><UiText text="Условия" /></a>
            </span>
          </label>
          <label className="checkbox-field">
            <input name="privacyAccepted" required type="checkbox" />
            <span><UiText text="Даю отдельное согласие на обработку данных" /> <a href="/data-consent" target="_blank" rel="noopener noreferrer"><UiText text="Текст согласия" /></a> · <a href="/privacy" target="_blank" rel="noopener noreferrer"><UiText text="Политика конфиденциальности" /></a></span>
          </label>
          <label className="checkbox-field">
            <input name="marketingAccepted" type="checkbox" />
            <span><UiText text="Получать полезные материалы и новости продукта" /></span>
          </label>
        </>
      )}

      <button className="primary-button auth-submit" disabled={busy} type="submit">
        {busy
          ? isRegister
            ? <UiText text="Создаём аккаунт…" />
            : <UiText text="Входим…" />
          : isRegister
            ? <UiText text="Создать аккаунт" />
            : <UiText text="Войти" />}
      </button>
      {!isRegister && <TelegramLogin returnTo={returnTo} />}
      <p className="auth-switch">
        {isRegister ? <UiText text="Уже есть аккаунт?" /> : <UiText text="Ещё нет аккаунта?" />}{" "}
        <a
          href={
            isRegister
              ? `/app/login?returnTo=${encodeURIComponent(returnTo)}`
              : `/app/register?returnTo=${encodeURIComponent(returnTo)}`
          }
        >
          {isRegister ? <UiText text="Войти" /> : <UiText text="Зарегистрироваться" />}
        </a>
      </p>
    </form>
  );
}

function FormField({
  label,
  name,
  error,
  hint,
  ...inputProps
}: Readonly<{
  label: string;
  name: string;
  error?: string | undefined;
  hint?: string | undefined;
  autoComplete?: string | undefined;
  minLength?: number | undefined;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  type?: string | undefined;
}>) {
  const describedBy = error
    ? `${name}-error`
    : hint
      ? `${name}-hint`
      : undefined;
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        name={name}
      />
      {error ? (
        <small className="field-error" id={`${name}-error`}>
          {<UiText text={error ?? ""} />}
        </small>
      ) : hint ? (
        <small id={`${name}-hint`}>{hint}</small>
      ) : null}
    </label>
  );
}

function optionalValue(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isMfaChallenge(
  result: AuthenticationResult | MfaChallengeResult
): result is MfaChallengeResult {
  return "mfaRequired" in result && result.mfaRequired;
}

function errorMessage(error: BrowserApiError): string {
  const messages: Readonly<Record<string, string>> = {
    UNAUTHENTICATED: "Неверный email или пароль.",
    INVALID_CREDENTIALS: "Неверный email или пароль.",
    RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
    DUPLICATE: "Аккаунт с таким email уже существует.",
    FORBIDDEN: "Вход для этого аккаунта временно ограничен."
  };
  return (
    messages[error.code] ??
    (error.status >= 500
      ? "Сервис временно недоступен. Повторите попытку."
      : "Проверьте введённые данные.")
  );
}

function fieldErrorMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    INVALID_EMAIL: "Введите корректный email.",
    TOO_SHORT: "Значение слишком короткое.",
    TOO_LONG: "Значение слишком длинное.",
    PASSWORD_TOO_SHORT: "Пароль должен содержать минимум 12 символов.",
    PASSWORD_TOO_LONG: "Пароль слишком длинный.",
    PASSWORD_COMPROMISED: "Выберите менее распространённый пароль.",
    CONSENT_REQUIRED: "Необходимо принять условия.",
    WEAK_PASSWORD: "Используйте более надёжный пароль.",
    COMMON_PASSWORD: "Этот пароль слишком распространён.",
    REQUIRED: "Заполните поле."
  };
  return messages[code] ?? "Проверьте значение.";
}
