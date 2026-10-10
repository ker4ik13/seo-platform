"use client";

import { useEffect, useState } from "react";
import { projectNoteFormat, type PublicProjectNote } from "@seo-platform/contracts";
import { browserApiRequest } from "../lib/browser-api";
import { noteFileName, downloadNoteFile, noteFileExtensions } from "../lib/project-note-files";
import { ProjectNoteDocument } from "./project-note-document";
import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";
import styles from "./public-project-note.module.css";

export function PublicProjectNoteView({ token }: Readonly<{ token: string }>) {
  const { locale } = useUiLocale();
  const [note, setNote] = useState<PublicProjectNote>();
  const [error, setError] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setNote(undefined); setError(false);
    void browserApiRequest<PublicProjectNote>(`/app/api/public/project-notes/${encodeURIComponent(token)}`, { signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setNote({ ...value, format: projectNoteFormat(value.format) }); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [token, revision]);
  function download() { if (note) downloadNoteFile(note.title, note.markdown, note.format); }
  return <main className={styles.shell}><header className={styles.brand}><img alt="" aria-hidden="true" height={32} src="/brand/seonorita-mark.svg" width={32} /><strong>SEOньорита</strong></header>
    {error ? <section className={styles.state} role="alert"><Icon name="note" /><h1><UiText text="Файл недоступен" /></h1><p><UiText text="Ссылка закрыта, удалена или указана неверно." /></p><button onClick={() => setRevision((value) => value + 1)} type="button"><UiText text="Повторить" /></button></section> : !note ? <section className={styles.state} role="status"><UiText text="Загрузка…" /></section> : <article className={styles.document}><header className={styles.header}><div><span className={styles.kind}>.{noteFileExtensions[note.format]}</span><h1>{noteFileName(note.title, note.format)}</h1><time dateTime={note.updatedAt}><UiText text="Обновлено" after=" " />{new Date(note.updatedAt).toLocaleString(locale, { dateStyle: "long", timeStyle: "short" })}</time></div><button className={styles.download} onClick={download} type="button"><Icon name="export" /><UiText text="Скачать" /></button></header><ProjectNoteDocument content={note.markdown} format={note.format} delimiter={note.delimiter} /></article>}
  </main>;
}
