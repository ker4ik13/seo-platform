"use client";

import type {
  FrequencyCollectionSummary,
  KeywordResearchCollection,
  ProjectCrawlIssueCollection,
  ProjectCrawlIssueSummary,
  RankJobSummary,
  SemanticKeywordListItem,
  TechnicalCrawlSettings,
  TechnicalCrawlSummary
} from "@seo-platform/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserApiError,
  browserApiCollectionRequest,
  browserApiRequest
} from "../lib/browser-api";
import type { OperationResultKind } from "../lib/operation-result-routes";
import { Icon } from "./icon";
import { OperationResultModal } from "./operation-result-modal";
import { ProviderLogo } from "./provider-logo";

interface DashboardJob {
  readonly id: string;
  readonly title: string;
  readonly provider?: "XMLSTOCK" | "ARSENKIN" | "KEYS_SO";
  readonly status: string;
  readonly createdAt: string;
  readonly resultKind: OperationResultKind;
}

interface DashboardData {
  readonly keywordCount: number;
  readonly trackedCount: number;
  readonly frequencies: readonly FrequencyCollectionSummary[];
  readonly ranks: readonly RankJobSummary[];
  readonly crawls: TechnicalCrawlSettings;
  readonly research: KeywordResearchCollection;
  readonly issues: ProjectCrawlIssueCollection;
}

interface RankCoveragePoint {
  readonly id: string;
  readonly coverage: number;
  readonly found: number;
  readonly notFound: number;
  readonly failed: number;
  readonly total: number;
  readonly createdAt: string;
}

const issueSeverities = ["CRITICAL", "ERROR", "WARNING", "INFO"] as const;
type IssueSeverity = (typeof issueSeverities)[number];

