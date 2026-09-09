"use client";

import type {
  SemanticKeywordInsights,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { SemanticModal } from "./semantic-modal";
import { UiText, useUiLocale } from "./ui-locale";

export function SemanticKeywordNoteModal({
  keywordId,
  keywordText,
  keywordVersion,
  onClose,
  onUpdated,
  projectId
}: Readonly<{
  keywordId: string;
  keywordText: string;
  keywordVersion: number;
  onClose: () => void;
  onUpdated: (item: SemanticKeywordListItem) => void;
  projectId: string;
}>) {
  const { locale, t } = useUiLocale();
  const [note, setNote] = useState("");
  const [version, setVersion] = useState(keywordVersion);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void browserApiRequest<SemanticKeywordInsights>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}/insights`,
      { signal: controller.signal }
    ).then((result) => {
      if (!controller.signal.aborted) setNote(result.note ?? "");
    }).catch(() => {
      if (!controller.signal.aborted) setError(t("Не удалось загрузить заметку."));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [keywordId, projectId, t]);

  async function mutate(nextNote: string | null): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await browserApiRequest<SemanticKeywordListItem>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}`,
        {
          method: "PATCH",
          ifMatch: version,
          body: { note: nextNote }
        }
      );
      setVersion(updated.version);
      setNote(nextNote ?? "");
      onUpdated(updated);
      if (nextNote === null) onClose();
    } catch (requestError) {
      setError(requestError instanceof BrowserApiError && requestError.status === 412
        ? t("Запрос изменился в другой вкладке. Откройте заметку заново.")
        : requestError instanceof BrowserApiError
          ? requestError.message
          : t("Не удалось сохранить заметку."));
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void mutate(note.trim() || null);
  }

  return (
    <SemanticModal
      bodyClassName="semantic-modal-body-compact"
      description={t("Контекст и рабочие комментарии по запросу. Изменения сохраняются только по кнопке.")}
      footer={<div className="semantic-note-modal-footer"><span><UiText text="Символов:" after=" " />{note.length.toLocaleString(locale)}</span><div className="semantic-modal-actions"><button className="danger-button subtle" disabled={loading || saving || !note.trim()} onClick={() => void mutate(null)} type="button"><UiText text="Удалить" /></button><button className="secondary-button" disabled={saving} onClick={onClose} type="button"><UiText text="Отмена" /></button><button className="primary-button" disabled={loading || saving} form="semantic-keyword-note-form" type="submit">{saving ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}</button></div></div>}
      onClose={() => !saving && onClose()}
      size="medium"
      title={t("Заметка · {0}", [keywordText])}
    >
      <form id="semantic-keyword-note-form" onSubmit={submit}>
        <textarea autoFocus disabled={loading || saving} onChange={(event) => setNote(event.target.value)} placeholder={t("Добавьте контекст, гипотезу или задачу…")} rows={12} value={note} />
        {error && <div className="inline-alert danger" role="alert">{error}</div>}
      </form>
    </SemanticModal>
  );
}
