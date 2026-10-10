"use client";

import type { ProjectNoteFormat } from "@seo-platform/contracts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SpreadsheetEditor } from "./spreadsheet-editor";
import { tabularNote } from "../lib/project-note-files";
import { UiText } from "./ui-locale";
import styles from "./project-note-document.module.css";

export function ProjectNoteDocument({ content, format, delimiter }: Readonly<{ content: string; format: ProjectNoteFormat; delimiter?: string | undefined }>) {
  if (!content) return <div className={styles.empty}><UiText text="Файл пока пуст." /></div>;
  if (tabularNote(format)) return <div className={styles.table}><SpreadsheetEditor content={content} format={format} delimiter={delimiter} readOnly /></div>;
  if (format === "MARKDOWN") return <div className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} rel="noopener noreferrer" target="_blank">{children}</a> }}>{content}</ReactMarkdown></div>;
  if (format === "JSON") {
    try { return <pre className={styles.text}>{JSON.stringify(JSON.parse(content), null, 2)}</pre>; }
    catch { return <div><p className={styles.error} role="alert"><UiText text="JSON содержит ошибку. Исправьте файл в редакторе." /></p><pre className={styles.text}>{content}</pre></div>; }
  }
  return <pre className={styles.text}>{content}</pre>;
}
