"use client";

import { CustomSelect } from "./custom-select";

import { useState, type FormEvent } from "react";
import type { AppWorkspace } from "../lib/app-types";
import type { ProjectCollectionCapabilities } from "@seo-platform/contracts";
import { useRouter } from "next/navigation";
import { ProjectCreationWizard } from "./project-creation-wizard";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { UiText, useUiLocale } from "./ui-locale";


export function WorkspaceOnboarding() {
  const { t: uiText } = useUiLocale();
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
        <h1><UiText text="Создайте рабочую область" /></h1>
        <p>
          <UiText text="В ней будут храниться проекты, команда, интеграции, тариф и общий аудит." /></p>
      </div>
      <form className="onboarding-form" onSubmit={submit}>
        {error && (
          <div className="inline-alert danger" role="alert">
            {<UiText text={error ?? ""} />}
          </div>
        )}
        <label className="form-field">
          <span><UiText text="Название" /></span>
          <input
            autoFocus
            maxLength={160}
            name="name"
            placeholder={uiText("Например, SEO-отдел")}
            required
          />
        </label>
        <div className="form-row">
          <label className="form-field">
            <span><UiText text="Страна" /></span>
            <CustomSelect defaultValue="RU" name="country">
              <option value="RU"><UiText text="Россия" /></option>
              <option value="KZ"><UiText text="Казахстан" /></option>
              <option value="US"><UiText text="США" /></option>
              <option value="GB"><UiText text="Великобритания" /></option>
              <option value="DE"><UiText text="Германия" /></option>
              <option value=""><UiText text="Другая" /></option>
            </CustomSelect>
          </label>
          <label className="form-field">
            <span><UiText text="Валюта" /></span>
            <CustomSelect defaultValue="RUB" name="billingCurrency">
              <option value="RUB">RUB</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </CustomSelect>
          </label>
        </div>
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? <UiText text="Создаём…" /> : <UiText text="Создать рабочую область" />}
        </button>
      </form>
    </section>
  );
}

export function ProjectOnboarding({ workspace, currentUserId, capabilities }: Readonly<{
  workspace: AppWorkspace; currentUserId: string; capabilities?: ProjectCollectionCapabilities;
}>) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return <section className="onboarding-panel">
    <span className="state-icon">2</span>
    <div><h1><UiText text="Создайте первый проект" /></h1>
      <p><UiText text="Добавьте сайт, выберите поисковые срезы и настройте колонки семантики." /></p></div>
    <button className="primary-button" type="button" disabled={capabilities?.creation.allowed !== true} onClick={() => setOpen(true)}><UiText text="Создать проект" /></button>
    {open && <ProjectCreationWizard key={currentUserId + ":" + workspace.id} workspace={workspace} currentUserId={currentUserId}
      {...(capabilities ? { capabilities } : {})}
      onClose={(createdId) => { setOpen(false); if (createdId) router.refresh(); }}
      onOpenProject={projectId => { writePreference("seo_project", projectId); window.location.assign("/app/semantics"); }} />}
  </section>;
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
