"use client";

import { useEffect, useState, type ReactNode } from "react";
import { crawlIndexingDirectives, type ProjectPageSummary } from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { externalPageUrlPresentation } from "../lib/app-path";
import { projectPagesReturnTo } from "../lib/project-pages";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { UiText, useUiLocale } from "./ui-locale";
import styles from "./page-technical-panel.module.css";

export function PageFactList({ rows }: Readonly<{ rows: readonly (readonly [string, ReactNode])[] }>) {
  return <dl className={styles.facts}>{rows.map(([label, value]) => <div key={label}><dt><UiText text={label} /></dt><dd>{value}</dd></div>)}</dl>;
}
export function PageExternalUrl({ url }: Readonly<{ url: string | undefined }>) {
  const value = url ? externalPageUrlPresentation(url, 80) : undefined;
  return value ? <a className={styles.url} href={value.href} rel="noopener noreferrer" target="_blank">{url}</a> : <>—</>;
}
export function PageTechnicalNotice({ page }: Readonly<{ page: ProjectPageSummary }>) {
  const crawl = page.latestCrawl;
  const tags = crawl?.metaTags ?? [];
  if (crawl?.requestedUrl && crawl.finalUrl && crawl.requestedUrl !== crawl.finalUrl) return <div className={`${styles.notice} ${styles.warning}`} role="status"><strong><Icon name="link" /><UiText text="Целевой URL перенаправляет на другую страницу" /></strong><PageExternalUrl url={crawl.finalUrl} /></div>;
  const affected = (["googlebot", "yandex"] as const).filter((agent) => crawlIndexingDirectives(tags, agent).noindex);
  const text = crawl?.indexability === "BLOCKED_ROBOTS" ? "Обход запрещён в robots.txt" : affected.length === 2 ? "Целевая страница закрыта: noindex" : affected.length ? affected[0] === "googlebot" ? "Индексация запрещена для Google" : "Индексация запрещена для Яндекса" : crawl && crawl.statusCode >= 400 ? `Целевая страница отвечает ${crawl.statusCode}` : undefined;
  return text ? <div className={styles.notice} role="status"><strong><Icon name="warning" /><UiText text={text} /></strong></div> : null;
}