export function ProjectDashboard({
  projectId,
  projectName,
  userName
}: Readonly<{
  projectId: string;
  projectName: string;
  userName: string;
}>) {
  const [data, setData] = useState<DashboardData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedJob, setSelectedJob] = useState<DashboardJob>();

  const load = useCallback(async (signal?: AbortSignal) => {
    const base = `/app/api/projects/${encodeURIComponent(projectId)}`;
    try {
      const [keywords, tracked, frequencies, ranks, crawls, research, issues] =
        await Promise.all([
          browserApiCollectionRequest<SemanticKeywordListItem>(
            `${base}/keywords?limit=1&sort=CREATED_DESC`,
            signal ? { signal } : {}
          ),
          browserApiCollectionRequest<SemanticKeywordListItem>(
            `${base}/keywords?limit=1&sort=CREATED_DESC&isTracked=true`,
            signal ? { signal } : {}
          ),
          browserApiRequest<{
            readonly collections: readonly FrequencyCollectionSummary[];
          }>(`${base}/frequency-collections`, signal ? { signal } : {}),
          browserApiRequest<{ readonly jobs: readonly RankJobSummary[] }>(
            `${base}/rank-runs`,
            signal ? { signal } : {}
          ),
          browserApiRequest<TechnicalCrawlSettings>(
            `${base}/crawls`,
            signal ? { signal } : {}
          ),
          browserApiRequest<KeywordResearchCollection>(
            `${base}/keyword-research-runs`,
            signal ? { signal } : {}
          ),
          browserApiRequest<ProjectCrawlIssueCollection>(
            `${base}/crawl-issues`,
            signal ? { signal } : {}
          )
        ]);
      if (signal?.aborted) return;
      setData({
        keywordCount: keywords.page.totalApprox ?? keywords.data.length,
        trackedCount: tracked.page.totalApprox ?? tracked.data.length,
        frequencies: frequencies.collections,
        ranks: ranks.jobs,
        crawls,
        research,
        issues
      });
      setError(undefined);
    } catch (requestError) {
      if (!signal?.aborted) setError(dashboardError(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const jobs = useMemo(() => data ? dashboardJobs(data) : [], [data]);
  const rankCoverage = useMemo(
    () => data ? rankCoveragePoints(data.ranks) : [],
    [data]
  );
  const activeCount = jobs.filter(({ status }) => activeStatus(status)).length;
  const completedCount = jobs.filter(({ status }) => completedStatus(status)).length;
  const failedCount = jobs.filter(({ status }) => failureStatus(status)).length;
  const unresolvedIssues = data?.issues.issues.filter(({ resolvedAt }) => !resolvedAt) ?? [];
  const latestRank = rankCoverage.at(-1);
  const latestCrawl = data ? latestByCreatedAt(data.crawls.crawls) : undefined;
  const trackedShare = data ? percentage(data.trackedCount, data.keywordCount) : 0;

  return (
    <>
      <section className="dashboard-heading">
        <div>
          <p className="dashboard-context">{projectName}</p>
          <h1>Добрый день, {firstName(userName)}</h1>
          <p>Семантика, видимость, техническое состояние и текущая работа — в одной сводке.</p>
        </div>
        <div className="dashboard-heading-actions">
          <a className="secondary-button" href="/app/tasks">Все операции</a>
          <a className="primary-button" href="/app/semantics">
            <Icon name="plus" />
            <span>Добавить запросы</span>
          </a>
        </div>
      </section>

      {error && (
        <div className="dashboard-data-alert" role="alert">
          <span>{error}</span>
          <button aria-label="Повторить загрузку" onClick={() => void load()} type="button">
            Повторить
          </button>
        </div>
      )}

      <section className="metric-grid dashboard-live-metrics" aria-label="Ключевые показатели">
        <DashboardMetric
          label="Запросов"
          value={data ? formatInteger(data.keywordCount) : loading ? "…" : "0"}
          hint="В семантическом ядре"
          tone="violet"
        />
        <DashboardMetric
          label="Отслеживается"
          value={data ? formatInteger(data.trackedCount) : loading ? "…" : "0"}
          hint={data ? `${trackedShare}% от всех запросов` : "Для съёма позиций"}
          tone="blue"
        />
        <DashboardMetric
          label="Найдено позиций"
          value={latestRank ? formatInteger(latestRank.found) : loading ? "…" : "—"}
          hint={latestRank ? `${latestRank.coverage}% в последнем съёме` : "Съёмов пока нет"}
          tone="green"
        />
        <DashboardMetric
          label="Проблем аудита"
          value={data ? formatInteger(unresolvedIssues.length) : loading ? "…" : "0"}
          hint={latestCrawl ? `${formatInteger(latestCrawl.processedUrls)} страниц проверено` : "Нерешённые сигналы"}
          tone="amber"
        />
      </section>

      <section className="dashboard-live-grid">
        <article className="panel dashboard-rank-panel">
          <header className="panel-header">
            <div>
              <h2>Динамика видимости</h2>
              <p>Доля запросов с найденной позицией в последних завершённых съёмах</p>
            </div>
            <a className="text-button" href="/app/semantics">Открыть семантику</a>
          </header>
          {rankCoverage.length > 0 ? (
            <RankCoverageChart points={rankCoverage} />
          ) : (
            <div className="panel-empty compact dashboard-panel-empty">
              <span className="state-icon"><Icon name="trend" /></span>
              <strong>Пока нет завершённых съёмов</strong>
              <p>Выберите запросы в семантике и запустите проверку позиций.</p>
              <a className="secondary-button" href="/app/semantics">Запустить съём</a>
            </div>
          )}
        </article>

        <AuditOverview
          issues={unresolvedIssues}
          latestCrawl={latestCrawl}
          pagesHref={`/app/projects/${encodeURIComponent(projectId)}/pages`}
        />
      </section>

      <section className="dashboard-lower-grid">
        <article className="panel dashboard-jobs-panel">
          <header className="panel-header">
            <div><h2>Последние операции</h2><p>Ход и результат фоновых задач проекта</p></div>
            <a className="text-button" href="/app/tasks">Показать все</a>
          </header>
          {jobs.length > 0 ? (
            <div className="dashboard-job-list">
              {jobs.slice(0, 5).map((job) => (
                <button
                  key={`${job.title}:${job.id}`}
                  onClick={() => setSelectedJob(job)}
                  type="button"
                >
                  {job.provider ? (
                    <ProviderLogo provider={job.provider} size="compact" />
                  ) : (
                    <span className="task-kind-mark"><Icon name="pages" /></span>
                  )}
                  <span>
                    <strong>{job.title}</strong>
                    <small>{formatDateTime(job.createdAt)}</small>
                  </span>
                  <span className={activeStatus(job.status) ? "dashboard-job-status active" : failureStatus(job.status) ? "dashboard-job-status error" : "dashboard-job-status"}>
                    {statusLabel(job.status)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="panel-empty compact dashboard-panel-empty">
              <strong>Операций пока нет</strong>
              <p>Они появятся после первого сбора, проверки или аудита.</p>
            </div>
          )}
        </article>

        <article className="panel dashboard-work-panel">
          <header className="panel-header">
            <div><h2>Работа проекта</h2><p>Состояние очереди и быстрый запуск</p></div>
          </header>
          <div className="dashboard-workload" aria-label="Состояние операций">
            <WorkloadStat label="Активно" value={activeCount} tone="active" />
            <WorkloadStat label="Завершено" value={completedCount} tone="success" />
            <WorkloadStat label="С ошибкой" value={failedCount} tone="error" />
          </div>
          <div className="dashboard-quick-actions">
            <QuickAction href="/app/semantics" icon="semantic" label="Добавить запросы" />
            <QuickAction href="/app/semantics" icon="positions" label="Проверить позиции" />
            <QuickAction href={`/app/projects/${encodeURIComponent(projectId)}/pages`} icon="pages" label="Запустить аудит" />
            <QuickAction href="/app/competitors" icon="competitors" label="Собрать конкурентов" />
          </div>
        </article>
      </section>
      {selectedJob && (
        <OperationResultModal
          description={`${selectedJob.provider ? dashboardProviderLabel(selectedJob.provider) : "SEOньорита"} · ${formatDateTime(selectedJob.createdAt)}`}
          kind={selectedJob.resultKind}
          onClose={() => setSelectedJob(undefined)}
          operationId={selectedJob.id}
          projectId={projectId}
          title={selectedJob.title}
        />
      )}
    </>
  );
}

function DashboardMetric({
  label,
  value,
  hint,
  tone
}: Readonly<{
  label: string;
  value: string;
  hint: string;
  tone: "violet" | "blue" | "green" | "amber";
}>) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-head"><span>{label}</span></div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function WorkloadStat({
  label,
  value,
  tone
}: Readonly<{
  label: string;
  value: number;
  tone: "active" | "success" | "error";
}>) {
  return (
    <div className={`dashboard-workload-stat is-${tone}`}>
      <span>{label}</span>
      <strong>{formatInteger(value)}</strong>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  label
}: Readonly<{
  href: string;
  icon: "semantic" | "positions" | "pages" | "competitors";
  label: string;
}>) {
  return (
    <a href={href}>
      <span><Icon name={icon} /></span>
      <strong>{label}</strong>
      <b aria-hidden="true">→</b>
    </a>
  );
}

function RankCoverageChart({ points }: Readonly<{ points: readonly RankCoveragePoint[] }>) {
  const recent = points.slice(-8);
  const latest = recent.at(-1)!;
  return (
    <div className="dashboard-rank-chart">
      <div className="dashboard-rank-summary">
        <div>
          <span>Покрытие</span>
          <strong>{latest.coverage}%</strong>
          <small>{formatDateTime(latest.createdAt)}</small>
        </div>
        <dl>
          <div><dt>Найдено</dt><dd>{formatInteger(latest.found)}</dd></div>
          <div><dt>Не найдено</dt><dd>{formatInteger(latest.notFound)}</dd></div>
          <div><dt>Ошибки</dt><dd>{formatInteger(latest.failed)}</dd></div>
          <div><dt>Всего</dt><dd>{formatInteger(latest.total)}</dd></div>
        </dl>
      </div>
      <div
        aria-label={`Динамика покрытия позиций. Последнее значение ${latest.coverage}%`}
        className="dashboard-rank-bars"
        role="img"
      >
        {recent.map((point) => (
          <div className="dashboard-rank-bar" key={point.id} title={`${formatDateTime(point.createdAt)} — ${point.coverage}%`}>
            <span>{point.coverage}%</span>
            <div><i style={{ height: `${Math.max(point.coverage, 3)}%` }} /></div>
            <small>{formatShortDate(point.createdAt)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditOverview({
  issues,
  latestCrawl,
  pagesHref
}: Readonly<{
  issues: readonly ProjectCrawlIssueSummary[];
  latestCrawl: TechnicalCrawlSummary | undefined;
  pagesHref: string;
}>) {
  const severityCounts = issueSeverities.map((severity) => ({
    severity,
    count: issues.filter((issue) => issue.severity === severity).length
  }));
  const maxCount = Math.max(...severityCounts.map(({ count }) => count), 1);
  return (
    <article className="panel dashboard-audit-panel">
      <header className="panel-header">
        <div><h2>Техническое состояние</h2><p>Последний обход и нерешённые сигналы</p></div>
        <a className="text-button" href={pagesHref}>Карта страниц</a>
      </header>
      {latestCrawl ? (
        <div className="dashboard-crawl-summary">
          <div><span>Проверено страниц</span><strong>{formatInteger(latestCrawl.processedUrls)}</strong></div>
          <div><span>Успешно</span><strong>{formatInteger(latestCrawl.successfulUrls)}</strong></div>
          <div><span>Ошибки обхода</span><strong>{formatInteger(latestCrawl.failedUrls)}</strong></div>
        </div>
      ) : (
        <p className="dashboard-audit-note">Обход сайта ещё не запускался.</p>
      )}
      <div className="dashboard-severity-chart" aria-label="Проблемы аудита по важности">
        {severityCounts.map(({ severity, count }) => (
          <div className={`is-${severity.toLowerCase()}`} key={severity}>
            <span>{severityLabel(severity)}</span>
            <div><i style={{ width: count > 0 ? `${Math.max(count / maxCount * 100, 5)}%` : "0%" }} /></div>
            <strong>{formatInteger(count)}</strong>
          </div>
        ))}
      </div>
      {issues.length > 0 ? (
        <ul className="dashboard-audit-issues">
          {issues.slice(0, 3).map((issue) => (
            <li key={issue.id}>
              <span className={`issue-severity is-${issue.severity.toLowerCase()}`}>!</span>
              <span><strong>{issue.title}</strong><small>{compactUrl(issue.url)}</small></span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="dashboard-audit-clear">
          <Icon name="clean" />
          <span><strong>Нерешённых проблем нет</strong><small>Новые сигналы появятся после обхода.</small></span>
        </div>
      )}
    </article>
  );
}

function rankCoveragePoints(jobs: readonly RankJobSummary[]): readonly RankCoveragePoint[] {
  return jobs
    .filter((job) => (job.status === "COMPLETED" || job.status === "PARTIALLY_COMPLETED") && job.result)
    .map((job): RankCoveragePoint => {
      const total = Number(job.result?.pairCount ?? 0);
      const found = Number(job.result?.foundCount ?? 0);
      return {
        id: job.id,
        coverage: percentage(found, total),
        found,
        notFound: Number(job.result?.notFoundCount ?? 0),
        failed: Number(job.result?.failedCount ?? 0),
        total,
        createdAt: job.createdAt
      };
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function latestByCreatedAt<T extends { readonly createdAt: string }>(items: readonly T[]): T | undefined {
  return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function dashboardJobs(data: DashboardData): readonly DashboardJob[] {
  return [
    ...data.frequencies.map((job): DashboardJob => ({
      id: job.id,
      title: "Сбор частотности",
      provider: job.provider,
      status: job.status,
      createdAt: job.createdAt,
      resultKind: "frequency"
    })),
    ...data.ranks.map((job): DashboardJob => ({
      id: job.id,
      title: "Проверка позиций",
      provider: job.provider,
      status: job.status,
      createdAt: job.createdAt,
      resultKind: "rank"
    })),
    ...data.crawls.crawls.map((job): DashboardJob => ({
      id: job.id,
      title: "Технический аудит",
      status: job.status,
      createdAt: job.createdAt,
      resultKind: "crawl"
    })),
    ...data.research.runs.map((job): DashboardJob => ({
      id: job.id,
      title: "Сбор конкурентов",
      provider: "KEYS_SO",
      status: job.status,
      createdAt: job.createdAt,
      resultKind: "research"
    }))
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function dashboardProviderLabel(provider: NonNullable<DashboardJob["provider"]>): string {
  return ({ XMLSTOCK: "XMLStock", ARSENKIN: "Arsenkin Tools", KEYS_SO: "Keys.so" } as const)[provider];
}

function activeStatus(status: string): boolean {
  return [
    "PREPARING",
    "QUEUED",
    "RUNNING",
    "WAITING_RATE_LIMIT",
    "RETRY_SCHEDULED",
    "IMPORT_QUEUED",
    "IMPORTING",
    "CANCEL_REQUESTED"
  ].includes(status);
}

function completedStatus(status: string): boolean {
  return ["COMPLETED", "PARTIALLY_COMPLETED", "READY_TO_IMPORT"].includes(status);
}

function failureStatus(status: string): boolean {
  return [
    "FAILED",
    "FAILED_RETRYABLE",
    "FAILED_FINAL",
    "ACTION_REQUIRED"
  ].includes(status);
}

function statusLabel(status: string): string {
  return ({
    PREPARING: "Подготовка",
    QUEUED: "В очереди",
    RUNNING: "Выполняется",
    WAITING_RATE_LIMIT: "Ждёт лимита",
    RETRY_SCHEDULED: "Повтор",
    IMPORT_QUEUED: "Импорт в очереди",
    IMPORTING: "Импортируется",
    CANCEL_REQUESTED: "Останавливается",
    CANCELLED: "Отменено",
    COMPLETED: "Завершено",
    PARTIALLY_COMPLETED: "Частично",
    FAILED: "Ошибка",
    FAILED_RETRYABLE: "Повтор после ошибки",
    FAILED_FINAL: "Ошибка",
    ACTION_REQUIRED: "Нужна проверка",
    READY_TO_IMPORT: "Готово к импорту"
  } as Readonly<Record<string, string>>)[status] ?? status;
}

function severityLabel(severity: IssueSeverity): string {
  return ({
    CRITICAL: "Критичные",
    ERROR: "Ошибки",
    WARNING: "Предупреждения",
    INFO: "Информация"
  } as const)[severity];
}

function percentage(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(value / total * 100)));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(date);
}

function firstName(value: string): string {
  return value.trim().split(/\s+/u)[0] || value;
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}

function dashboardError(error: unknown): string {
  return error instanceof BrowserApiError
    ? error.message
    : "Не удалось загрузить актуальные данные обзора.";
}
