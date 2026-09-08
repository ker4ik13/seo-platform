"use client";

import type {
  AiAnswerCollectionSummary,
  FrequencyCollectionSummary,
  KeywordResearchCollection,
  ProjectPositionHistory,
  ProjectPositionSummary,
  RankJobSummary,
  SemanticKeywordListItem,
  TechnicalCrawlSettings
} from "@seo-platform/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserApiError,
  browserApiCollectionRequest,
  browserApiRequest
} from "../lib/browser-api";
import type { OperationResultKind } from "../lib/operation-result-routes";
import { operationStatusLabel } from "../lib/operation-status-presentation";
import {
  aiAnswerCollectionTitle,
  rankCollectionTitle
} from "../lib/operation-collection-purpose";
import { Icon } from "./icon";
import { OperationResultModal } from "./operation-result-modal";
import { ProjectPositionHistoryChart } from "./project-position-history-chart";
import { ProviderLogo } from "./provider-logo";
import { UiText, useUiLocale } from "./ui-locale";


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
  readonly aiAnswers: readonly AiAnswerCollectionSummary[];
  readonly ranks: readonly RankJobSummary[];
  readonly crawls: TechnicalCrawlSettings;
  readonly research: KeywordResearchCollection;
  readonly positionSummary: ProjectPositionSummary;
  readonly positionHistory: ProjectPositionHistory;
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
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [data, setData] = useState<DashboardData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selectedJob, setSelectedJob] = useState<DashboardJob>();
  const [includeUntrackedHistory, setIncludeUntrackedHistory] = useState(false);
  const [untrackedPositionHistory, setUntrackedPositionHistory] =
    useState<ProjectPositionHistory>();
  const [positionHistoryScopeLoading, setPositionHistoryScopeLoading] =
    useState(false);
  const [positionHistoryScopeError, setPositionHistoryScopeError] =
    useState<string>();
  const positionHistoryScopeRequest = useRef<AbortController | undefined>(
    undefined
  );

  const load = useCallback(async (signal?: AbortSignal) => {
    const base = `/app/api/projects/${encodeURIComponent(projectId)}`;
    try {
      const [keywords, tracked, frequencies, aiAnswers, ranks, crawls, research, positionSummary, positionHistory] =
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
          browserApiRequest<{
            readonly collections: readonly AiAnswerCollectionSummary[];
          }>(`${base}/ai-answer-collections`, signal ? { signal } : {}),
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
          ),
          browserApiRequest<ProjectPositionHistory>(
            `${base}/keywords/position-history`,
            signal ? { signal } : {}
          )
        ]);
      if (signal?.aborted) return;
      setData({
        keywordCount: keywords.page.totalApprox ?? keywords.data.length,
        trackedCount: tracked.page.totalApprox ?? tracked.data.length,
        frequencies: frequencies.collections,
        aiAnswers: aiAnswers.collections,
        ranks: ranks.jobs,
        crawls,
        research,
        positionSummary,
        positionHistory
      });
      setIncludeUntrackedHistory(false);
      setUntrackedPositionHistory(undefined);
      setPositionHistoryScopeLoading(false);
      setPositionHistoryScopeError(undefined);
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
    return () => {
      controller.abort();
      positionHistoryScopeRequest.current?.abort();
    };
  }, [load]);

  const changePositionHistoryScope = useCallback(async (
    includeUntracked: boolean
  ) => {
    if (!includeUntracked) {
      positionHistoryScopeRequest.current?.abort();
      setIncludeUntrackedHistory(false);
      setPositionHistoryScopeLoading(false);
      setPositionHistoryScopeError(undefined);
      return;
    }
    if (untrackedPositionHistory) {
      setIncludeUntrackedHistory(true);
      setPositionHistoryScopeError(undefined);
      return;
    }

    positionHistoryScopeRequest.current?.abort();
    const controller = new AbortController();
    positionHistoryScopeRequest.current = controller;
    setPositionHistoryScopeLoading(true);
    setPositionHistoryScopeError(undefined);
    try {
      const history = await browserApiRequest<ProjectPositionHistory>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/position-history?includeUntracked=true`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      setUntrackedPositionHistory(history);
      setIncludeUntrackedHistory(true);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setPositionHistoryScopeError(dashboardError(requestError));
      }
    } finally {
      if (!controller.signal.aborted) setPositionHistoryScopeLoading(false);
    }
  }, [projectId, untrackedPositionHistory]);

  const jobs = useMemo(() => data ? dashboardJobs(data) : [], [data]);
  const activeCount = jobs.filter(({ status }) => activeStatus(status)).length;
  const completedCount = jobs.filter(({ status }) => completedStatus(status)).length;
  const failedCount = jobs.filter(({ status }) => failureStatus(status)).length;
  const trackedShare = data ? percentage(data.trackedCount, data.keywordCount) : 0;

  return (
    <>
      <section className="dashboard-heading">
        <div>
          <p className="dashboard-context">{projectName}</p>
          <h1><UiText text="Добрый день," after=" " />{firstName(userName)}</h1>
          <p><UiText text="Семантика, видимость и текущие операции проекта — в одной сводке." /></p>
        </div>
        <div className="dashboard-heading-actions">
          <a className="secondary-button" href="/app/tasks"><UiText text="Все операции" /></a>
          <a className="primary-button" href="/app/semantics">
            <Icon name="plus" />
            <span><UiText text="Добавить запросы" /></span>
          </a>
        </div>
      </section>

      {error && (
        <div className="dashboard-data-alert" role="alert">
          <span>{<UiText text={error ?? ""} />}</span>
          <button aria-label={uiText("Повторить загрузку")} onClick={() => void load()} type="button">
            <UiText text="Повторить" /></button>
        </div>
      )}

      <section className="metric-grid dashboard-live-metrics" aria-label={uiText("Ключевые показатели")}>
        <DashboardMetric
          label={uiText("Запросов")}
          value={data ? formatInteger(data.keywordCount, uiLocale) : loading ? "…" : "0"}
          hint={uiText("В семантическом ядре")}
          tone="violet"
        />
        <DashboardMetric
          label={uiText("Отслеживается")}
          value={data ? formatInteger(data.trackedCount, uiLocale) : loading ? "…" : "0"}
          hint={data ? uiText("{0}% от всех запросов", [String(trackedShare)]) : uiText("Для съёма позиций")}
          tone="blue"
        />
        <DashboardMetric
          label={uiText("Средняя позиция")}
          value={data?.positionSummary.averagePosition !== undefined ? formatPosition(data.positionSummary.averagePosition, uiLocale) : loading ? "…" : "—"}
          hint={data?.positionSummary.positionedKeywordCount ? uiText("По {0} запросам с позицией", [String(formatInteger(data.positionSummary.positionedKeywordCount, uiLocale))]) : uiText("Позиций пока нет")}
          tone="green"
        />
        <DashboardMetric
          label={uiText("В Топ-10")}
          value={data ? formatInteger(data.positionSummary.top10KeywordCount, uiLocale) : loading ? "…" : "0"}
          hint={data ? uiText("{0}% запросов с позицией", [String(percentage(data.positionSummary.top10KeywordCount, data.positionSummary.positionedKeywordCount))]) : uiText("Текущие позиции")}
          tone="amber"
        />
        <DashboardMetric
          label={uiText("В Топ-30")}
          value={data ? formatInteger(data.positionSummary.top30KeywordCount, uiLocale) : loading ? "…" : "0"}
          hint={data ? uiText("{0}% запросов с позицией", [String(percentage(data.positionSummary.top30KeywordCount, data.positionSummary.positionedKeywordCount))]) : uiText("Текущие позиции")}
          tone="rose"
        />
      </section>

      <section className="dashboard-rank-section">
        <article className="panel dashboard-rank-panel dashboard-rank-panel-full">
          <header className="panel-header">
            <div>
              <h2><UiText text="Позиции по ТОПам" /></h2>
              <p><UiText text="Динамика запросов в Топ-3, 5, 10, 30 и 50 — до 30 срезов" /></p>
            </div>
            <a className="text-button" href="/app/semantics"><UiText text="Открыть семантику" /></a>
          </header>
          {data ? (
            <ProjectPositionHistoryChart
              history={
                includeUntrackedHistory && untrackedPositionHistory
                  ? untrackedPositionHistory
                  : data.positionHistory
              }
              includeUntracked={includeUntrackedHistory}
              onIncludeUntrackedChange={(value) => {
                void changePositionHistoryScope(value);
              }}
              scopeLoading={positionHistoryScopeLoading}
              {...(positionHistoryScopeError
                ? { scopeError: positionHistoryScopeError }
                : {})}
            />
          ) : (
            <div className="panel-empty compact dashboard-panel-empty">
              <span className="state-icon"><Icon name="trend" /></span>
              <strong>{loading ? <UiText text="Загружаем историю позиций…" /> : <UiText text="История позиций недоступна" />}</strong>
              <p>{loading ? <UiText text="Подготавливаем данные графика." /> : <UiText text="Повторите загрузку проектного обзора." />}</p>
              {!loading && <a className="secondary-button" href="/app/semantics"><UiText text="Запустить съём" /></a>}
            </div>
          )}
        </article>

      </section>

      <section className="dashboard-lower-grid">
        <article className="panel dashboard-jobs-panel">
          <header className="panel-header">
            <div><h2><UiText text="Последние операции" /></h2><p><UiText text="Ход и результат фоновых задач проекта" /></p></div>
            <a className="text-button" href="/app/tasks"><UiText text="Показать все" /></a>
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
                    <small>{formatDateTime(job.createdAt, uiLocale)}</small>
                  </span>
                  <span className={activeStatus(job.status) ? "dashboard-job-status active" : failureStatus(job.status) ? "dashboard-job-status error" : "dashboard-job-status"}>
                    {<UiText text={operationStatusLabel(job.status, job.stage) ?? ""} />}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="panel-empty compact dashboard-panel-empty">
              <strong><UiText text="Операций пока нет" /></strong>
              <p><UiText text="Они появятся после первого сбора или проверки." /></p>
            </div>
          )}
        </article>

        <article className="panel dashboard-work-panel">
          <header className="panel-header">
            <div><h2><UiText text="Работа проекта" /></h2><p><UiText text="Состояние очереди и быстрый запуск" /></p></div>
          </header>
          <div className="dashboard-workload" aria-label={uiText("Состояние операций")}>
            <WorkloadStat label={uiText("Активно")} value={activeCount} tone="active" />
            <WorkloadStat label={uiText("Завершено")} value={completedCount} tone="success" />
            <WorkloadStat label={uiText("С ошибкой")} value={failedCount} tone="error" />
          </div>
          <div className="dashboard-quick-actions">
            <QuickAction href="/app/semantics" icon="semantic" label={uiText("Добавить запросы")} />
            <QuickAction href="/app/semantics" icon="positions" label={uiText("Проверить позиции")} />
          </div>
        </article>
      </section>
      {selectedJob && (
        <OperationResultModal
          description={`${selectedJob.provider ? dashboardProviderLabel(selectedJob.provider) : "SEOньорита"} · ${formatDateTime(selectedJob.createdAt, uiLocale)}`}
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
  tone: "violet" | "blue" | "green" | "amber" | "rose";
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
  const uiLocale = useUiLocale().locale;
  return (
    <div className={`dashboard-workload-stat is-${tone}`}>
      <span>{label}</span>
      <strong>{formatInteger(value, uiLocale)}</strong>
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
    ...data.aiAnswers.map((job): DashboardJob => ({
      id: job.id,
      title: aiAnswerCollectionTitle(job),
      provider: "ARSENKIN",
      status: job.status,
      ...(job.stage ? { stage: job.stage } : {}),
      createdAt: job.createdAt,
      resultKind: "ai-answer"
    })),
    ...data.ranks.map((job): DashboardJob => ({
      id: job.id,
      title: rankCollectionTitle(job),
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

function formatInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}

function formatPosition(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1
  }).format(value);
}

function formatDateTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function firstName(value: string): string {
  return value.trim().split(/\s+/u)[0] || value;
}

function dashboardError(error: unknown): string {
  return error instanceof BrowserApiError
    ? error.message
    : "Не удалось загрузить актуальные данные обзора.";
}
