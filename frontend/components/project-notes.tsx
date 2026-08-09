"use client";

import type {
  ProjectNoteCollection,
  ProjectNoteSummary,
  ProjectNoteVisibility
} from "@seo-platform/contracts";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { Icon } from "./icon";

interface NoteDraft {
  readonly title: string;
  readonly markdown: string;
  readonly visibility: ProjectNoteVisibility;
}

const EMPTY_DRAFT: NoteDraft = {
  title: "",
  markdown: "",
  visibility: "PROJECT_MEMBERS"
};

export function ProjectNotes({
  projectId,
  canEdit
}: Readonly<{ projectId: string; canEdit: boolean }>) {
  const [notes, setNotes] = useState<readonly ProjectNoteSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<NoteDraft>(EMPTY_DRAFT);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = useMemo(
    () => notes.find((note) => note.id === selectedId),
    [notes, selectedId]
  );
  const dirty = selected
    ? selected.title !== draft.title ||
      selected.markdown !== draft.markdown ||
      selected.visibility !== draft.visibility
    : Boolean(draft.title || draft.markdown);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    browserApiRequest<ProjectNoteCollection>(notesPath(projectId), {
      signal: controller.signal
    })
      .then((collection) => {
        if (controller.signal.aborted) return;
        setNotes(collection.notes);
        const first = collection.notes[0];
        setSelectedId(first?.id);
        setDraft(first ? draftFrom(first) : EMPTY_DRAFT);
        setView("edit");
        setConfirmDelete(false);
        setError(undefined);
        setNotice(undefined);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId]);

  function selectNote(note: ProjectNoteSummary): void {
    if (dirty && !window.confirm("Отменить несохранённые изменения?")) return;
    setSelectedId(note.id);
    setDraft(draftFrom(note));
    setConfirmDelete(false);
    setError(undefined);
    setNotice(undefined);
  }

  function createDraft(): void {
    if (dirty && !window.confirm("Отменить несохранённые изменения?")) return;
    setSelectedId(undefined);
    setDraft(EMPTY_DRAFT);
    setView("edit");
    setConfirmDelete(false);
    setError(undefined);
    setNotice(undefined);
  }

  async function save(): Promise<void> {
    if (!canEdit || busy || !draft.title.trim()) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = selected
        ? await browserApiRequest<ProjectNoteSummary>(
            `${notesPath(projectId)}/${encodeURIComponent(selected.id)}`,
            {
              method: "PATCH",
              ifMatch: selected.version,
              body: draft
            }
          )
        : await browserApiRequest<ProjectNoteSummary>(notesPath(projectId), {
            method: "POST",
            body: draft
          });
      setNotes((current) => [
        saved,
        ...current.filter((note) => note.id !== saved.id)
      ]);
      setSelectedId(saved.id);
      setDraft(draftFrom(saved));
      setNotice("Заметка сохранена.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function archive(): Promise<void> {
    if (!selected || !canEdit || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest<void>(
        `${notesPath(projectId)}/${encodeURIComponent(selected.id)}`,
        { method: "DELETE", ifMatch: selected.version }
      );
      const remaining = notes.filter((note) => note.id !== selected.id);
      setNotes(remaining);
      const next = remaining[0];
      setSelectedId(next?.id);
      setDraft(next ? draftFrom(next) : EMPTY_DRAFT);
      setConfirmDelete(false);
      setNotice("Заметка удалена.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyPublicLink(): Promise<void> {
    if (!selected?.publicToken) return;
    const url = `${window.location.origin}/notes/${selected.publicToken}`;
    await navigator.clipboard.writeText(url);
    setNotice("Публичная ссылка скопирована.");
  }

  return (
    <section className="project-notes-layout">
      <aside className="project-notes-list panel" aria-label="Заметки проекта">
        <div className="project-notes-list-header">
          <strong>База знаний</strong>
          {canEdit && (
            <button
              aria-label="Новая заметка"
              className="icon-button"
              onClick={createDraft}
              title="Новая заметка"
              type="button"
            >
              <Icon name="plus" />
            </button>
          )}
        </div>
        {loading ? (
          <div className="project-notes-state">Загружаем заметки…</div>
        ) : notes.length === 0 ? (
          <div className="project-notes-state">
            <strong>Заметок пока нет</strong>
            <span>Создайте первую Markdown-заметку проекта.</span>
          </div>
        ) : (
          <div className="project-note-items">
            {notes.map((note) => (
              <button
                className={`project-note-item${note.id === selectedId ? " active" : ""}`}
                key={note.id}
                onClick={() => selectNote(note)}
                type="button"
              >
                <strong>{note.title}</strong>
                <span>
                  {note.visibility === "PUBLIC" ? "Открыта по ссылке" : "Только участники"}
                  <time dateTime={note.updatedAt}>
                    {new Intl.DateTimeFormat("ru-RU", {
                      day: "2-digit",
                      month: "short"
                    }).format(new Date(note.updatedAt))}
                  </time>
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <article className="project-note-editor panel">
        <header className="project-note-editor-header">
          <div>
            <small>{selected ? "Заметка проекта" : "Новая заметка"}</small>
            <h2>{draft.title || "Без названия"}</h2>
          </div>
          <div className="project-note-tabs" role="tablist">
            <button
              aria-selected={view === "edit"}
              className={view === "edit" ? "active" : undefined}
              onClick={() => setView("edit")}
              role="tab"
              type="button"
            >
              Редактор
            </button>
            <button
              aria-selected={view === "preview"}
              className={view === "preview" ? "active" : undefined}
              onClick={() => setView("preview")}
              role="tab"
              type="button"
            >
              Просмотр
            </button>
          </div>
        </header>

        {(error || notice) && (
          <div className={`inline-alert ${error ? "danger" : "success"}`} role={error ? "alert" : "status"}>
            {error ?? notice}
          </div>
        )}

        <div className="project-note-title-row">
          <label className="form-field">
            <span>Название</span>
            <input
              autoFocus={!selected}
              disabled={!canEdit || busy}
              maxLength={160}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Например, План продвижения"
              value={draft.title}
            />
          </label>
          <label className="form-field project-note-visibility">
            <span>Доступ</span>
            <select
              disabled={!canEdit || busy}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  visibility: event.target.value as ProjectNoteVisibility
                }))
              }
              value={draft.visibility}
            >
              <option value="PROJECT_MEMBERS">Только участники</option>
              <option value="PUBLIC">Все по ссылке</option>
            </select>
          </label>
        </div>

        {view === "edit" ? (
          <label className="project-note-markdown-field">
            <span>Markdown</span>
            <textarea
              disabled={!canEdit || busy}
              maxLength={100_000}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  markdown: event.target.value
                }))
              }
              placeholder="# Заголовок\n\nДобавьте текст, чек-лист или [ссылку](https://example.com)."
              value={draft.markdown}
            />
            <small>{draft.markdown.length.toLocaleString("ru-RU")} из 100 000</small>
          </label>
        ) : (
          <MarkdownDocument markdown={draft.markdown} />
        )}

        <footer className="project-note-actions">
          <div className="project-note-share-actions">
            {selected?.publicToken && selected.visibility === "PUBLIC" && (
              <>
                <button className="secondary-button" onClick={() => void copyPublicLink()} type="button">
                  Копировать ссылку
                </button>
                <a
                  className="secondary-button"
                  href={`/notes/${selected.publicToken}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Открыть
                </a>
              </>
            )}
          </div>
          <div className="security-actions">
            {selected && canEdit && (
              confirmDelete ? (
                <>
                  <button className="danger-button" disabled={busy} onClick={() => void archive()} type="button">
                    Подтвердить удаление
                  </button>
                  <button className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)} type="button">
                    Отмена
                  </button>
                </>
              ) : (
                <button className="secondary-button danger-text-button" disabled={busy} onClick={() => setConfirmDelete(true)} type="button">
                  Удалить
                </button>
              )
            )}
            {canEdit && (
              <button
                className="primary-button"
                disabled={busy || !dirty || !draft.title.trim()}
                onClick={() => void save()}
                type="button"
              >
                {busy ? "Сохраняем…" : selected ? "Сохранить" : "Создать заметку"}
              </button>
            )}
          </div>
        </footer>
      </article>
    </section>
  );
}

export function MarkdownDocument({ markdown }: Readonly<{ markdown: string }>) {
  return (
    <div className="markdown-document">
      {markdown ? (
        <ReactMarkdown
          components={{
            a: ({ children, href }) => (
              <a href={href} rel="noopener noreferrer" target="_blank">
                {children}
              </a>
            )
          }}
          remarkPlugins={[remarkGfm]}
        >
          {markdown}
        </ReactMarkdown>
      ) : (
        <div className="project-notes-state">Добавьте текст в редакторе.</div>
      )}
    </div>
  );
}

function notesPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/notes`;
}

function draftFrom(note: ProjectNoteSummary): NoteDraft {
  return {
    title: note.title,
    markdown: note.markdown,
    visibility: note.visibility
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.status === 409) return "Заметка изменилась в другой вкладке. Обновите страницу.";
    return `${error.message}${error.requestId ? ` Код запроса: ${error.requestId}.` : ""}`;
  }
  return "Не удалось выполнить операцию с заметкой.";
}
