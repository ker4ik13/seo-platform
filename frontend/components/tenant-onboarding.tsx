"use client";

import { CustomSelect } from "./custom-select";

import { useState, type FormEvent } from "react";
import type { AppWorkspace } from "../lib/app-types";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";

export function WorkspaceOnboarding() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const workspace = await browserApiRequest<AppWorkspace>(
        "/app/api/workspaces",
        {
          method: "POST",
          body: {
            name: String(form.get("name") ?? "").trim(),
            country: optionalValue(form.get("country")),
            locale: document.documentElement.lang || "ru",
            timezone:
              Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            billingCurrency: String(form.get("billingCurrency") ?? "RUB")
          }
        }
      );
      writePreference("seo_workspace", workspace.id);
      window.location.assign("/app");
    } catch (requestError) {
      setBusy(false);
      setError(onboardingError(requestError));
    }
  }

  return (
    <section className="onboarding-panel" id="workspace-onboarding">
      <span className="state-icon">1</span>
      <div>
        <h1>Создайте рабочую область</h1>
        <p>
          В ней будут храниться проекты, команда, интеграции, тариф и общий
          аудит.
        </p>
      </div>
      <form className="onboarding-form" onSubmit={submit}>
        {error && (
          <div className="inline-alert danger" role="alert">
            {error}
          </div>
        )}
        <label className="form-field">
          <span>Название</span>
          <input
            autoFocus
            maxLength={160}
            name="name"
            placeholder="Например, SEO-отдел"
            required
          />
        </label>
        <div className="form-row">
          <label className="form-field">
            <span>Страна</span>
            <CustomSelect defaultValue="RU" name="country">
              <option value="RU">Россия</option>
              <option value="KZ">Казахстан</option>
              <option value="US">США</option>
              <option value="GB">Великобритания</option>
              <option value="DE">Германия</option>
              <option value="">Другая</option>
            </CustomSelect>
          </label>
          <label className="form-field">
            <span>Валюта</span>
            <CustomSelect defaultValue="RUB" name="billingCurrency">
              <option value="RUB">RUB</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </CustomSelect>
          </label>
        </div>
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? "Создаём…" : "Создать рабочую область"}
        </button>
      </form>
    </section>
  );
}

export function ProjectOnboarding({
  workspace
}: Readonly<{ workspace: AppWorkspace }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [duplicateConfirmation, setDuplicateConfirmation] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const project = await browserApiRequest<{ readonly id: string }>(
        `/app/api/workspaces/${encodeURIComponent(workspace.id)}/projects`,
        {
          method: "POST",
          body: {
            name: String(form.get("name") ?? "").trim(),
            domain: String(form.get("domain") ?? "").trim(),
            confirmDuplicateDomain:
              duplicateConfirmation &&
              form.get("confirmDuplicateDomain") === "on"
          }
        }
      );
      writePreference("seo_project", project.id);
      window.location.assign("/app");
    } catch (requestError) {
      setBusy(false);
      if (
        requestError instanceof BrowserApiError &&
        requestError.code === "DUPLICATE"
      ) {
        setDuplicateConfirmation(true);
        setError(
          "Проект с этим доменом уже есть. Подтвердите осознанное создание дубля."
        );
        return;
      }
      setError(onboardingError(requestError));
    }
  }

  return (
    <section className="onboarding-panel">
      <span className="state-icon">2</span>
      <div>
        <h1>Создайте первый проект</h1>
        <p>
          Добавьте домен. Поисковые контексты, конкурентов и импорт семантики
          настроим следующим шагом.
        </p>
      </div>
      <form className="onboarding-form" onSubmit={submit}>
        {error && (
          <div className="inline-alert danger" role="alert">
            {error}
          </div>
        )}
        <label className="form-field">
          <span>Название проекта</span>
          <input
            autoFocus
            maxLength={160}
            name="name"
            placeholder="Например, Основной сайт"
            required
          />
        </label>
        <label className="form-field">
          <span>Домен</span>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            name="domain"
            placeholder="example.com"
            required
          />
          <small>Без пути, параметров и номера порта</small>
        </label>
        {duplicateConfirmation && (
          <label className="checkbox-field">
            <input name="confirmDuplicateDomain" required type="checkbox" />
            <span>Да, это отдельный проект с тем же доменом</span>
          </label>
        )}
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? "Создаём…" : "Создать проект"}
        </button>
      </form>
    </section>
  );
}

function optionalValue(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function writePreference(name: string, value: string): void {
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function onboardingError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "PAYMENT_REQUIRED") {
      return "Рабочая область доступна только для чтения. Новые проекты сейчас создать нельзя.";
    }
    if (error.status >= 500) {
      return "Сервис временно недоступен. Введённые данные сохранены в форме.";
    }
    return "Проверьте заполнение полей и повторите попытку.";
  }
  return "Не удалось связаться с сервером. Повторите попытку.";
}
