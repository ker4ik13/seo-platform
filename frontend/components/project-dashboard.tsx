"use client";

import type {
  FrequencyCollectionSummary,
  KeywordResearchCollection,
  ProjectPositionSummary,
  RankJobSummary,
  SemanticKeywordListItem,
  TechnicalCrawlSettings
} from "@seo-platform/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserApiError,
  browserApiCollectionRequest,
  browserApiRequest
} from "../lib/browser-api";
import type { OperationResultKind } from "../lib/operation-result-routes";
import { operationStatusLabel } from "../lib/operation-status-presentation";
import { Icon } from "./icon";
import { OperationResultModal } from "./operation-result-modal";
import { ProviderLogo } from "./provider-logo";

interface DashboardJob {
  readonly id: string;
  readonly title: string;
  readonly provider?: "XMLSTOCK" | "ARSENKIN" | "KEYS_SO";
  readonly status: string;
  readonly stage?: string;
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
  readonly positionSummary: ProjectPositionSummary;
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
      const [keywords, tracked, frequencies, ranks, crawls, research, positionSummary] =
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
          browserApiRequest<ProjectPositionSummary>(
            `${base}/keywords/position-summary`,
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
        positionSummary
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
  const trackedShare = data ? percentage(data.trackedCount, data.keywordCount) : 0;

  return (
    <>
      <section className="dashboard-heading">
        <div>
          <p className="dashboard-context">{projectName}</p>
          <h1>Добрый день, {firstName(userName)}</h1>
          <p>Семантика, видимость и текущие операции проекта — в одной сводке.</p>
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
          label="Средняя позиция"
          value={data?.positionSummary.averagePosition !== undefined ? formatPosition(data.positionSummary.averagePosition) : loading ? "…" : "—"}
          hint={data?.positionSummary.positionedKeywordCount ? `По ${formatInteger(data.positionSummary.positionedKeywordCount)} запросам с позицией` : "Позиций пока нет"}
          tone="green"
        />
      </section>

      <section className="dashboard-rank-section">
        <article className="panel dashboard-rank-panel dashboard-rank-panel-full">
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
                    {operationStatusLabel(job.status, job.stage)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="panel-empty compact dashboard-panel-empty">
              <strong>Операций пока нет</strong>
              <p>Они появятся после первого сбора или проверки.</p>
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
  tone: "violet" | "blue" | "green";
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
  icon: "semantic" | "positions";
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

function dashboardJobs(data: DashboardData): readonly DashboardJob[] {
  return [
    ...data.frequencies.map((job): DashboardJob => ({
      id: job.id,
      title: "Сбор частотности",
      provider: job.provider,
      status: job.status,
      ...(job.stage ? { stage: job.stage } : {}),
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
      title: job.config.purpose === "HTTP_STATUS_CHECK" ? "Обход сайта" : "Технический аудит",
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


function percentage(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(value / total * 100)));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatPosition(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1
  }).format(value);
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

function dashboardError(error: unknown): string {
  return error instanceof BrowserApiError
    ? error.message
    : "Не удалось загрузить актуальные данные обзора.";
}
