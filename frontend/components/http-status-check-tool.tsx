"use client";

import {
  technicalCrawlHomepageProbeUrls,
  type TechnicalCrawlHomepageCheck,
  type TechnicalCrawlQueryPolicy,
  type TechnicalCrawlSettings,
  type TechnicalCrawlSummary
} from "@seo-platform/contracts";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AppProject } from "../lib/app-types";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { operationResultHref } from "../lib/operation-result-routes";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { ProjectSelect } from "./project-select";
import styles from "./http-status-check-tool.module.css";
import { UiText, useUiLocale } from "./ui-locale";


type ScopeMode = "FULL_SITE" | "URL_LIST";

const PAGE_LIMIT_PRESETS = [100, 250, 500, 1_000, 2_500, 5_000] as const;
const SPEEDS = [
  { value: "0.1", label: "0,1 страницы/с", rpm: 6 },
  { value: "0.25", label: "0,25 страницы/с", rpm: 15 },
  { value: "0.5", label: "0,5 страницы/с", rpm: 30 },
  { value: "1", label: "1 страница/с · максимум", rpm: 60 }
] as const;

export function HttpStatusCheckTool({
  canReorderProjects,
  project,
  projects,
  workspaceId
}: Readonly<{
  canReorderProjects: boolean;
  project: AppProject;
  projects: readonly AppProject[];
  workspaceId: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const rootUrl = useMemo(() => projectRootUrl(project.domain), [project.domain]);
  const [settings, setSettings] = useState<TechnicalCrawlSettings>();
  const [scopeMode, setScopeMode] = useState<ScopeMode>("FULL_SITE");
  const [urlList, setUrlList] = useState(rootUrl);
  const [maxUrls, setMaxUrls] = useState("250");
  const [speed, setSpeed] = useState("0.5");
  const [followLinks, setFollowLinks] = useState(true);
  const [maxDepth, setMaxDepth] = useState("5");
  const [useSitemap, setUseSitemap] = useState(true);
  const [savePageMap, setSavePageMap] = useState(true);
  const [checkHttpRedirect, setCheckHttpRedirect] = useState(true);
  const [checkWwwRedirect, setCheckWwwRedirect] = useState(true);
  const [checkMultipleSlashes, setCheckMultipleSlashes] = useState(true);
  const [sitemapUrls, setSitemapUrls] = useState(`${rootUrl}sitemap.xml`);
  const [queryPolicy, setQueryPolicy] =
    useState<TechnicalCrawlQueryPolicy>("DROP_TRACKING");
  const [includePatterns, setIncludePatterns] = useState("");
  const [excludePatterns, setExcludePatterns] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fileName, setFileName] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void browserApiRequest<TechnicalCrawlSettings>(crawlPath(project.id), {
      signal: controller.signal
    })
      .then(setSettings)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      });
    return () => controller.abort();
  }, [project.id]);

  const parsedUrls = useMemo(
    () => parseUrlList(scopeMode === "FULL_SITE" ? rootUrl : urlList),
    [rootUrl, scopeMode, urlList]
  );
  const maxUrlNumber = Number(maxUrls);
  const canRun = settings?.access.canRun === true;
  const homepageChecks = selectedHomepageChecks({
    checkHttpRedirect,
    checkWwwRedirect,
    checkMultipleSlashes
  });
  const configuredSeedCount = new Set([
    ...parsedUrls.urls,
    ...technicalCrawlHomepageProbeUrls(rootUrl, homepageChecks)
  ]).size;

  function selectProject(projectId: string): void {
    window.location.assign(
      `/app/projects/${encodeURIComponent(projectId)}/tools/http-status-checker`
    );
  }

  function changeScopeMode(next: ScopeMode): void {
    setScopeMode(next);
    if (next === "FULL_SITE") {
      setFollowLinks(true);
      setUseSitemap(true);
      return;
    }
    setFollowLinks(false);
    setUseSitemap(false);
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(undefined);
    if (file.size > 1_000_000) {
      setError("Файл слишком большой. Максимальный размер — 1 МБ.");
      return;
    }
    const text = await file.text();
    const urls = extractUrls(text);
    if (urls.length === 0) {
      setError("В файле не найдено ни одного HTTP- или HTTPS-адреса.");
      return;
    }
    changeScopeMode("URL_LIST");
    setUrlList(urls.join("\n"));
    setFileName(file.name);
    if (urls.length > maxUrlNumber) {
      setMaxUrls(String(Math.min(5_000, Math.max(100, urls.length))));
    }
  }

  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !canRun) return;
    setError(undefined);

    const startUrls = parsedUrls.urls;
    if (parsedUrls.invalid.length > 0) {
      setError(`Исправьте некорректные URL: ${parsedUrls.invalid.slice(0, 3).join(", ")}`);
      return;
    }
    if (startUrls.length === 0) {
      setError("Добавьте хотя бы один URL.");
      return;
    }
    if (startUrls.length > 1_000) {
      setError("За один запуск можно передать не более 1 000 стартовых URL.");
      return;
    }
    const projectOrigin = new URL(rootUrl).origin;
    const outside = startUrls.find((url) => new URL(url).origin !== projectOrigin);
    if (outside) {
      setError(`URL должен принадлежать проекту ${project.domain}: ${outside}`);
      return;
    }
    if (
      !Number.isSafeInteger(maxUrlNumber) ||
      maxUrlNumber < configuredSeedCount ||
      maxUrlNumber > 5_000
    ) {
      setError(
        `Лимит должен быть от ${configuredSeedCount} до 5 000 страниц с учётом проверок главной.`
      );
      return;
    }

    const selectedSpeed = SPEEDS.find(({ value }) => value === speed) ?? SPEEDS[2];
    const runtimeSeconds = Math.min(
      21_600,
      Math.max(600, Math.ceil(maxUrlNumber / Number(selectedSpeed.value)) + 600)
    );
    setBusy(true);
    try {
      const crawl = await browserApiRequest<TechnicalCrawlSummary>(
        crawlPath(project.id),
        {
          method: "POST",
          idempotencyKey: `http-status:${globalThis.crypto.randomUUID()}`,
          body: {
            purpose: "HTTP_STATUS_CHECK",
            startUrls,
            homepageChecks,
            sitemapUrls: useSitemap ? normalizedSitemaps(sitemapUrls, projectOrigin) : [],
            includePatterns: patternList(includePatterns),
            excludePatterns: patternList(excludePatterns),
            queryPolicy,
            maxUrls: maxUrlNumber,
            maxDepth: followLinks ? Number(maxDepth) : 0,
            maxRuntimeSeconds: runtimeSeconds,
            requestsPerMinute: selectedSpeed.rpm,
            obeyRobots: true,
            savePageMap
          }
        }
      );
      window.location.assign(operationResultHref("crawl", crawl.id));
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <form className={styles.workspace} onSubmit={(event) => void start(event)}>
      <section className={styles.hero}>
        <div className={styles.heroIcon}><Icon name="http" /></div>
        <div>
          <span><UiText text="Техническое SEO" /></span>
          <h1><UiText text="Обход сайта" /></h1>
          <p>
            <UiText text="Обход страниц из sitemap, стартового списка и внутренних ссылок. Цепочки редиректов и ответы сохраняются как отдельная операция." /></p>
        </div>
      </section>

      {error && <div className={styles.error} role="alert">{<UiText text={error ?? ""} />}</div>}

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={styles.panel}>
            <header>
              <span className={styles.step}>1</span>
              <div><h2><UiText text="Проект и источник URL" /></h2><p><UiText text="Можно обойти весь сайт или загрузить собственный список." /></p></div>
            </header>

            <label className={styles.field}>
              <span><UiText text="Проект" /></span>
              <ProjectSelect
                ariaLabel={uiText("Проект для обхода")}
                canReorder={canReorderProjects}
                onChange={selectProject}
                projects={projects}
                value={project.id}
                workspaceId={workspaceId}
              />
            </label>

            <div className={styles.segmented} role="radiogroup" aria-label={uiText("Источник URL")}>
              <button aria-pressed={scopeMode === "FULL_SITE"} onClick={() => changeScopeMode("FULL_SITE")} type="button">
                <UiText text="Весь сайт" /></button>
              <button aria-pressed={scopeMode === "URL_LIST"} onClick={() => changeScopeMode("URL_LIST")} type="button">
                <UiText text="Список URL" /></button>
            </div>

            {scopeMode === "FULL_SITE" ? (
              <div className={styles.siteScope}>
                <Icon name="sitemap" />
                <div><strong>{project.domain}</strong><span><UiText text="Sitemap + внутренние ссылки, начиная с главной" /></span></div>
              </div>
            ) : (
              <>
                <label className={styles.field}>
                  <span><UiText text="URL — по одному в строке" /></span>
                  <textarea
                    onChange={(event) => setUrlList(event.target.value)}
                    placeholder={`${rootUrl}\n${rootUrl}catalog/`}
                    rows={9}
                    value={urlList}
                  />
                  <small>{parsedUrls.urls.length} <UiText text="корректных URL · максимум 1 000" before=" " /></small>
                </label>
                <label className={styles.fileButton}>
                  <Icon name="import" />
                  <span>{fileName ? <UiText text="Загружен: {0}" values={[String(fileName)]} /> : <UiText text="Загрузить TXT или CSV" />}</span>
                  <input accept=".txt,.csv,text/plain,text/csv" onChange={(event) => void importFile(event.target.files?.[0])} type="file" />
                </label>
              </>
            )}
          </section>

          <section className={styles.panel}>
            <header>
              <span className={styles.step}>2</span>
              <div><h2><UiText text="Объём и скорость" /></h2><p><UiText text="Ограничения защищают сайт и очередь фоновых задач." /></p></div>
            </header>
            <div className={styles.presetRow}>
              {PAGE_LIMIT_PRESETS.map((value) => (
                <button aria-pressed={maxUrls === String(value)} key={value} onClick={() => setMaxUrls(String(value))} type="button">
                  {value.toLocaleString(uiLocale)}
                </button>
              ))}
            </div>
            <div className={styles.twoColumns}>
              <label className={styles.field}>
                <span><UiText text="Максимум страниц" /></span>
                <input max={5000} min={Math.max(1, configuredSeedCount)} onChange={(event) => setMaxUrls(event.target.value)} required type="number" value={maxUrls} />
              </label>
              <label className={styles.field}>
                <span><UiText text="Скорость обхода" /></span>
                <CustomSelect onChange={(event) => setSpeed(event.target.value)} value={speed}>
                  {SPEEDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </CustomSelect>
              </label>
            </div>
            <p className={styles.safetyNote}><Icon name="settings" /> <UiText text="Не более 1 страницы в секунду на host. Robots.txt соблюдается всегда." before=" " /></p>
          </section>

          <section className={styles.panel}>
            <header>
              <span className={styles.step}>3</span>
              <div>
                <h2><UiText text="Редиректы главной страницы" /></h2>
                <p><UiText text="Дополнительные варианты проверяются отдельно и попадают в общую таблицу." /></p>
              </div>
            </header>
            <div className={styles.checkList}>
              <label className={styles.checkbox}>
                <input checked={checkHttpRedirect} onChange={(event) => setCheckHttpRedirect(event.target.checked)} type="checkbox" />
                <span><strong>HTTP → HTTPS</strong><small><UiText text="Проверить, куда ведёт незащищённая версия главной страницы." /></small></span>
              </label>
              <label className={styles.checkbox}>
                <input checked={checkWwwRedirect} onChange={(event) => setCheckWwwRedirect(event.target.checked)} type="checkbox" />
                <span><strong><UiText text="WWW-версия" /></strong><small><UiText text="Проверить альтернативный вариант домена с www или без него." /></small></span>
              </label>
              <label className={styles.checkbox}>
                <input checked={checkMultipleSlashes} onChange={(event) => setCheckMultipleSlashes(event.target.checked)} type="checkbox" />
                <span><strong><UiText text="Лишние слеши" /></strong><small><UiText text="Проверить главную с путями //, ///, //// и /////." /></small></span>
              </label>
            </div>
          </section>

          <details className={styles.advanced}>
            <summary><span><strong><UiText text="Дополнительные параметры" /></strong><small><UiText text="Sitemap, глубина, query-параметры и ограничения путей" /></small></span><b><UiText text="Настроить" /></b></summary>
            <div className={styles.advancedBody}>
              <label className={styles.checkbox}>
                <input checked={followLinks} onChange={(event) => setFollowLinks(event.target.checked)} type="checkbox" />
                <span><strong><UiText text="Переходить по внутренним ссылкам" /></strong><small><UiText text="Новые URL добавляются в этот же запуск до выбранного лимита." /></small></span>
              </label>
              {followLinks && (
                <label className={styles.field}>
                  <span><UiText text="Максимальная глубина" /></span>
                  <CustomSelect onChange={(event) => setMaxDepth(event.target.value)} value={maxDepth}>
                    <option value="1"><UiText text="1 уровень" /></option><option value="3"><UiText text="3 уровня" /></option><option value="5"><UiText text="5 уровней" /></option><option value="10"><UiText text="10 уровней" /></option>
                  </CustomSelect>
                </label>
              )}
              <label className={styles.checkbox}>
                <input checked={useSitemap} onChange={(event) => setUseSitemap(event.target.checked)} type="checkbox" />
                <span><strong><UiText text="Использовать sitemap" /></strong><small><UiText text="Недоступный sitemap не остановит HTTP-проверку: обход продолжится по ссылкам." /></small></span>
              </label>
              {useSitemap && (
                <label className={styles.field}>
                  <span><UiText text="Sitemap URL — до 10" /></span>
                  <textarea onChange={(event) => setSitemapUrls(event.target.value)} rows={3} value={sitemapUrls} />
                </label>
              )}
              <label className={styles.checkbox}>
                <input checked={savePageMap} onChange={(event) => setSavePageMap(event.target.checked)} type="checkbox" />
                <span><strong><UiText text="Сохранить карту сайта" /></strong><small><UiText text="Добавить найденные страницы, метатеги и показатели загрузки в карту страниц проекта." /></small></span>
              </label>
              <label className={styles.field}>
                <span><UiText text="Query-параметры" /></span>
                <CustomSelect onChange={(event) => setQueryPolicy(event.target.value as TechnicalCrawlQueryPolicy)} value={queryPolicy}>
                  <option value="DROP_TRACKING"><UiText text="Убирать только tracking-параметры" /></option>
                  <option value="DROP_ALL"><UiText text="Убирать все параметры" /></option>
                  <option value="PRESERVE"><UiText text="Сохранять параметры" /></option>
                </CustomSelect>
              </label>
              <div className={styles.twoColumns}>
                <label className={styles.field}><span><UiText text="Включить пути" /></span><textarea onChange={(event) => setIncludePatterns(event.target.value)} placeholder="/catalog/**" rows={3} value={includePatterns} /></label>
                <label className={styles.field}><span><UiText text="Исключить пути" /></span><textarea onChange={(event) => setExcludePatterns(event.target.value)} placeholder="/admin/**" rows={3} value={excludePatterns} /></label>
              </div>
            </div>
          </details>
        </div>

        <aside className={styles.summary}>
          <h2><UiText text="Параметры запуска" /></h2>
          <dl>
            <div><dt><UiText text="Проект" /></dt><dd>{project.name}</dd></div>
            <div><dt><UiText text="Источник" /></dt><dd>{scopeMode === "FULL_SITE" ? <UiText text="Весь сайт" /> : `${parsedUrls.urls.length} URL`}</dd></div>
            <div><dt><UiText text="Лимит" /></dt><dd><UiText text="до" after=" " />{Number.isFinite(maxUrlNumber) ? maxUrlNumber.toLocaleString(uiLocale) : "—"}</dd></div>
            <div><dt><UiText text="Скорость" /></dt><dd>{SPEEDS.find(({ value }) => value === speed)?.label ?? "—"}</dd></div>
            <div><dt><UiText text="Обнаружение" /></dt><dd>{followLinks ? <UiText text="ссылки · глубина {0}" values={[String(maxDepth)]} /> : <UiText text="только список" />}</dd></div>
            <div><dt><UiText text="Главная" /></dt><dd>{homepageChecks.length > 0 ? <UiText text="{0} проверки" values={[String(homepageChecks.length)]} /> : <UiText text="без доп. проверок" />}</dd></div>
            <div><dt><UiText text="Карта страниц" /></dt><dd>{savePageMap ? <UiText text="обновить" /> : <UiText text="не сохранять" />}</dd></div>
          </dl>
          {settings && !settings.access.canRun && (
            <p className={styles.restriction}>{<UiText text={restrictionLabel(settings.access.mutationRestriction) ?? ""} />}</p>
          )}
          <button className="primary-button" disabled={busy || !canRun} type="submit">
            {busy
              ? <UiText text="Ставим в очередь…" />
              : settings
                ? <UiText text="Запустить обход" />
                : <UiText text="Проверяем доступ…" />}
          </button>
          <small><UiText text="Прогресс и найденные ответы появятся на отдельной странице операции." /></small>
        </aside>
      </div>
    </form>
  );
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
