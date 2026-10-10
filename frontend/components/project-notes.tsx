"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent, type CSSProperties } from "react";
import { projectNoteFormats, projectNoteFormat, type ProjectNoteCollection, type ProjectNoteFormat, type ProjectNoteSummary, type ProjectNoteVisibility } from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { noteFileExtensions, noteFileName, downloadNoteFile, tabularNote, noteDelimiter, parseDelimitedRows, serializeDelimitedRows } from "../lib/project-note-files";
import { CsvDelimiterControl } from "./csv-delimiter-control";
import { CustomSelect } from "./custom-select";
import { FormField } from "./form-field";
import { Icon } from "./icon";
import { ProjectNoteDocument } from "./project-note-document";
import { SemanticModal } from "./semantic-modal";
import { SpreadsheetEditor } from "./spreadsheet-editor";
import { WorkspaceSidebar, WorkspaceSidebarSeparator } from "./workspace-sidebar";
import { useConfirmation } from "./use-confirmation";
import { UiText, useUiLocale } from "./ui-locale";
import styles from "./project-notes.module.css";

interface NoteDraft { title: string; markdown: string; format: ProjectNoteFormat; delimiter?: string; visibility: ProjectNoteVisibility; }
const emptyDraft = (): NoteDraft => ({ title: "", markdown: "", format: "MARKDOWN", visibility: "PROJECT_MEMBERS" });

