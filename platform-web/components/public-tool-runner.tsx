"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { PublicToolRenderer } from "../lib/tool-capabilities";
import {
  PUBLIC_KEYWORD_LIMIT,
  PUBLIC_KEYWORD_TEXT_LIMIT,
  cleanPublicKeywords,
  snippetLengthState
} from "../lib/public-tools";
import styles from "./public-tool-runner.module.css";

export function PublicToolRunner({
  renderer
}: Readonly<{ renderer: PublicToolRenderer }>) {
  return renderer === "KEYWORD_CLEANER" ? (
    <KeywordCleaner />
  ) : (
    <SnippetPreview />
  );
}

function KeywordCleaner() {
  const [source, setSource] = useState("");
  const [result, setResult] = useState<ReturnType<typeof cleanPublicKeywords>>();
  const [notice, setNotice] = useState<string>();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setResult(cleanPublicKeywords(source));
    setNotice(undefined);
  }

  async function copy(): Promise<void> {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.keywords.join("\n"));
      setNotice("Очищенные запросы скопированы.");
    } catch {
      setNotice("Браузер запретил доступ к буферу. Выделите результат вручную.");
    }
  }

  return (
    <form className={styles.runner} onSubmit={submit}>
      <label className={styles.field}>
        <span>Запросы — по одному в строке</span>
        <textarea
          maxLength={PUBLIC_KEYWORD_TEXT_LIMIT}
          onChange={(event) => setSource(event.currentTarget.value)}
          placeholder={"купить seo сервис\nкупить   SEO—сервис\nпроверка позиций"}
          required
          rows={10}
          value={source}
        />
        <small>
          До {PUBLIC_KEYWORD_LIMIT} уникальных строк. Нормализуются пробелы,
          кавычки, тире и Unicode; дубли сравниваются без учёта регистра.
        </small>
      </label>
      <div className={styles.actions}>
        <button className={styles.primary} type="submit">Очистить запросы</button>
        <button onClick={() => { setSource(""); setResult(undefined); setNotice(undefined); }} type="button">Сбросить</button>
      </div>
      {result && (
        <section aria-live="polite" className={styles.result}>
          <header>
            <div>
              <strong>Готово: {result.keywords.length}</strong>
              <span>
                Дублей: {result.duplicateRows} · пустых: {result.emptyRows}
                {result.truncatedRows > 0 ? ` · сверх лимита: ${result.truncatedRows}` : ""}
              </span>
            </div>
            <button disabled={result.keywords.length === 0} onClick={() => void copy()} type="button">Копировать</button>
          </header>
          <textarea aria-label="Очищенные запросы" readOnly rows={10} value={result.keywords.join("\n")} />
          {notice && <p role="status">{notice}</p>}
        </section>
      )}
    </form>
  );
}

function SnippetPreview() {
  const [title, setTitle] = useState("Пример заголовка страницы");
  const [description, setDescription] = useState("Короткое и понятное описание страницы для поисковой выдачи.");
  const [url, setUrl] = useState("https://example.com/catalog/page");
  const displayUrl = useMemo(() => safeDisplayUrl(url), [url]);
  const titleState = snippetLengthState(title, 60);
  const descriptionState = snippetLengthState(description, 160);

  return (
    <div className={styles.runner}>
      <div className={styles.snippetForm}>
        <label className={styles.field}>
          <span>Заголовок</span>
          <input maxLength={300} onChange={(event) => setTitle(event.currentTarget.value)} value={title} />
          <small className={titleState === "LONG" ? styles.warning : undefined}>{title.length} / 60 символов</small>
        </label>
        <label className={styles.field}>
          <span>Описание</span>
          <textarea maxLength={500} onChange={(event) => setDescription(event.currentTarget.value)} rows={4} value={description} />
          <small className={descriptionState === "LONG" ? styles.warning : undefined}>{description.length} / 160 символов</small>
        </label>
        <label className={styles.field}>
          <span>URL</span>
          <input inputMode="url" onChange={(event) => setUrl(event.currentTarget.value)} value={url} />
        </label>
      </div>
      <section aria-label="Предпросмотр поискового сниппета" className={styles.snippet}>
        <span>{displayUrl}</span>
        <h2>{title.trim() || "Заголовок страницы"}</h2>
        <p>{description.trim() || "Описание страницы появится здесь."}</p>
      </section>
      <p className={styles.note}>
        Это визуальный предпросмотр. Поисковая система может переписать title,
        description и отображаемый URL.
      </p>
    </div>
  );
}

function safeDisplayUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Некорректный URL";
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return value.trim() || "example.com";
  }
}
