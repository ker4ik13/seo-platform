"use client";

import { technicalCrawlHomepageProbeUrls, technicalCrawlRequestTimeoutMs, technicalCrawlMaxResponseBytes, type TechnicalCrawlHomepageCheck, type TechnicalCrawlPurpose, type TechnicalCrawlQueryPolicy, type TechnicalCrawlSettings, type TechnicalCrawlSummary, type ProjectPageSummary } from "@seo-platform/contracts";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AppProject } from "../lib/app-types";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { projectPageApiPath, projectPagesReturnTo } from "../lib/project-pages";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { ProjectSelect } from "./project-select";
import { CrawlProgressPanel } from "./crawl-progress-panel";
import styles from "./http-status-check-tool.module.css";
import { UiText, useUiLocale } from "./ui-locale";

type ScopeMode = "FULL_SITE" | "URL_LIST" | "SECTION" | "SITEMAP";
const PAGE_LIMIT_PRESETS = [100, 250, 500, 1_000, 2_500, 5_000] as const;
const SPEEDS = [{ value: "0.1", label: "0,1 страницы/с", rpm: 6 }, { value: "0.25", label: "0,25 страницы/с", rpm: 15 }, { value: "0.5", label: "0,5 страницы/с", rpm: 30 }, { value: "1", label: "1 страница/с", rpm: 60 }, { value: "2", label: "2 страницы/с", rpm: 120 }, { value: "3", label: "3 страницы/с", rpm: 180 }, { value: "4", label: "4 страницы/с", rpm: 240 }] as const;

