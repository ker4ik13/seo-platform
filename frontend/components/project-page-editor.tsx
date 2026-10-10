"use client";

import { useId, useEffect, useState, type FormEvent } from "react";
import { pageTypes, pageIndexabilities, pageContentStatuses, type PageType, type PageIndexability, type PageContentStatus } from "@seo-platform/contracts";
import type { ProjectPageDraft, ProjectPageDraftErrors } from "../lib/project-pages";
import { pageTypeLabel, pageIndexabilityLabel, contentStatusLabel } from "../lib/page-presentation";
import { CustomDateInput } from "./custom-date-input";
import { CustomSelect } from "./custom-select";
import { FormField } from "./form-field";
import { LanguageSelect } from "./locale-selects";
import { ProjectMemberSelect } from "./project-member-select";
import { SemanticModal } from "./semantic-modal";
import { UiText } from "./ui-locale";
import styles from "./project-page-editor.module.css";

export function ProjectPageEditor({ projectId, busy, draft, errors, existing, errorMessage, onCancel, onChange, onSubmit }: Readonly<{
  errorMessage?: string | undefined; projectId: string; busy: boolean; draft: ProjectPageDraft; errors: ProjectPageDraftErrors; existing: boolean; onCancel: () => void; onChange: (patch: Partial<ProjectPageDraft>) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  const formId = useId();
  const advancedErrors = Boolean(errors.httpStatus || errors.language || errors.canonicalTarget || errors.aliases || errors.ownerId || errors.publishedAt);
  const [advancedOpen, setAdvancedOpen] = useState(advancedErrors);
  useEffect(() => { if (advancedErrors) setAdvancedOpen(true); }, [advancedErrors]);
  return <SemanticModal title={existing ? "Параметры страницы" : "Добавить страницу"} className={styles.modal!} closeDisabled={busy} onClose={onCancel} footer={<div className={styles.actions}><button className="secondary-button" disabled={busy} onClick={onCancel} type="button"><UiText text="Отмена" /></button><button className="primary-button" disabled={busy} form={formId} type="submit"><UiText text={busy ? "Сохраняем…" : "Сохранить"} /></button></div>}>
    {errorMessage && <p className="field-error" role="alert">{errorMessage}</p>}
    <form className={styles.form} id={formId} noValidate onSubmit={onSubmit}>
      <fieldset className={styles.fields} disabled={busy}>
        <FormField className={styles.wide} label="URL страницы" error={errors.url}><input autoFocus onChange={(event) => onChange({ url: event.target.value })} placeholder="https://example.com/service/" required type="url" value={draft.url} /></FormField>
        <FormField label="Тип страницы"><CustomSelect value={draft.pageType} onChange={(event) => onChange({ pageType: event.target.value as PageType })}>{pageTypes.map((type) => <option key={type} value={type}><UiText text={pageTypeLabel(type)} /></option>)}</CustomSelect></FormField>
        <FormField label="Индексируемость"><CustomSelect value={draft.indexability} onChange={(event) => onChange({ indexability: event.target.value as PageIndexability })}>{pageIndexabilities.map((state) => <option key={state} value={state}><UiText text={pageIndexabilityLabel(state)} /></option>)}</CustomSelect></FormField>
        <FormField label="Title"><input value={draft.title} onChange={(event) => onChange({ title: event.target.value })} /></FormField>
        <FormField label="H1"><input value={draft.h1} onChange={(event) => onChange({ h1: event.target.value })} /></FormField>
        <FormField className={styles.wide} label="Description"><textarea rows={3} value={draft.description} onChange={(event) => onChange({ description: event.target.value })} /></FormField>
        <FormField label="Статус контента"><CustomSelect value={draft.contentStatus} onChange={(event) => onChange({ contentStatus: event.target.value as PageContentStatus | "" })}><option value=""><UiText text="Не задан" /></option>{pageContentStatuses.map((status) => <option key={status} value={status}><UiText text={contentStatusLabel(status)} /></option>)}</CustomSelect></FormField>
        <FormField label="Приоритет" error={errors.priority}><input value={draft.priority} min={0} max={100} required type="number" onChange={(event) => onChange({ priority: event.target.value })} /></FormField>
        <FormField className={styles.wide} label="Заметки"><textarea rows={3} value={draft.notes} onChange={(event) => onChange({ notes: event.target.value })} /></FormField>
      </fieldset>
      <details className={styles.advanced} open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}><summary><UiText text="Дополнительные параметры" /></summary><fieldset className={styles.fields} disabled={busy}>
        <FormField label="HTTP-код" error={errors.httpStatus}><input inputMode="numeric" value={draft.httpStatus} placeholder="200" onChange={(event) => onChange({ httpStatus: event.target.value })} /></FormField>
        <FormField label="Язык" error={errors.language}><LanguageSelect value={draft.language} onChange={(event) => onChange({ language: event.target.value })} /></FormField>
        <FormField label="Шаблон"><input value={draft.template} placeholder="service-detail" onChange={(event) => onChange({ template: event.target.value })} /></FormField>
        <FormField label="Robots"><input value={draft.robots} placeholder="index, follow" onChange={(event) => onChange({ robots: event.target.value })} /></FormField>
        <FormField className={styles.wide} label="Canonical URL" error={errors.canonicalTarget}><input type="url" value={draft.canonicalTarget} placeholder="https://example.com/canonical/" onChange={(event) => onChange({ canonicalTarget: event.target.value })} /></FormField>
        <FormField className={styles.wide} label="Алиасы URL" error={errors.aliases}><textarea rows={3} value={draft.aliases} placeholder={"https://example.com/old-url/\nhttps://example.com/legacy/"} onChange={(event) => onChange({ aliases: event.target.value })} /></FormField>
        <FormField label="Ответственный" error={errors.ownerId}><ProjectMemberSelect projectId={projectId} value={draft.ownerId} onChange={(ownerId) => onChange({ ownerId })} /></FormField>
        <FormField label="Опубликована" error={errors.publishedAt}><CustomDateInput type="datetime-local" value={draft.publishedAt} onChange={(event) => onChange({ publishedAt: event.target.value })} /></FormField>
      </fieldset></details>
    </form>
  </SemanticModal>;
}