export function PageTechnicalFacts({ page, detailed = false }: Readonly<{ page: ProjectPageSummary; detailed?: boolean }>) {
  const { locale } = useUiLocale();
  const crawl = page.latestCrawl;
  const fetched = Boolean(crawl && crawl.statusCode > 0);
  const tags = crawl?.metaTags ?? [];
  const access = crawl?.technicalDetails?.robotsAccess;
  const canonical = crawl ? crawl.canonicalUrl : page.canonicalTarget;
  const blockedAgents = access?.filter((row) => row.agent !== "seoplatformcrawler" && !row.allowed).map((row) => row.agent === "googlebot" ? "Google" : "Яндекс");
  return <div className={styles.content}>
    <PageTechnicalNotice page={page} />
    <section className={styles.section}><h3><UiText text="Техническое состояние" /></h3>
      <PageFactList rows={[
        ["HTTP", fetched ? <span key="fact-1" className={`${styles.badge} ${crawl!.statusCode < 300 ? styles.good : crawl!.statusCode >= 400 ? styles.bad : styles.warning}`}>{crawl!.statusCode}</span> : <UiText key="fact-2" text="Не проверен" />],
        ["Robots.txt", access ? blockedAgents?.length ? `${blockedAgents.join(", ")}: запрещён` : access.find((row) => row.agent === "seoplatformcrawler")?.allowed ? <UiText key="fact-3" text="Разрешён" /> : <UiText key="fact-4" text="Обход запрещён" /> : <UiText key="fact-5" text="Не проверен" />],
        ["Canonical", fetched ? canonical ? <PageExternalUrl key="fact-6" url={canonical} /> : <UiText key="fact-7" text="Не задан" /> : <UiText key="fact-8" text="Не проверен" />],
        ["Последняя проверка", crawl ? new Date(crawl.crawledAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : <UiText key="fact-9" text="Не запускалась" />],
      ]} />
    </section>
    {detailed && (["YANDEX", "GOOGLE"] as const).map((engine) => {
      const agent = engine === "YANDEX" ? "yandex" : "googlebot", directives = crawlIndexingDirectives(tags, agent), rule = access?.find((row) => row.agent === agent);
      return <section className={styles.section} key={engine}><header className={styles.engine}><SearchEngineLogo engine={engine} size="compact" />{engine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}</header>
        <PageFactList rows={[
          ["Robots.txt", rule ? <span key="fact-10" className={`${styles.badge} ${rule.allowed ? styles.good : styles.warning}`}><UiText key="fact-11" text={rule.allowed ? "Разрешён" : "Запрещён"} /></span> : <UiText key="fact-12" text="Не проверен" />],
          ["Meta robots", fetched ? directives.meta.join("; ") || <UiText key="fact-13" text="Не задан" /> : <UiText key="fact-14" text="Не проверен" />],
          ["X-Robots-Tag", fetched && (crawl?.technicalDetails?.responseHeadersCaptured || directives.headers.length) ? directives.headers.join("; ") || <UiText key="fact-15" text="Не задан" /> : <UiText key="fact-16" text="Не проверен" />],
        ]} />
        {detailed && rule?.rule && <pre className={styles.code}>User-agent: {rule.group}{"\n"}{rule.rule}</pre>}
      </section>;
    })}
    {detailed && <>
      <section className={styles.section}><h3><UiText text="Мета и заголовки" /></h3>
        {fetched ? <><PageFactList rows={[["Title", crawl!.title || "—"], ["Description", crawl!.description || "—"], ["H1", crawl!.h1 || "—"], ["H1 на странице", crawl!.h1Count], ["Язык", crawl!.language || "—"]]} />
          {crawl!.headings?.length ? <details className={styles.raw}><summary><Icon name="chevronDown" /><UiText text="Структура заголовков" /></summary>{crawl!.headings.map((heading, index) => <article key={index}><strong>H{heading.level}</strong><span>{heading.text}</span></article>)}</details> : null}
        </> : <p className={styles.muted}><UiText text="Содержимое страницы не получено." /></p>}
      </section>
      <section className={styles.section}><h3><UiText text="Содержимое" /></h3>
        <PageFactList rows={[["Слов", fetched ? crawl!.wordCount.toLocaleString(locale) : "—"], ["Изображений", fetched ? crawl!.imageCount : "—"], ["Без alt", fetched ? crawl!.imagesMissingAlt : "—"], ["Микроразметка", fetched ? crawl!.structuredDataTypes.join(", ") || "—" : "—"], ["Размер", fetched ? `${(crawl!.sizeBytes / 1_024).toLocaleString(locale, { maximumFractionDigits: 1 })} КБ` : "—"], ["Ответ сервера", fetched ? `${crawl!.responseTimeMs} мс` : "—"]]} />
      </section>
      {crawl?.hreflang?.length ? <details className={styles.raw}><summary><Icon name="chevronDown" />Hreflang · {crawl.hreflang.length}</summary>{crawl.hreflang.map((value) => <article key={`${value.language}:${value.url}`}><strong>{value.language}</strong><PageExternalUrl url={value.url} /></article>)}</details> : null}
      {tags.length ? <details className={styles.raw}><summary><Icon name="chevronDown" /><UiText text="Все метатеги" /> · {tags.length}</summary>{tags.map((tag, index) => <article key={index}><strong>{tag.name ?? tag.property ?? tag.httpEquiv}{tag.source === "HTTP" ? " · HTTP" : ""}</strong><span>{tag.content}</span></article>)}</details> : null}
    </>}
  </div>;
}

type TargetPageState = Readonly<{ key?: string; page?: ProjectPageSummary; loading: boolean; error?: string }>;
export function useKeywordTargetPage(projectId: string, keywordId: string, targetUrl: string | undefined, enabled: boolean) {
  const key = `${projectId}:${keywordId}:${targetUrl ?? ""}`;
  const [state, setState] = useState<TargetPageState>({ loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    if (!targetUrl) { setState({ key, loading: false }); return; }
    const controller = new AbortController(); setState({ key, loading: true });
    void browserApiRequest<{ page?: ProjectPageSummary }>(`/app/api/projects/${encodeURIComponent(projectId)}/pages/by-keyword/${encodeURIComponent(keywordId)}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setState({ ...result, key, loading: false }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ key, loading: false, error: error instanceof BrowserApiError && error.status === 403 ? "Нет доступа к данным страницы." : "Не удалось загрузить данные страницы." }); });
    return () => controller.abort();
  }, [projectId, keywordId, targetUrl, revision, enabled, key]);
  return { state: state.key === key ? state : { loading: true }, refresh: () => setRevision((value) => value + 1) };
}

export function KeywordTargetPage({ projectId, targetUrl, state, onRefresh, detailed, onOpenDetails }: Readonly<{ projectId: string; targetUrl?: string | undefined; state: TargetPageState; onRefresh: () => void; detailed: boolean; onOpenDetails: () => void }>) {
  if (!targetUrl) return detailed ? <p className={styles.muted}><UiText text="Целевой URL не назначен." /></p> : null;
  return <div className={detailed ? styles.target : styles.compact}>
    {!detailed && <header><h3><UiText text="Целевая страница" /></h3><button aria-label="Открыть данные страницы" onClick={onOpenDetails} type="button"><Icon name="pages" /></button></header>}
    {state.loading ? <p className={styles.muted} role="status"><UiText text="Загружаем состояние страницы…" /></p> : state.error ? <><p role="alert">{state.error}</p><button className="secondary-button" onClick={onRefresh} type="button"><UiText text="Повторить" /></button></> : state.page ? detailed ? <>
      <PageTechnicalFacts page={state.page} detailed />
      <footer className={styles.actions}><a className="secondary-button" href={`${projectPagesReturnTo(projectId)}?pageId=${encodeURIComponent(state.page.id)}`}><Icon name="pages" /><UiText text="Открыть страницу" /></a><button className="secondary-button" onClick={onRefresh} type="button"><Icon name="refresh" /><UiText text="Обновить" /></button></footer>
    </> : <><PageTechnicalNotice page={state.page} /><button onClick={onOpenDetails} type="button"><span>{state.page.latestCrawl?.statusCode || "—"}</span><span className={styles.muted}>{state.page.latestCrawl ? new Date(state.page.latestCrawl.crawledAt).toLocaleDateString() : <UiText text="Не проверена" />}</span><Icon name="chevronRight" /></button></> : <><PageExternalUrl url={targetUrl} /><p className={styles.muted}><UiText text="Страница ещё не проверена." /></p></>}
  </div>;
}
