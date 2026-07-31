"use client";

import type {
  CrawlPageChangeField,
  ProjectCrawlPageChangeCollection,
  ProjectCrawlIssueCollection,
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
  const [startUrl, setStartUrl] = useState(
    projectDomain.startsWith("http")
      ? projectDomain
      : `https://${projectDomain}/`
  );
  const [maxUrls, setMaxUrls] = useState("100");
  const [maxDepth, setMaxDepth] = useState("3");
  const [rpm, setRpm] = useState("30");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [nextCrawls, nextIssues, nextChanges] = await Promise.all([
        browserApiRequest<TechnicalCrawlSettings>(
          crawlPath(projectId),
          signal ? { signal } : {}
        ),
        browserApiRequest<ProjectCrawlIssueCollection>(
          issuePath(projectId),
          signal ? { signal } : {}
        ),
        browserApiRequest<ProjectCrawlPageChangeCollection>(
          changePath(projectId),
          signal ? { signal } : {}
        )
      ]);
      setCrawls(nextCrawls);
      setIssues(nextIssues);
      setChanges(nextChanges);
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
          maxUrls: Number(maxUrls),
          maxDepth: Number(maxDepth),
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
        <NumberField label="Запросов/мин" max={60} min={1} set={setRpm} value={rpm} />
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

function changeFieldLabel(field: CrawlPageChangeField): string {
  return {
    statusCode: "HTTP-статус",
    redirectChain: "цепочка редиректов",
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
