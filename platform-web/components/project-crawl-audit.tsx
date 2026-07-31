"use client";

import type {
  CrawlDuplicateKind,
  CrawlPageChangeField,
  ProjectCrawlAbsentPageCollection,
  ProjectCrawlDuplicateGroupCollection,
  ProjectCrawlPageChangeCollection,
  ProjectCrawlIssueCollection,
  TechnicalCrawlQueryPolicy,
  TechnicalCrawlSettings,
  TechnicalCrawlStatus,
  TechnicalCrawlSummary
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { CrawlAutomationPanel } from "./crawl-automation-panel";

const ACTIVE = new Set<TechnicalCrawlStatus>([
  "QUEUED",
  "RUNNING",
  "CANCEL_REQUESTED"
]);

export function ProjectCrawlAudit({
  projectId,
  projectDomain
}: Readonly<{
  projectId: string;
  projectDomain: string;
}>) {
  const [crawls, setCrawls] = useState<TechnicalCrawlSettings>();
  const [issues, setIssues] = useState<ProjectCrawlIssueCollection>();
  const [changes, setChanges] =
    useState<ProjectCrawlPageChangeCollection>();
  const [duplicates, setDuplicates] =
    useState<ProjectCrawlDuplicateGroupCollection>({ groups: [] });
  const [absences, setAbsences] =
    useState<ProjectCrawlAbsentPageCollection>();
  const [duplicateKind, setDuplicateKind] =
    useState<"ALL" | CrawlDuplicateKind>("ALL");
  const [duplicatePage, setDuplicatePage] = useState(0);
  const [startUrl, setStartUrl] = useState(
    projectDomain.startsWith("http")
      ? projectDomain
      : `https://${projectDomain}/`
  );
  const [maxUrls, setMaxUrls] = useState("100");
  const [maxDepth, setMaxDepth] = useState("3");
  const [maxRuntimeMinutes, setMaxRuntimeMinutes] = useState("60");
  const [rpm, setRpm] = useState("30");
  const [sitemapUrls, setSitemapUrls] = useState("");
  const [includePatterns, setIncludePatterns] = useState("");
  const [excludePatterns, setExcludePatterns] = useState("");
  const [queryPolicy, setQueryPolicy] =
    useState<TechnicalCrawlQueryPolicy>("DROP_TRACKING");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const options = signal ? { signal } : {};
      const nextCrawls = await browserApiRequest<TechnicalCrawlSettings>(
        crawlPath(projectId),
        options
      );
      const latestAnalyzed = nextCrawls.crawls.find(({ status }) =>
        status === "COMPLETED" || status === "PARTIALLY_COMPLETED"
      );
      const latestCompleted = nextCrawls.crawls.find(
        ({ status }) => status === "COMPLETED"
      );
      const [
        nextIssues,
        nextChanges,
        nextDuplicates,
        nextAbsences
      ] = await Promise.all([
        browserApiRequest<ProjectCrawlIssueCollection>(
          issuePath(projectId),
          options
        ),
        browserApiRequest<ProjectCrawlPageChangeCollection>(
          changePath(projectId),
          options
        ),
        latestAnalyzed
          ? browserApiRequest<ProjectCrawlDuplicateGroupCollection>(
              duplicatePath(projectId, latestAnalyzed.id),
              options
            )
          : Promise.resolve({ groups: [] }),
        latestCompleted
          ? browserApiRequest<ProjectCrawlAbsentPageCollection>(
              absentPath(projectId, latestCompleted.id),
              options
            )
          : Promise.resolve(undefined)
      ]);
      setCrawls(nextCrawls);
      setIssues(nextIssues);
      setChanges(nextChanges);
      setDuplicates(nextDuplicates);
      setAbsences(nextAbsences);
      setError(undefined);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(message(caught, "Не удалось загрузить технический аудит."));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasActive = useMemo(
    () => crawls?.crawls.some(({ status }) => ACTIVE.has(status)) ?? false,
    [crawls]
  );
  const filteredDuplicates = useMemo(
    () =>
      duplicates.groups.filter(
        ({ kind }) => duplicateKind === "ALL" || kind === duplicateKind
      ),
    [duplicateKind, duplicates.groups]
  );
  const duplicatePageCount = Math.max(
    1,
    Math.ceil(filteredDuplicates.length / 20)
  );
  const duplicateCrawlId = duplicates.groups[0]?.crawlId;
  const visibleDuplicates = filteredDuplicates.slice(
    duplicatePage * 20,
    duplicatePage * 20 + 20
  );

  useEffect(() => {
    setDuplicatePage(0);
  }, [duplicateCrawlId, duplicateKind]);

  useEffect(() => {
    if (!hasActive) return;
    const timer = globalThis.setInterval(() => void load(), 5_000);
    return () => globalThis.clearInterval(timer);
  }, [hasActive, load]);

  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!crawls?.access.canRun || busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await browserApiRequest<TechnicalCrawlSummary>(crawlPath(projectId), {
        method: "POST",
        idempotencyKey: `crawl:${globalThis.crypto.randomUUID()}`,
        body: {
          startUrls: [startUrl.trim()],
          sitemapUrls: lineList(sitemapUrls),
          includePatterns: patternList(includePatterns),
          excludePatterns: patternList(excludePatterns),
          queryPolicy,
          maxUrls: Number(maxUrls),
          maxDepth: Number(maxDepth),
          maxRuntimeSeconds: Number(maxRuntimeMinutes) * 60,
          requestsPerMinute: Number(rpm),
          obeyRobots: true
        }
      });
      setNotice("Аудит поставлен в очередь. Результаты обновляются автоматически.");
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось запустить технический аудит."));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(crawl: TechnicalCrawlSummary): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest<TechnicalCrawlSummary>(
        `${crawlPath(projectId)}/${encodeURIComponent(crawl.id)}/cancel`,
        { method: "POST", body: {}, ifMatch: crawl.version }
      );
      setNotice("Остановка аудита запрошена.");
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось остановить аудит."));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !crawls) {
    return (
      <section className="panel crawl-audit-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <p>Загружаем технические аудиты…</p>
      </section>
    );
  }

  return (
    <section className="panel crawl-audit">
      <header className="crawl-audit-header">
        <div>
          <p className="eyebrow">Технический crawl</p>
          <h2>Аудит сайта</h2>
          <p>
            Обход соблюдает robots.txt, ограничивает скорость и сохраняет
            только нормализованные SEO-сигналы и найденные проблемы.
          </p>
        </div>
        {hasActive && <span className="status-badge">Выполняется</span>}
      </header>

      {error && <div className="inline-error" role="alert">{error}</div>}
      {notice && <div className="inline-success" role="status">{notice}</div>}

      <form className="crawl-audit-form" onSubmit={start}>
        <label className="form-field crawl-audit-url">
          <span>Стартовый URL</span>
          <input
            onChange={(event) => setStartUrl(event.target.value)}
            required
            type="url"
            value={startUrl}
          />
        </label>
        <NumberField label="Лимит URL" max={1000} min={1} set={setMaxUrls} value={maxUrls} />
        <NumberField label="Глубина" max={10} min={0} set={setMaxDepth} value={maxDepth} />
        <NumberField
          label="Макс. время, мин"
          max={360}
          min={1}
          set={setMaxRuntimeMinutes}
          value={maxRuntimeMinutes}
        />
        <NumberField label="Запросов/мин" max={60} min={1} set={setRpm} value={rpm} />
        <label className="form-field crawl-audit-scope">
          <span>Sitemap URL, до 10 (необязательно)</span>
          <textarea
            onChange={(event) => setSitemapUrls(event.target.value)}
            placeholder={"https://example.com/sitemap.xml\nhttps://example.com/products.xml.gz"}
            rows={2}
            value={sitemapUrls}
          />
        </label>
        <label className="form-field crawl-audit-scope">
          <span>Включить пути</span>
          <textarea
            onChange={(event) => setIncludePatterns(event.target.value)}
            placeholder={"/catalog/**\n/services/**"}
            rows={2}
            value={includePatterns}
          />
        </label>
        <label className="form-field crawl-audit-scope">
          <span>Исключить пути</span>
          <textarea
            onChange={(event) => setExcludePatterns(event.target.value)}
            placeholder={"/admin/**\n/cart/**"}
            rows={2}
            value={excludePatterns}
          />
        </label>
        <label className="form-field">
          <span>Query-параметры</span>
          <select
            onChange={(event) =>
              setQueryPolicy(
                event.target.value as TechnicalCrawlQueryPolicy
              )
            }
            value={queryPolicy}
          >
            <option value="DROP_TRACKING">Убирать tracking</option>
            <option value="DROP_ALL">Убирать все</option>
            <option value="PRESERVE">Сохранять</option>
          </select>
        </label>
        <button
          className="primary-button"
          disabled={
            busy ||
            hasActive ||
            crawls?.access.canRun !== true
          }
          type="submit"
        >
          {busy ? "Подождите…" : hasActive ? "Аудит уже идёт" : "Запустить аудит"}
        </button>
      </form>

      {crawls && crawls.access.mutationRestriction !== "NONE" && (
        <p className="inline-note">
          Запуск недоступен: {restriction(crawls.access.mutationRestriction)}.
        </p>
      )}

      <div className="crawl-audit-grid">
        <div>
          <h3>Последние запуски</h3>
          {crawls?.crawls.length ? (
            <div className="crawl-run-list">
              {crawls.crawls.slice(0, 8).map((crawl) => (
                <article className="crawl-run" key={crawl.id}>
                  <div>
                    <strong>{statusLabel(crawl.status)}</strong>
                    <span>{new Date(crawl.createdAt).toLocaleString("ru-RU")}</span>
                  </div>
                  <p>
                    {crawl.processedUrls}/{crawl.config.maxUrls} URL ·{" "}
                    {crawl.successfulUrls} успешно · {crawl.failedUrls} ошибок ·{" "}
                    {crawl.issueCount} проблем
                  </p>
                  {crawl.backoffCode && crawl.backoffUntil && (
                    <p className="inline-note" role="status">
                      {backoffLabel(crawl.backoffCode)} Повтор после{" "}
                      {new Date(crawl.backoffUntil).toLocaleString("ru-RU")}.
                    </p>
                  )}
                  {ACTIVE.has(crawl.status) && crawls.access.canRun && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void cancel(crawl)}
                      type="button"
                    >
                      Остановить
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy">Аудиты ещё не запускались.</p>
          )}
        </div>
        <div>
          <h3>Открытые проблемы</h3>
          {issues?.issues.length ? (
            <div className="crawl-issue-list">
              {issues.issues.slice(0, 12).map((issue) => (
                <article className="crawl-issue" key={issue.id}>
                  <span className={`issue-severity issue-${issue.severity.toLowerCase()}`}>
                    {severityLabel(issue.severity)}
                  </span>
                  <div>
                    <strong>{issue.title}</strong>
                    <a href={issue.url} rel="noreferrer" target="_blank">
                      {issue.url}
                    </a>
                    <small>{issue.code} · обнаружено {issue.occurrences}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted-copy">
              Открытых проблем нет. Запустите аудит для актуальной проверки.
            </p>
          )}
        </div>
      </div>

      <div className="crawl-duplicate-history">
        <div className="crawl-duplicate-heading">
          <div>
            <p className="eyebrow">Duplicate groups</p>
            <h3>Дубли страниц</h3>
            <p className="muted-copy">
              Группы строятся по нормализованным Title, Description, H1 и
              хешу видимого текста последнего завершённого обхода.
            </p>
          </div>
          <label className="form-field crawl-duplicate-filter">
            <span>Тип дубля</span>
            <select
              onChange={(event) =>
                setDuplicateKind(
                  event.target.value as "ALL" | CrawlDuplicateKind
                )
              }
              value={duplicateKind}
            >
              <option value="ALL">Все ({duplicates.groups.length})</option>
              <option value="CONTENT">Контент</option>
              <option value="TITLE">Title</option>
              <option value="DESCRIPTION">Description</option>
              <option value="H1">H1</option>
            </select>
          </label>
        </div>
        {visibleDuplicates.length ? (
          <>
            <div className="crawl-duplicate-list">
              {visibleDuplicates.map((group) => (
                <details className="crawl-duplicate-group" key={group.id}>
                  <summary>
                    <strong>{duplicateKindLabel(group.kind)}</strong>
                    <span>{group.memberCount} страниц</span>
                  </summary>
                  <div className="crawl-duplicate-members">
                    {group.members.map((member) => (
                      <a
                        href={member.url}
                        key={member.pageId}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {member.url}
                      </a>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            {duplicatePageCount > 1 && (
              <div className="crawl-duplicate-pagination">
                <button
                  className="secondary-button"
                  disabled={duplicatePage === 0}
                  onClick={() =>
                    setDuplicatePage((current) => Math.max(0, current - 1))
                  }
                  type="button"
                >
                  Назад
                </button>
                <span>
                  {duplicatePage + 1} из {duplicatePageCount}
                </span>
                <button
                  className="secondary-button"
                  disabled={duplicatePage + 1 >= duplicatePageCount}
                  onClick={() =>
                    setDuplicatePage((current) =>
                      Math.min(duplicatePageCount - 1, current + 1)
                    )
                  }
                  type="button"
                >
                  Далее
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted-copy">
            {duplicates.groups.length
              ? "Для выбранного типа дублей нет."
              : "В последнем завершённом обходе группы дублей не найдены."}
          </p>
        )}
      </div>

      <div className="crawl-absence-history">
        <div>
          <p className="eyebrow">Crawl membership</p>
          <h3>Исчезнувшие страницы</h3>
          <p className="muted-copy">
            URL, найденные в предыдущем полном обходе с тем же scope, но
            отсутствующие в последнем полном обходе.
          </p>
        </div>
        {absences?.pages.length ? (
          <div className="crawl-absence-list">
            {absences.pages.map((page) => (
              <article className="crawl-absence-item" key={page.pageId}>
                <a href={page.url} rel="noreferrer" target="_blank">
                  {page.url}
                </a>
                <span>
                  Последний раз: {new Date(page.lastSeenAt).toLocaleString()}
                  {page.wasInSitemap ? " · была в sitemap" : ""}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">
            В последнем сопоставимом полном обходе исчезнувших URL нет.
          </p>
        )}
      </div>

      <div className="crawl-change-history">
        <div>
          <p className="eyebrow">Radar</p>
          <h3>Изменения между обходами</h3>
          <p className="muted-copy">
            Система сравнивает неизменяемые снимки и показывает только
            значимые изменения, отбрасывая шум небольших колебаний скорости
            и размера.
          </p>
        </div>
        {changes?.changes.length ? (
          <div className="crawl-change-list">
            {changes.changes.slice(0, 12).map((change) => (
              <article className="crawl-change" key={change.id}>
                <span
                  className={`issue-severity issue-${change.severity.toLowerCase()}`}
                >
                  {severityLabel(change.severity)}
                </span>
                <div>
                  <a href={change.url} rel="noreferrer" target="_blank">
                    {change.url}
                  </a>
                  <p>
                    {change.changedFields.map(changeFieldLabel).join(", ")}
                  </p>
                  <small>
                    {new Date(change.previousCrawledAt).toLocaleString("ru-RU")}
                    {" → "}
                    {new Date(change.currentCrawledAt).toLocaleString("ru-RU")}
                  </small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">
            История появится после повторного обхода, если страница
            действительно изменилась.
          </p>
        )}
      </div>
      <CrawlAutomationPanel
        defaultStartUrl={startUrl}
        projectId={projectId}
      />
    </section>
  );
}

function NumberField({
  label,
  min,
  max,
  value,
  set
}: Readonly<{
  label: string;
  min: number;
  max: number;
  value: string;
  set: (value: string) => void;
}>) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => set(event.target.value)}
        required
        type="number"
        value={value}
      />
    </label>
  );
}

function crawlPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/crawls`;
}

function issuePath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/crawl-issues`;
}

function changePath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/crawl-changes`;
}

function duplicatePath(projectId: string, crawlId: string): string {
  return `/app/api/projects/${encodeURIComponent(
    projectId
  )}/crawls/${encodeURIComponent(crawlId)}/duplicate-groups`;
}

function absentPath(projectId: string, crawlId: string): string {
  return `/app/api/projects/${encodeURIComponent(
    projectId
  )}/crawls/${encodeURIComponent(crawlId)}/absent-pages`;
}

function statusLabel(status: TechnicalCrawlStatus): string {
  return {
    QUEUED: "В очереди",
    RUNNING: "Выполняется",
    CANCEL_REQUESTED: "Останавливается",
    CANCELLED: "Остановлен",
    PARTIALLY_COMPLETED: "Завершён частично",
    COMPLETED: "Завершён",
    FAILED: "Ошибка"
  }[status];
}

function severityLabel(severity: string): string {
  return {
    INFO: "Инфо",
    WARNING: "Важно",
    ERROR: "Ошибка",
    CRITICAL: "Критично"
  }[severity] ?? severity;
}

function backoffLabel(
  code: NonNullable<TechnicalCrawlSummary["backoffCode"]>
): string {
  return {
    HOST_RATE_LIMIT: "Сайт ограничил частоту запросов.",
    HOST_UNAVAILABLE: "Сайт временно недоступен.",
    HOST_NETWORK_ERROR: "Сеть или DNS сайта временно недоступны.",
    LATENCY_SPIKE: "Сайт стал отвечать значительно медленнее.",
    SITE_PAUSED:
      "Обход автоматически приостановлен после повторных сигналов сайта."
  }[code];
}

function changeFieldLabel(field: CrawlPageChangeField): string {
  return {
    statusCode: "HTTP-статус",
    redirectChain: "цепочка редиректов",
    inSitemap: "наличие в sitemap",
    title: "Title",
    description: "Description",
    h1: "H1",
    h1Count: "число H1",
    headings: "заголовки",
    canonicalUrl: "canonical",
    robots: "robots",
    language: "язык",
    hreflang: "hreflang",
    internalLinks: "внутренние ссылки",
    externalLinks: "внешние ссылки",
    imageCount: "изображения",
    imagesMissingAlt: "alt изображений",
    structuredDataTypes: "структурированные данные",
    wordCount: "объём текста",
    contentHash: "содержимое",
    indexability: "индексируемость",
    responseTimeMs: "время ответа",
    sizeBytes: "размер ответа"
  }[field] ?? field;
}

function duplicateKindLabel(kind: CrawlDuplicateKind): string {
  return {
    CONTENT: "Одинаковый контент",
    TITLE: "Одинаковый Title",
    DESCRIPTION: "Одинаковый Description",
    H1: "Одинаковый H1"
  }[kind];
}

function lineList(value: string): readonly string[] {
  return [...new Set(
    value
      .split(/\r?\n/u)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function patternList(value: string): readonly string[] {
  return [...new Set(lineList(value).flatMap((line) =>
    line.split(",").map((item) => item.trim()).filter(Boolean)
  ))];
}

function restriction(value: string): string {
  return {
    MISSING_PERMISSION: "нет права управления страницами",
    WORKSPACE_READ_ONLY: "workspace работает только для чтения",
    PROJECT_ARCHIVED: "проект архивирован"
  }[value] ?? "ограничение проекта";
}

function message(error: unknown, fallback: string): string {
  return error instanceof BrowserApiError ? error.message : fallback;
}
