"use client";

import type { PublicProjectNote } from "@seo-platform/contracts";
import { useEffect, useState } from "react";
import { browserApiRequest } from "../lib/browser-api";
import { MarkdownDocument } from "./project-notes";
import { UiText } from "./ui-locale";
import { useUiLocale } from "./ui-locale";



export function PublicProjectNoteView({ token }: Readonly<{ token: string }>) {
  const uiLocale = useUiLocale().locale;
  const [note, setNote] = useState<PublicProjectNote>();
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    browserApiRequest<PublicProjectNote>(
      `/app/api/public/project-notes/${encodeURIComponent(token)}`,
      { signal: controller.signal }
    )
      .then(setNote)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [token]);

  if (error) {
    return (
      <main className="public-note-shell">
        <section className="panel project-notes-state">
          <strong><UiText text="Заметка недоступна" /></strong>
          <span><UiText text="Ссылка закрыта, удалена или указана неверно." /></span>
        </section>
      </main>
    );
  }
  if (!note) {
    return <main className="public-note-shell"><div className="panel project-notes-state"><UiText text="Загружаем заметку…" /></div></main>;
  }
  return (
    <main className="public-note-shell">
      <article className="public-note panel">
        <header>
          <img alt="" aria-hidden="true" height={36} src="/brand/seonorita-mark.svg" width={36} />
          <div>
            <small><UiText text="Публичная заметка" /></small>
            <h1>{note.title}</h1>
            <time dateTime={note.updatedAt}>
              <UiText text="Обновлено" after=" " />{new Intl.DateTimeFormat(uiLocale, { dateStyle: "long", timeStyle: "short" }).format(new Date(note.updatedAt))}
            </time>
          </div>
        </header>
        <MarkdownDocument markdown={note.markdown} />
      </article>
    </main>
  );
}