export function ProjectNotes({ projectId, canEdit, heading }: Readonly<{ projectId: string; canEdit: boolean; heading?: ReactNode }>) {
  const { t, locale } = useUiLocale();
  const [notes, setNotes] = useState<readonly ProjectNoteSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<NoteDraft>(emptyDraft);
  const [view, setView] = useState<"edit" | "preview" | "source">("edit");
  const [search, setSearch] = useState("");
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>(), [notice, setNotice] = useState<string>();
  const [revision, setRevision] = useState(0), [sidebarWidth, setSidebarWidth] = useState(248);
  const [createOpen, setCreateOpen] = useState(false), [newDraft, setNewDraft] = useState<NoteDraft>(emptyDraft);
  const [delimiterValid, setDelimiterValid] = useState(true), [newDelimiterValid, setNewDelimiterValid] = useState(true);
  const [createError, setCreateError] = useState<string>();
  const uploadRef = useRef<HTMLInputElement>(null);
  const confirmation = useConfirmation();
  const selected = notes.find((note) => note.id === selectedId);
  const dirty = Boolean(selected && (selected.title !== draft.title || selected.markdown !== draft.markdown || projectNoteFormat(selected.format) !== draft.format || selected.visibility !== draft.visibility || selected.format === "CSV" && (noteDelimiter(selected.markdown, selected.format, selected.delimiter) !== draft.delimiter || !delimiterValid)));
  const filtered = useMemo(() => notes.filter((note) => noteFileName(note.title, projectNoteFormat(note.format)).toLocaleLowerCase().includes(search.toLocaleLowerCase())), [notes, search]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(undefined); setNotes([]); setSelectedId(undefined); setDraft(emptyDraft());
    void browserApiRequest<ProjectNoteCollection>(notesPath(projectId), { signal: controller.signal }).then((collection) => {
      if (controller.signal.aborted) return;
      setNotes(collection.notes); const first = collection.notes[0]; setSelectedId(first?.id); setDraft(first ? fromNote(first) : emptyDraft()); setDelimiterValid(true);
    }).catch((caught: unknown) => { if (!controller.signal.aborted) setError(errorMessage(caught)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, revision]);
  async function leaveDraft() { return !dirty || await confirmation.confirm({ title: "Отменить несохранённые изменения?", description: "Внесённые изменения будут потеряны", confirmLabel: "Отменить изменения" }); }
  async function select(note: ProjectNoteSummary) { if (busy || !await leaveDraft()) return; setMobileListOpen(false); setSelectedId(note.id); setDraft(fromNote(note)); setDelimiterValid(true); setView("edit"); setError(undefined); setNotice(undefined); }
  async function createFile() { if (busy || !await leaveDraft()) return; setNewDraft(emptyDraft()); setNewDelimiterValid(true); setCreateError(undefined); setCreateOpen(true); }
  async function persist(input: NoteDraft, current?: ProjectNoteSummary) {
    if (!canEdit || busy) return;
    if (!input.title.trim()) { if (current) setError("Введите имя файла."); else setCreateError("Введите имя файла."); return; }
    setBusy(true); setError(undefined); setNotice(undefined); setCreateError(undefined);
    try {
      const saved = await browserApiRequest<ProjectNoteSummary>(current ? `${notesPath(projectId)}/${current.id}` : notesPath(projectId), { method: current ? "PATCH" : "POST", ...(current ? { ifMatch: current.version } : {}), body: { ...input, markdown: !current && !input.markdown ? input.format === "CSV" ? `${input.delimiter ?? ","}\n${input.delimiter ?? ","}` : input.format === "TSV" ? "\t\n\t" : input.format === "JSON" ? "{}" : "" : input.markdown } });
      setNotes((all) => [saved, ...all.filter((note) => note.id !== saved.id)]); setSelectedId(saved.id); setDraft(fromNote(saved)); setDelimiterValid(true); setCreateOpen(false); setView("edit"); setNotice("Файл сохранён.");
    } catch (caught) { const message = errorMessage(caught); if (createOpen) setCreateError(message); else setError(message); } finally { setBusy(false); }
  }
  async function removeFile() {
    if (!selected || !await confirmation.confirm({ title: "Удалить файл?", description: noteFileName(selected.title, selected.format), confirmLabel: "Удалить" })) return;
    setBusy(true); setError(undefined);
    try { await browserApiRequest(`${notesPath(projectId)}/${selected.id}`, { method: "DELETE", ifMatch: selected.version }); const remaining = notes.filter((note) => note.id !== selected.id); setNotes(remaining); setSelectedId(remaining[0]?.id); setDraft(remaining[0] ? fromNote(remaining[0]) : emptyDraft()); setDelimiterValid(true); }
    catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  async function copyLink() { if (!selected?.publicToken) return; try { await navigator.clipboard.writeText(`${location.origin}/notes/${selected.publicToken}`); setNotice("Публичная ссылка скопирована."); } catch { setError("Не удалось скопировать ссылку."); } }
  function download() { if (selected) downloadNoteFile(draft.title, draft.markdown, draft.format); }
  function resize(event: PointerEvent<HTMLDivElement>) { event.preventDefault(); const initial = sidebarWidth, start = event.clientX; const move = (pointer: globalThis.PointerEvent) => setSidebarWidth(Math.max(190, Math.min(420, initial + pointer.clientX - start))); const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop, { once: true }); window.addEventListener("pointercancel", stop, { once: true }); }
  return <section className={styles.workspace}>
    <header className={styles.topbar}>{heading}<button className={`secondary-button ${styles.mobileButton}`} aria-label={t("Файлы проекта")} onClick={() => setMobileListOpen(!mobileListOpen)} type="button"><Icon name="list" /><UiText text="Файлы" /></button><span className={styles.count}>{notes.length} <UiText text="файлов" /></span>{canEdit && <><button className="secondary-button" disabled={busy} onClick={() => uploadRef.current?.click()} type="button"><Icon name="import" /><UiText text="Загрузить файл" /></button><input className="visually-hidden" ref={uploadRef} type="file" accept=".md,.txt,.csv,.tsv,.json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(async (content) => { if (!await leaveDraft()) return; const extension = file.name.split(".").at(-1)?.toLowerCase(), format = projectNoteFormats.find((value) => noteFileExtensions[value] === extension) ?? "TEXT"; setNewDelimiterValid(true); setNewDraft({ title: file.name.replace(/\.[^.]+$/u, ""), markdown: content, format, ...(format === "CSV" ? { delimiter: noteDelimiter(content, format) } : {}), visibility: "PROJECT_MEMBERS" }); setCreateOpen(true); }).catch(() => setError("Не удалось прочитать файл.")); event.target.value = ""; }} /><button className="primary-button" disabled={busy} onClick={() => void createFile()} type="button"><Icon name="plus" /><UiText text="Новый файл" /></button></>}</header>
    <div className={`${styles.layout}${mobileListOpen ? ` ${styles.listOpen}` : ""}`} style={{ "--notes-sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <WorkspaceSidebar className={styles.sidebar} aria-label={t("Файлы проекта")}><header><strong><UiText text="Файлы" /></strong><span>{notes.length}</span></header><div className={styles.search}><Icon name="search" /><input type="search" aria-label={t("Найти файл")} placeholder={t("Найти файл")} value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className={styles.files}>{loading ? <p role="status"><UiText text="Загрузка…" /></p> : filtered.length === 0 ? <p className={styles.muted}><UiText text={notes.length ? "Файлы не найдены." : "Файлов пока нет."} /></p> : filtered.map((note) => <button className={note.id === selectedId ? styles.activeFile : undefined} disabled={busy} key={note.id} onClick={() => void select(note)} type="button"><Icon name={tabularNote(note.format) ? "semantic" : "note"} /><span>{noteFileName(note.title, note.format)}</span>{note.visibility === "PUBLIC" && <Icon name="link" />}</button>)}</div></WorkspaceSidebar>
      <WorkspaceSidebarSeparator aria-label={t("Изменить ширину списка файлов")} aria-valuemin={190} aria-valuemax={420} aria-valuenow={sidebarWidth} onPointerDown={resize} onDoubleClick={() => setSidebarWidth(248)} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); setSidebarWidth((value) => Math.max(190, Math.min(420, value + (event.key === "ArrowRight" ? 12 : -12)))); } }} />
      <article className={styles.editor}>{error && <div className={styles.error} role="alert">{error}<button className="text-button" onClick={() => { void leaveDraft().then((allowed) => { if (allowed) setRevision((value) => value + 1); }); }} type="button"><UiText text="Обновить" /></button></div>}{notice && !dirty && <p className={styles.notice} role="status">{notice}</p>}
      {selected ? <><header className={styles.filebar}><input aria-label={t("Имя файла")} disabled={!canEdit || busy} maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><span className={styles.extension}>.{noteFileExtensions[draft.format]}</span>{draft.format === "CSV" && <CsvDelimiterControl key={selected.id} value={draft.delimiter ?? ","} disabled={!canEdit || busy} onValidityChange={setDelimiterValid} onChange={delimiter => { try { setDraft(changeDelimiter(draft, delimiter)); setError(undefined); } catch { setDelimiterValid(false); setError("Не удалось сменить разделитель: проверьте кавычки в исходном тексте."); } }} />}<div className={styles.tabs} role="tablist" aria-label={t("Режим файла")}>{([["edit", tabularNote(draft.format) ? "Таблица" : "Редактор"], ...(tabularNote(draft.format) ? [["source", "Исходный текст"]] : []), ["preview", "Предпросмотр"]] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={view === key} onClick={() => setView(key as typeof view)} type="button"><UiText text={label} /></button>)}</div><CustomSelect aria-label={t("Доступ к файлу")} value={draft.visibility} disabled={!canEdit || busy} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as ProjectNoteVisibility })}><option value="PROJECT_MEMBERS"><UiText text="Только участники" /></option><option value="PUBLIC"><UiText text="Все по ссылке" /></option></CustomSelect></header>
      <div className={styles.content} role="tabpanel">{view === "preview" ? <ProjectNoteDocument content={draft.markdown} format={draft.format} delimiter={draft.delimiter} /> : tabularNote(draft.format) && view === "edit" ? <SpreadsheetEditor key={`${selected.id}:${draft.delimiter ?? ""}`} content={draft.markdown} format={draft.format} delimiter={draft.delimiter} readOnly={!canEdit || busy} onChange={(markdown) => setDraft(current => ({ ...current, markdown }))} /> : <textarea className={styles.textarea} aria-label={t("Содержимое файла")} disabled={!canEdit || busy} value={draft.markdown} spellCheck={draft.format === "TEXT"} onChange={(event) => setDraft({ ...draft, markdown: event.target.value })} />}</div>
      <footer className={styles.footer}><span>{dirty ? <UiText text="Изменено" /> : new Date(selected.updatedAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</span><button className="secondary-button" onClick={download} type="button"><Icon name="export" /><UiText text="Скачать" /></button>{selected.publicToken && selected.visibility === "PUBLIC" && <><button className="secondary-button" onClick={() => void copyLink()} type="button"><Icon name="link" /><UiText text="Копировать ссылку" /></button><a className="secondary-button" href={`/notes/${selected.publicToken}`} target="_blank" rel="noopener noreferrer"><UiText text="Открыть" /></a></>}{canEdit && <><button className="text-button" disabled={busy} onClick={() => void removeFile()} type="button"><Icon name="trash" /><UiText text="Удалить" /></button><button className={`primary-button ${styles.save}`} disabled={busy || !dirty || !draft.title.trim() || !delimiterValid} onClick={() => void persist(draft, selected)} type="button"><UiText text={busy ? "Сохраняем…" : "Сохранить"} /></button></>}</footer></> : !loading && <div className={styles.empty}><Icon name="note" /><h2><UiText text="Создайте первый файл" /></h2>{canEdit && <button className="primary-button" disabled={busy} onClick={() => void createFile()} type="button"><UiText text="Новый файл" /></button>}</div>}
      </article>
    </div>
    {createOpen && <SemanticModal title="Новый файл" onClose={() => setCreateOpen(false)} closeDisabled={busy} footer={<div className={styles.createActions}><button className="secondary-button" disabled={busy} onClick={() => setCreateOpen(false)} type="button"><UiText text="Отмена" /></button><button className="primary-button" disabled={busy || !newDraft.title.trim() || !newDelimiterValid} onClick={() => void persist(newDraft)} type="button"><UiText text={busy ? "Создаём…" : "Создать"} /></button></div>}><div className={styles.createForm}><FormField label="Имя файла" error={createError}><input autoFocus value={newDraft.title} maxLength={160} onChange={(event) => setNewDraft({ ...newDraft, title: event.target.value })} /></FormField><FormField label="Формат файла"><CustomSelect value={newDraft.format} onChange={event => { const format = event.target.value as ProjectNoteFormat; setNewDelimiterValid(true); const { delimiter: _old, ...rest } = newDraft; setNewDraft({ ...rest, format, ...(format === "CSV" ? { delimiter: noteDelimiter(newDraft.markdown, format) } : {}) }); }}>{projectNoteFormats.map((format) => <option key={format} value={format}>.{noteFileExtensions[format]}{format === "MARKDOWN" ? " · Markdown" : format === "TEXT" ? t(" · Текст") : ""}</option>)}</CustomSelect></FormField>{newDraft.format === "CSV" && <FormField label="Разделитель"><CsvDelimiterControl key={newDraft.format} value={newDraft.delimiter ?? ","} disabled={busy} onValidityChange={setNewDelimiterValid} onChange={delimiter => setNewDraft(current => ({ ...current, delimiter }))} /></FormField>}<small>{noteFileName(newDraft.title, newDraft.format)}</small></div></SemanticModal>}
    {confirmation.dialog}
  </section>;
}
export function MarkdownDocument({ markdown }: Readonly<{ markdown: string }>) { return <ProjectNoteDocument content={markdown} format="MARKDOWN" />; }
function notesPath(projectId: string) { return `/app/api/projects/${encodeURIComponent(projectId)}/notes`; }
function fromNote(note: ProjectNoteSummary): NoteDraft { return { title: note.title, markdown: note.markdown, format: projectNoteFormat(note.format), ...(note.format === "CSV" ? { delimiter: noteDelimiter(note.markdown, note.format, note.delimiter) } : {}), visibility: note.visibility }; }
function errorMessage(error: unknown) { return error instanceof BrowserApiError ? error.status === 409 ? "Файл изменён в другой вкладке. Обновите страницу перед сохранением." : error.message : "Не удалось выполнить операцию с файлом."; }

function changeDelimiter(draft: NoteDraft, delimiter: string): NoteDraft {
  const previous = noteDelimiter(draft.markdown, draft.format, draft.delimiter);
  return { ...draft, delimiter, markdown: previous === delimiter || !draft.markdown ? draft.markdown : serializeDelimitedRows(parseDelimitedRows(draft.markdown, previous), delimiter) };
}