export function HttpStatusCheckTool({ canReorderProjects, project, projects, workspaceId }: Readonly<{ canReorderProjects: boolean; project: AppProject; projects: readonly AppProject[]; workspaceId: string }>) {
  const { locale, t } = useUiLocale();
  const rootUrl = useMemo(() => projectRootUrl(project.domain), [project.domain]);
  const [settings, setSettings] = useState<TechnicalCrawlSettings>();
  const [purpose, setPurpose] = useState<TechnicalCrawlPurpose>("TECHNICAL_AUDIT");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("FULL_SITE");
  const [urlList, setUrlList] = useState(rootUrl);
  const [sectionUrl, setSectionUrl] = useState(rootUrl);
  const [maxUrls, setMaxUrls] = useState("250");
  const [speed, setSpeed] = useState("0.5");
  const [followLinks, setFollowLinks] = useState(true);
  const [maxDepth, setMaxDepth] = useState("5");
  const [useSitemap, setUseSitemap] = useState(true);
  const [savePageMap, setSavePageMap] = useState(true);
  const [checkHttpRedirect, setCheckHttpRedirect] = useState(false);
  const [checkWwwRedirect, setCheckWwwRedirect] = useState(false);
  const [checkMultipleSlashes, setCheckMultipleSlashes] = useState(false);
  const [sitemapUrls, setSitemapUrls] = useState(rootUrl + "sitemap.xml");
  const [queryPolicy, setQueryPolicy] = useState<TechnicalCrawlQueryPolicy>("DROP_TRACKING");
  const [includePatterns, setIncludePatterns] = useState("");
  const [excludePatterns, setExcludePatterns] = useState("");
  const [conditionalRequests, setConditionalRequests] = useState(true);
  const [respectNofollow, setRespectNofollow] = useState(false);
  const [requestTimeoutSeconds, setRequestTimeoutSeconds] = useState(String(technicalCrawlRequestTimeoutMs / 1_000));
  const [maxResponseMb, setMaxResponseMb] = useState(String(technicalCrawlMaxResponseBytes / 1_000_000));
  const [maxRedirects, setMaxRedirects] = useState("5");
  const [runtimeMinutes, setRuntimeMinutes] = useState("60");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const [activeCrawl, setActiveCrawl] = useState<TechnicalCrawlSummary>();

  useEffect(() => {
    const controller = new AbortController();
    setSettings(undefined); setActiveCrawl(undefined); setError(undefined);
    void (async () => { try {
      const next = await browserApiRequest<TechnicalCrawlSettings>(crawlPath(project.id), { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSettings(next);
      if (next.runtimeLimits) {
        setRequestTimeoutSeconds((old) => String(Math.min(Number(old), next.runtimeLimits!.requestTimeoutMs / 1_000)));
        setMaxResponseMb((old) => String(Math.min(Number(old), next.runtimeLimits!.maxResponseBytes / 1_000_000)));
        setMaxRedirects((old) => String(Math.min(Number(old), next.runtimeLimits!.maxRedirects)));
      }
      const params = new URLSearchParams(window.location.search), requestedCrawl = params.get("crawlId");
      const running = next.crawls.find((crawl) => crawl.id === requestedCrawl) ?? next.crawls.find((crawl) => ["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(crawl.status));
      if (running) setActiveCrawl(running);
    } catch (caught: unknown) { if (!controller.signal.aborted) setError(errorMessage(caught)); } })();
    return () => controller.abort();
  }, [project.id]);

  useEffect(() => {
    setUrlList(rootUrl); setSectionUrl(rootUrl); setSitemapUrls(rootUrl + "sitemap.xml");
    const pageId = new URLSearchParams(window.location.search).get("pageId");
    if (!pageId || !/^[0-9a-f-]{36}$/iu.test(pageId)) return;
    const controller = new AbortController();
    void browserApiRequest<ProjectPageSummary>(projectPageApiPath(project.id, pageId), { signal: controller.signal }).then((page) => {
      if (!controller.signal.aborted) { setScopeMode("URL_LIST"); setUrlList(page.normalizedUrl); setMaxUrls("1"); setFollowLinks(false); setUseSitemap(false); setCheckHttpRedirect(false); setCheckWwwRedirect(false); setCheckMultipleSlashes(false); }
    }).catch((caught: unknown) => { if (!controller.signal.aborted) setError(errorMessage(caught)); });
    return () => controller.abort();
  }, [project.id, rootUrl]);

  const parsedUrls = useMemo(() => parseUrlList(scopeMode === "URL_LIST" ? urlList : scopeMode === "SECTION" ? sectionUrl : rootUrl), [rootUrl, scopeMode, urlList, sectionUrl]);
  const maxUrlNumber = Number(maxUrls);
  const canRun = settings?.access.canRun === true;
  const homepageChecks = purpose === "HTTP_STATUS_CHECK" ? selectedHomepageChecks({ checkHttpRedirect, checkWwwRedirect, checkMultipleSlashes }) : [];
  const configuredSeedCount = new Set([...parsedUrls.urls, ...technicalCrawlHomepageProbeUrls(parsedUrls.urls[0] ?? rootUrl, homepageChecks)]).size;
  const estimatedMinutes = Math.ceil(maxUrlNumber / Number(speed) / 60);
  const limits = settings?.runtimeLimits;

  function changeScopeMode(next: ScopeMode) {
    setScopeMode(next); setFollowLinks(next === "FULL_SITE" || next === "SECTION"); setUseSitemap(next === "FULL_SITE" || next === "SITEMAP");
    if (next === "URL_LIST") { setCheckHttpRedirect(false); setCheckWwwRedirect(false); setCheckMultipleSlashes(false); }
  }
  function changePurpose(next: TechnicalCrawlPurpose) { setPurpose(next); setConditionalRequests(next === "TECHNICAL_AUDIT"); }
  async function importFile(file: File | undefined) {
    if (!file) return; setError(undefined);
    if (file.size > 1_000_000) { setError("Максимальный размер списка — 1 МБ."); return; }
    const urls = extractUrls(await file.text());
    if (!urls.length) { setError("В файле не найдены HTTP- или HTTPS-адреса."); return; }
    changeScopeMode("URL_LIST"); setUrlList(urls.join("\n")); setFileName(file.name);
    if (urls.length > maxUrlNumber) setMaxUrls(String(Math.min(5_000, urls.length)));
  }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !canRun) return; setError(undefined);
    try {
      if (parsedUrls.invalid.length || !parsedUrls.urls.length || parsedUrls.urls.length > 1_000) throw new Error("Нужны от 1 до 1 000 корректных стартовых URL.");
      const startUrls = parsedUrls.urls, origin = new URL(startUrls[0]!).origin;
      if (startUrls.some((url) => new URL(url).hostname !== new URL(rootUrl).hostname || new URL(url).origin !== origin)) throw new Error("Все стартовые URL должны быть одного протокола и домена проекта.");
      if (!Number.isSafeInteger(maxUrlNumber) || maxUrlNumber < configuredSeedCount || maxUrlNumber > 5_000) throw new Error("Лимит страниц должен вмещать стартовые URL и проверки главной, максимум — 5 000.");
      const paths = scopeMode === "SECTION" && !includePatterns.trim() ? [new URL(startUrls[0]!).pathname.replace(/\/$/u, "") + "/**"] : patternList(includePatterns);
      setBusy(true);
      const crawl = await browserApiRequest<TechnicalCrawlSummary>(crawlPath(project.id), { method: "POST", idempotencyKey: "crawl:" + globalThis.crypto.randomUUID(), body: {
        purpose, startUrls, ...(homepageChecks.length ? { homepageChecks } : {}), sitemapUrls: useSitemap ? normalizedSitemaps(sitemapUrls, origin) : [],
        includePatterns: paths, excludePatterns: patternList(excludePatterns), queryPolicy, maxUrls: maxUrlNumber, maxDepth: followLinks ? Number(maxDepth) : 0,
        maxRuntimeSeconds: Number(runtimeMinutes) * 60, requestsPerMinute: SPEEDS.find((item) => item.value === speed)!.rpm, obeyRobots: true, savePageMap,
        conditionalRequests, respectNofollow, requestTimeoutMs: Math.round(Number(requestTimeoutSeconds) * 1_000), maxResponseBytes: Math.round(Number(maxResponseMb) * 1_000_000), maxRedirects: Number(maxRedirects)
      } });
      setActiveCrawl(crawl);
      const nextUrl = new URL(window.location.href); nextUrl.searchParams.set("crawlId", crawl.id); nextUrl.searchParams.delete("pageId"); window.history.replaceState(null, "", nextUrl);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }

  return <div className={styles.workspace}><header className={styles.hero}><div><h1><UiText text="Обход сайта" /></h1><small>{project.name} · {project.domain}</small></div><a className="secondary-button" href={projectPagesReturnTo(project.id)}><Icon name="pages" /><UiText text="Карта страниц" /></a></header>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {activeCrawl ? <CrawlProgressPanel key={activeCrawl.id} initial={activeCrawl} projectId={project.id} canStop={canRun} onNew={() => { setActiveCrawl(undefined); const url = new URL(window.location.href); url.searchParams.delete("crawlId"); window.history.replaceState(null, "", url); }} /> : <form className={styles.layout} onSubmit={(event) => void start(event)}><div className={styles.mainColumn}>
      <section className={styles.panel}><h2><UiText text="Что проверять" /></h2><div className={styles.segmented} role="group" aria-label={t("Режим обхода")}><button aria-pressed={purpose === "TECHNICAL_AUDIT"} onClick={() => changePurpose("TECHNICAL_AUDIT")} type="button"><UiText text="SEO-анализ" /></button><button aria-pressed={purpose === "HTTP_STATUS_CHECK"} onClick={() => changePurpose("HTTP_STATUS_CHECK")} type="button"><UiText text="HTTP-проверка" /></button></div>
        <label className={styles.field}><span><UiText text="Проект" /></span><ProjectSelect ariaLabel={t("Проект для обхода")} canReorder={canReorderProjects} onChange={(id) => window.location.assign("/app/projects/" + encodeURIComponent(id) + "/tools/http-status-checker")} projects={projects} value={project.id} workspaceId={workspaceId} /></label>
        <div className={styles.twoColumns}><label className={styles.field}><span><UiText text="Источник URL" /></span><CustomSelect value={scopeMode} onChange={(event) => changeScopeMode(event.target.value as ScopeMode)}><option value="FULL_SITE"><UiText text="Весь сайт" /></option><option value="SECTION"><UiText text="Раздел сайта" /></option><option value="SITEMAP"><UiText text="Только sitemap" /></option><option value="URL_LIST"><UiText text="Список URL" /></option></CustomSelect></label>
          {scopeMode !== "URL_LIST" && <label className={styles.field}><span><UiText text="Стартовый URL" /></span><input required value={scopeMode === "SECTION" ? sectionUrl : rootUrl} readOnly={scopeMode !== "SECTION"} onChange={(event) => setSectionUrl(event.target.value)} type="url" /></label>}</div>
        {scopeMode === "URL_LIST" && <><label className={styles.field}><span><UiText text="URL — по одному в строке" /></span><textarea value={urlList} rows={5} onChange={(event) => setUrlList(event.target.value)} /><small>{parsedUrls.urls.length} / 1 000</small></label><label className={styles.fileButton}><Icon name="import" /><span>{fileName ?? t("Загрузить TXT / CSV / TSV")}</span><input accept=".txt,.csv,.tsv,text/plain,text/csv" onChange={(event) => void importFile(event.target.files?.[0])} type="file" /></label></>}
        {useSitemap && <label className={styles.field}><span><UiText text="Sitemap URL — до 10" /></span><textarea value={sitemapUrls} onChange={(event) => setSitemapUrls(event.target.value)} rows={2} /></label>}
      </section>
      <section className={styles.panel}><h2><UiText text="Пределы обхода" /></h2><div className={styles.presetRow}>{PAGE_LIMIT_PRESETS.map((value) => <button aria-pressed={maxUrls === String(value)} key={value} onClick={() => setMaxUrls(String(value))} type="button">{value.toLocaleString(locale)}</button>)}</div><div className={styles.twoColumns}><label className={styles.field}><span><UiText text="Лимит страниц" /></span><input min={Math.max(1, configuredSeedCount)} max={5000} required type="number" value={maxUrls} onChange={(event) => setMaxUrls(event.target.value)} /></label><label className={styles.field}><span><UiText text="Скорость на домен" /></span><CustomSelect value={speed} onChange={(event) => setSpeed(event.target.value)}>{SPEEDS.map((item) => <option value={item.value} key={item.value}><UiText text={item.label} /></option>)}</CustomSelect></label></div>
        <label className={styles.checkbox}><input checked={savePageMap} onChange={(event) => setSavePageMap(event.target.checked)} type="checkbox" /><span><UiText text="Сохранить страницы и данные в карту" /></span></label><label className={styles.checkbox}><input checked={followLinks} onChange={(event) => setFollowLinks(event.target.checked)} type="checkbox" /><span><UiText text="Находить страницы по внутренним ссылкам" /></span></label><label className={styles.checkbox}><input checked={useSitemap} onChange={(event) => setUseSitemap(event.target.checked)} type="checkbox" /><span><UiText text="Использовать sitemap" /></span></label>
      </section>
      <details className={styles.advanced}><summary><span><strong><UiText text="Глубина, пути и параметры URL" /></strong></span><Icon name="chevronDown" /></summary><div className={styles.advancedBody}><div className={styles.twoColumns}><label className={styles.field}><span><UiText text="Глубина обхода" /></span><input min={0} max={10} required disabled={!followLinks} type="number" value={maxDepth} onChange={(event) => setMaxDepth(event.target.value)} /></label><label className={styles.field}><span><UiText text="Параметры URL" /></span><CustomSelect value={queryPolicy} onChange={(event) => setQueryPolicy(event.target.value as TechnicalCrawlQueryPolicy)}><option value="DROP_TRACKING"><UiText text="Убирать tracking-параметры" /></option><option value="DROP_ALL"><UiText text="Убирать все параметры" /></option><option value="PRESERVE"><UiText text="Сохранять параметры" /></option></CustomSelect></label><label className={styles.field}><span><UiText text="Включить пути" /></span><textarea placeholder="/services/**" rows={3} value={includePatterns} onChange={(event) => setIncludePatterns(event.target.value)} /></label><label className={styles.field}><span><UiText text="Исключить пути" /></span><textarea placeholder="/cart/**" rows={3} value={excludePatterns} onChange={(event) => setExcludePatterns(event.target.value)} /></label></div><label className={styles.checkbox}><input checked={respectNofollow} onChange={(event) => setRespectNofollow(event.target.checked)} type="checkbox" /><span><UiText text="Не переходить по ссылкам со страниц с nofollow" /></span></label></div></details>
      <details className={styles.advanced}><summary><span><strong><UiText text="Сеть и повторные проверки" /></strong></span><Icon name="chevronDown" /></summary><div className={styles.advancedBody}><label className={styles.checkbox}><input checked={conditionalRequests} onChange={(event) => setConditionalRequests(event.target.checked)} type="checkbox" /><span><UiText text="Использовать ETag / Last-Modified для неизменённых страниц" /></span></label><div className={styles.twoColumns}><label className={styles.field}><span><UiText text="Таймаут запроса, секунды" /></span><input required type="number" min={1} max={(limits?.requestTimeoutMs ?? 30000) / 1000} value={requestTimeoutSeconds} onChange={(event) => setRequestTimeoutSeconds(event.target.value)} /></label><label className={styles.field}><span><UiText text="Максимальный ответ, МБ" /></span><input required type="number" step="0.1" min={.1} max={(limits?.maxResponseBytes ?? 4194304) / 1000000} value={maxResponseMb} onChange={(event) => setMaxResponseMb(event.target.value)} /></label><label className={styles.field}><span><UiText text="Максимум редиректов" /></span><input required type="number" min={0} max={limits?.maxRedirects ?? 10} value={maxRedirects} onChange={(event) => setMaxRedirects(event.target.value)} /></label><label className={styles.field}><span><UiText text="Лимит времени, минуты" /></span><input required type="number" min={1} max={360} value={runtimeMinutes} onChange={(event) => setRuntimeMinutes(event.target.value)} /></label></div></div></details>
      {purpose === "HTTP_STATUS_CHECK" && <details className={styles.advanced}><summary><span><strong><UiText text="Проверки редиректов главной" /></strong></span><Icon name="chevronDown" /></summary><div className={styles.advancedBody}>{([[checkHttpRedirect, setCheckHttpRedirect, "HTTP → HTTPS"], [checkWwwRedirect, setCheckWwwRedirect, "WWW-версия"], [checkMultipleSlashes, setCheckMultipleSlashes, "Лишние слеши // … /////"]] as const).map(([checked, setter, label]) => <label className={styles.checkbox} key={label}><input checked={checked} onChange={(event) => setter(event.target.checked)} type="checkbox" /><span><UiText text={label} /></span></label>)}</div></details>}
    </div><aside className={styles.summary}><h2><UiText text="Настройки запуска" /></h2><dl>{[[t("Проект"), project.name], [t("Домен"), project.domain], [t("Режим"), purpose === "TECHNICAL_AUDIT" ? t("SEO-анализ") : t("HTTP-проверка")], [t("Лимит"), maxUrls + " URL"], [t("Скорость"), t(SPEEDS.find((item) => item.value === speed)?.label ?? "—")], [t("Время"), runtimeMinutes + " мин"], ["Robots.txt", t("Соблюдать")], ["JavaScript", t("Не исполнять")]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{estimatedMinutes > Number(runtimeMinutes) && <p className={styles.restriction}><UiText text="Выбранной скорости не хватит, чтобы обработать весь лимит страниц за указанное время." /></p>}{settings && !canRun && <p className={styles.restriction}>{restrictionLabel(settings.access.mutationRestriction)}</p>}<button className="primary-button" disabled={busy || !canRun} type="submit">{busy ? <UiText text="Ставим в очередь…" /> : settings ? <><Icon name="play" /><UiText text="Запустить обход" /></> : <UiText text="Проверяем доступ…" />}</button></aside></form>}
  </div>;
}

function selectedHomepageChecks({
  checkHttpRedirect,
  checkMultipleSlashes,
  checkWwwRedirect
}: Readonly<{
  checkHttpRedirect: boolean;
  checkMultipleSlashes: boolean;
  checkWwwRedirect: boolean;
}>): readonly TechnicalCrawlHomepageCheck[] {
  return [
    ...(checkHttpRedirect ? ["HTTP_TO_HTTPS" as const] : []),
    ...(checkWwwRedirect ? ["WWW_CANONICAL" as const] : []),
    ...(checkMultipleSlashes ? ["MULTIPLE_SLASHES" as const] : [])
  ];
}

function crawlPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/crawls`;
}

function projectRootUrl(domain: string): string {
  const source = domain.trim();
  const url = new URL(/^https?:\/\//iu.test(source) ? source : `https://${source}`);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseUrlList(value: string): Readonly<{ urls: readonly string[]; invalid: readonly string[] }> {
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const item of value.split(/[\r\n]+/u).map((line) => line.trim()).filter(Boolean)) {
    try {
      const url = new URL(item);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("invalid");
      url.hash = "";
      const normalized = url.toString();
      if (!seen.has(normalized)) { seen.add(normalized); urls.push(normalized); }
    } catch {
      invalid.push(item);
    }
  }
  return { urls, invalid };
}

function extractUrls(value: string): readonly string[] {
  const matches = value.match(/https?:\/\/[^\s,;"'<>]+/giu) ?? [];
  return parseUrlList(matches.join("\n")).urls;
}

function normalizedSitemaps(value: string, origin: string): readonly string[] {
  const parsed = parseUrlList(value);
  if (parsed.invalid.length > 0 || parsed.urls.length > 10 || parsed.urls.some((url) => new URL(url).origin !== origin)) {
    throw new Error("Sitemap должен содержать до 10 корректных URL текущего проекта.");
  }
  return parsed.urls;
}

function patternList(value: string): readonly string[] {
  return [...new Set(value.split(/[\r\n,]+/u).map((item) => item.trim()).filter(Boolean))];
}

function restrictionLabel(value: TechnicalCrawlSettings["access"]["mutationRestriction"]): string {
  if (value === "WORKSPACE_READ_ONLY") return "Рабочая область доступна только для чтения.";
  if (value === "PROJECT_ARCHIVED") return "Архивный проект нельзя обходить.";
  if (value === "MISSING_PERMISSION") return "Недостаточно прав для запуска проверки.";
  return "Запуск временно недоступен.";
}

function errorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.status === 409) return "Для этого сайта уже выполняется обход. Дождитесь его завершения или остановите в операциях.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Не удалось запустить обход сайта.";
}
