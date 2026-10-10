"use client";
import { prepareFrequencyRetry, type FrequencyRetryDraft } from "../lib/frequency-retry";
import { SemanticFrequencyDialog } from "./semantic-frequency-dialog";
import { frequencyCollectionParameters, frequencyCollectionTitle } from "../lib/frequency-operation-presentation";
import { SemanticPositionDialog } from "./semantic-position-dialog";
import { prepareRankRetry, type RankRetryDraft } from "../lib/rank-retry";

import type {
  AiAnswerCollectionSummary,
  ClusteringRunSummary,
  FrequencyCollectionSummary,
  KeywordResearchCollection,
  KeywordResearchRunSummary,
  RankJobSummary,
  TechnicalCrawlSettings,
  TechnicalCrawlSummary,
  SemanticExportCollection,
  SemanticExportJobSummary
} from "@seo-platform/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { semanticExportFileUrl } from "../lib/app-path";
import { operationDurationLabel } from "../lib/operation-duration";
import {
  isDismissibleOperationStatus,
  operationDismissalPath
} from "../lib/operation-dismissal";
import {
  searchRegionDisplayName,
  seoRegionDisplayName
} from "../lib/seo-regions";
import {
  aiAnswerCollectionTitle,
  isCompetitorCollection,
  keywordResearchCollectionTitle,
  rankCollectionDepthLabel,
  rankCollectionTitle
} from "../lib/operation-collection-purpose";
import {
  connectorRouteTrail,
  connectorRoutingScopeLabel,
  hasConnectorFallback
} from "../lib/connector-routing-presentation";
import type { OperationResultKind } from "../lib/operation-result-routes";
import {
  arsenkinProviderProgressLabel,
  operationStageLabel,
  operationStatusLabel
} from "../lib/operation-status-presentation";
import {
  isCancellableRankJob,
  rankSearchSystemLabel
} from "../lib/rank-jobs";
import { CustomSelect } from "./custom-select";
import {
  OperationResultModal,
  OperationRetryIcon,
  OperationStopIcon
} from "./operation-result-modal";
import { OperationStopConfirmation } from "./operation-stop-confirmation";
import { OperationDismissConfirmation } from "./operation-dismiss-confirmation";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";
import { ProjectContextSelect } from "./project-context-select";
import type { AppProject } from "../lib/app-types";
import { UiText, useUiLocale } from "./ui-locale";


type TaskKind =
  | "FREQUENCY"
  | "AI_ANSWER"
  | "AI_COMPETITOR_SERP"
  | "CLUSTERING"
  | "RANK"
  | "COMPETITOR_SERP"
  | "CRAWL"
  | "RESEARCH"
  | "EXPORT";
type TaskColumn = "QUEUED" | "RUNNING" | "ATTENTION" | "COMPLETED";
type TaskTab = "ALL" | "ACTIVE" | "ERRORS" | "COMPLETED";

interface TaskFact {
  readonly label: string;
  readonly value: string;
}

interface ProjectTask {
  readonly id: string;
  readonly kind: TaskKind;
  readonly resultKind?: OperationResultKind;
  readonly downloadUrl?: string;
  readonly title: string;
  readonly description: string;
  readonly provider?: "XMLSTOCK" | "ARSENKIN" | "KEYS_SO";
  readonly statusLabel: string;
  readonly column: TaskColumn;
  readonly progressCurrent: number;
  readonly progressTotal: number;
  readonly providerProgressPercent?: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly errorCode?: string;
  readonly version: number;
  readonly cancellable: boolean;
  readonly dismissible: boolean;
  readonly retryable: boolean;
  readonly retryLabel: string;
  readonly inputFacts: readonly TaskFact[];
  readonly resultFacts: readonly TaskFact[];
}

export function TaskCenter({
  currentUserId,
  canReorderProjects,
  projectId,
  projects,
  workspaceId
}: Readonly<{
  currentUserId: string;
  canReorderProjects: boolean;
  projectId: string;
  projects: readonly AppProject[];
  workspaceId: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const [rankRetry, setRankRetry] = useState<RankRetryDraft>();
  const [frequencyRetry, setFrequencyRetry] = useState<FrequencyRetryDraft>();
  const frequencyRetryLoad = useRef<AbortController | undefined>(undefined);
  const { t: uiText } = useUiLocale();
  const [frequencies, setFrequencies] = useState<readonly FrequencyCollectionSummary[]>([]);
  const [aiAnswers, setAiAnswers] = useState<readonly AiAnswerCollectionSummary[]>([]);
  const [clusteringRuns, setClusteringRuns] = useState<readonly ClusteringRunSummary[]>([]);
  const [ranks, setRanks] = useState<readonly RankJobSummary[]>([]);
  const [crawls, setCrawls] = useState<readonly TechnicalCrawlSummary[]>([]);
  const [research, setResearch] = useState<readonly KeywordResearchRunSummary[]>([]);
  const [semanticExports, setSemanticExports] = useState<readonly SemanticExportJobSummary[]>([]);
  const [tab, setTab] = useState<TaskTab>("ALL");
  const [kind, setKind] = useState<TaskKind | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [resultId, setResultId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [stopConfirmation, setStopConfirmation] = useState<ProjectTask>();
  const [dismissConfirmation, setDismissConfirmation] = useState<ProjectTask>();
  const requestInFlight = useRef(false);

  useEffect(() => {
    setDismissConfirmation(undefined);
    setFrequencyRetry(undefined);
    setRankRetry(undefined);
    setResultId(undefined);
    setStopConfirmation(undefined);
    return () => frequencyRetryLoad.current?.abort();
  }, [projectId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const base = `/app/api/projects/${encodeURIComponent(projectId)}`;
      const results = await Promise.allSettled([
        browserApiRequest<{ readonly collections: readonly FrequencyCollectionSummary[] }>(
          `${base}/frequency-collections`,
          signal ? { signal } : {}
        ),
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
        browserApiRequest<{ readonly collections: readonly AiAnswerCollectionSummary[] }>(
          `${base}/ai-answer-collections`,
          signal ? { signal } : {}
        ),
        browserApiRequest<{ readonly runs: readonly ClusteringRunSummary[] }>(
          `${base}/clustering-runs`,
          signal ? { signal } : {}
        ),
        browserApiRequest<SemanticExportCollection>(
          `${base}/exports`,
          signal ? { signal } : {}
        )
      ]);
      if (signal?.aborted) return;
      const [frequencyResult, rankResult, crawlResult, researchResult, aiAnswerResult, clusteringResult, exportResult] = results;
      if (frequencyResult?.status === "fulfilled") setFrequencies(frequencyResult.value.collections);
      if (rankResult?.status === "fulfilled") setRanks(rankResult.value.jobs);
      if (crawlResult?.status === "fulfilled") setCrawls(crawlResult.value.crawls);
      if (researchResult?.status === "fulfilled") setResearch(researchResult.value.runs);
      if (aiAnswerResult?.status === "fulfilled") setAiAnswers(aiAnswerResult.value.collections);
      if (clusteringResult?.status === "fulfilled") setClusteringRuns(clusteringResult.value.runs);
      if (exportResult?.status === "fulfilled") setSemanticExports(exportResult.value.exports);
      setErrors(
        results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => taskError(result.reason))
          .filter((message, index, values) => values.indexOf(message) === index)
      );
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
      requestInFlight.current = false;
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(controller.signal);
    }, 5_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load(controller.signal);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [load]);

  const tasks = useMemo(() => [
    ...frequencies.map(value => frequencyTask(value, uiLocale)),
    ...aiAnswers.map(value => aiAnswerTask(value, uiLocale)),
    ...clusteringRuns.map(value => clusteringTask(value, uiLocale)),
    ...ranks.map(value => rankTask(value, uiLocale)),
    ...crawls.map(value => crawlTask(value, uiLocale)),
    ...research.map(value => researchTask(value, uiLocale)),
    ...semanticExports.map((value) => exportTask(value, projectId, uiLocale))
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [
    aiAnswers,
    clusteringRuns,
    crawls,
    frequencies,
    ranks,
    research,
    semanticExports,
    projectId, uiLocale
  ]);

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
    return tasks.filter((task) => {
      if (kind !== "ALL" && task.kind !== kind) return false;
      if (tab === "ACTIVE" && !["QUEUED", "RUNNING"].includes(task.column)) return false;
      if (tab === "ERRORS" && task.column !== "ATTENTION") return false;
      if (tab === "COMPLETED" && task.column !== "COMPLETED") return false;
      return normalizedQuery.length === 0 ||
        `${task.title} ${task.description} ${task.statusLabel} ${task.id}`
          .toLocaleLowerCase("ru-RU")
          .includes(normalizedQuery);
    });
  }, [kind, query, tab, tasks]);

  const counts = useMemo(() => ({
    ALL: tasks.length,
    ACTIVE: tasks.filter(({ column }) => column === "QUEUED" || column === "RUNNING").length,
    ERRORS: tasks.filter(({ column }) => column === "ATTENTION").length,
    COMPLETED: tasks.filter(({ column }) => column === "COMPLETED").length
  }), [tasks]);
  const resultTask = tasks.find(({ id }) => id === resultId);

  async function mutate(task: ProjectTask, action: "cancel" | "retry"): Promise<void> {
    const current = tasks.find(({ id, kind }) =>
      id === task.id && kind === task.kind
    ) ?? task;
    if (action === "cancel" && !current.cancellable) {
      await load();
      return;
    }
    setBusyId(current.id);
    setErrors([]);
    const base = `/app/api/projects/${encodeURIComponent(projectId)}`;
    try {
      if (action === "retry") {
        if (isRankTaskKind(current.kind)) {
          frequencyRetryLoad.current?.abort();
          const controller = new AbortController(); frequencyRetryLoad.current = controller;
          const draft = await prepareRankRetry(projectId, current.id, controller.signal);
          if (!controller.signal.aborted) setRankRetry(draft);
        } else {
          frequencyRetryLoad.current?.abort();
          const controller = new AbortController(); frequencyRetryLoad.current = controller;
          const draft = await prepareFrequencyRetry(projectId, current.id, controller.signal);
          if (!controller.signal.aborted) setFrequencyRetry(draft);
        }
      } else if (current.kind === "FREQUENCY") {
        await browserApiRequest(
          `${base}/frequency-collections/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {} }
        );
      } else if (isRankTaskKind(current.kind)) {
        await browserApiRequest(
          `${base}/jobs/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {} }
        );
      } else if (current.kind === "CRAWL") {
        await browserApiRequest(
          `${base}/crawls/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {}, ifMatch: current.version }
        );
      } else if (isAiAnswerTaskKind(current.kind)) {
        await browserApiRequest(
          `${base}/ai-answer-collections/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {} }
        );
      } else if (current.kind === "CLUSTERING") {
        await browserApiRequest(
          `${base}/clustering-runs/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {} }
        );
      } else if (current.kind === "EXPORT") {
        await browserApiRequest(
          `${base}/exports/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {}, ifMatch: current.version }
        );
      } else {
        await browserApiRequest(
          `${base}/keyword-research-runs/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {}, ifMatch: current.version }
        );
      }
      await load();
    } catch (requestError) {
      setErrors([taskError(requestError)]);
    } finally {
      setBusyId(undefined);
    }
  }

  async function dismiss(task: ProjectTask): Promise<void> {
    const current = tasks.find(({ id, kind }) =>
      id === task.id && kind === task.kind
    ) ?? task;
    if (!current.dismissible) {
      setDismissConfirmation(undefined);
      await load();
      return;
    }
    setBusyId(current.id);
    setErrors([]);
    try {
      await browserApiRequest(operationDismissalPath(projectId, current.id), {
        method: "DELETE"
      });
      setFrequencies((items) => items.filter(({ id }) => id !== current.id));
      setAiAnswers((items) => items.filter(({ id }) => id !== current.id));
      setClusteringRuns((items) => items.filter(({ id }) => id !== current.id));
      setRanks((items) => items.filter(({ id }) => id !== current.id));
      setCrawls((items) => items.filter(({ id }) => id !== current.id));
      setResearch((items) => items.filter(({ id }) => id !== current.id));
      setSemanticExports((items) => items.filter(({ id }) => id !== current.id));
      setResultId(undefined);
      setDismissConfirmation(undefined);
      await load();
    } catch (requestError) {
      setErrors([taskError(requestError)]);
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className="task-center">
      {rankRetry && <SemanticPositionDialog projectId={projectId} workspaceId={rankRetry.result.job.workspaceId} groups={rankRetry.groups} initialSelections={rankRetry.selections} initialRun={rankRetry.result} mode={rankRetry.result.execution.purpose === "COMPETITOR_SERP" ? "competitors" : "positions"} onClose={() => setRankRetry(undefined)} onStarted={() => { setRankRetry(undefined); void load(); }} />}
      {frequencyRetry && <SemanticFrequencyDialog currentUserId={currentUserId} projectId={projectId} workspaceId={workspaceId} groups={frequencyRetry.groups} initialSelections={frequencyRetry.selections} initialConfiguration={frequencyRetry.collection} onClose={() => setFrequencyRetry(undefined)} onStarted={() => { setFrequencyRetry(undefined); void load(); }} />}
      <header className="task-center-header">
        <div>
          <div className="project-page-title-row">
            <h1><UiText text="История операций" /></h1>
            <ProjectContextSelect
              canReorder={canReorderProjects}
              destination="tasks"
              projectId={projectId}
              projects={projects}
              workspaceId={workspaceId}
            />
          </div>
          <p><UiText text="Построчный журнал запусков с входными параметрами, прогрессом и результатом." /></p>
        </div>
        <div className="task-center-header-actions">
          <a className="primary-button" href="/app/tools"><UiText text="Новая задача" /></a>
        </div>
      </header>

      <div className="task-center-toolbar">
        <div className="task-center-tabs" role="tablist">
          {(["ALL", "ACTIVE", "ERRORS", "COMPLETED"] as const).map((value) => (
            <button aria-selected={tab === value} key={value} onClick={() => setTab(value)} role="tab" type="button">
              {<UiText text={taskTabLabel(value) ?? ""} />} <span>{counts[value]}</span>
            </button>
          ))}
        </div>
        <label className="task-center-search">
          <span className="visually-hidden"><UiText text="Поиск задачи" /></span>
          <input onChange={(event) => setQuery(event.currentTarget.value)} placeholder={uiText("Название, статус или ID")} type="search" value={query} />
        </label>
        <CustomSelect aria-label={uiText("Тип операции")} onChange={(event) => setKind(event.currentTarget.value as TaskKind | "ALL")} value={kind}>
          <option value="ALL"><UiText text="Все операции" /></option>
          <option value="FREQUENCY"><UiText text="Частотность" /></option>
          <option value="AI_ANSWER"><UiText text="ИИ-ответы" /></option>
          <option value="AI_COMPETITOR_SERP"><UiText text="ИИ-конкуренты" /></option>
          <option value="CLUSTERING"><UiText text="Кластеризация" /></option>
          <option value="RANK"><UiText text="Позиции" /></option>
          <option value="COMPETITOR_SERP"><UiText text="Выдача конкурентов" /></option>
          <option value="CRAWL"><UiText text="Аудиты" /></option>
          <option value="RESEARCH"><UiText text="Исследование запросов" /></option>
          <option value="EXPORT"><UiText text="Экспорт" /></option>
        </CustomSelect>
      </div>

      {errors.length > 0 && (
        <div className="task-center-alert" role="alert">
          <strong><UiText text="Часть журнала временно недоступна" /></strong>
          <span>{errors.join(" · ")}</span>
          <button aria-label={uiText("Закрыть сообщение")} onClick={() => setErrors([])} type="button">×</button>
        </div>
      )}

      {loading ? (
        <div className="task-center-loading" role="status"><UiText text="Загружаем операции проекта…" /></div>
      ) : (
        <div className="task-center-layout">
          <section className="task-ledger" aria-label={uiText("Журнал операций")}>
            <header className="task-ledger-header" aria-hidden="true">
              <span><UiText text="Операция" /></span>
              <span><UiText text="Статус" /></span>
              <span><UiText text="Результат" /></span>
              <span><UiText text="Время" /></span>
            </header>
            {visibleTasks.length > 0 ? visibleTasks.map((task) => (
              <button
                aria-pressed={task.resultKind ? resultId === task.id : undefined}
                className="task-ledger-row"
                disabled={!task.resultKind && !task.downloadUrl && !task.dismissible}
                key={`${task.kind}:${task.id}`}
                onClick={() => {
                  if (task.downloadUrl) {
                    window.location.assign(task.downloadUrl);
                  } else if (task.resultKind) {
                    setResultId(task.id);
                  } else if (task.dismissible) {
                    setDismissConfirmation(task);
                  }
                }}
                title={task.downloadUrl ? uiText("Скачать готовый файл") : undefined}
                type="button"
              >
                <span className="task-ledger-operation">
                  {task.provider ? <ProviderLogo provider={task.provider} size="compact" /> : <span aria-hidden="true" className="task-kind-mark">↗</span>}
                  <span><strong>{task.title}</strong><small>{task.description}</small></span>
                </span>
                <span><span className={`task-status is-${task.column.toLowerCase()}`}>{task.statusLabel}</span></span>
                <span className="task-ledger-result">
                  <strong>{<UiText text={progressLabel(task, uiLocale) ?? ""} />}</strong>
                  {task.progressTotal > 0 && <span className="task-card-progress"><i style={{ width: `${taskPercent(task)}%` }} /></span>}
                  {task.providerProgressPercent !== undefined && <small className="task-provider-progress">{arsenkinProviderProgressLabel(task.providerProgressPercent, uiLocale)}</small>}
                </span>
                <span className="task-ledger-time">
                  <time>{formatRelativeDate(task.createdAt, uiLocale)}</time>
                  {operationDurationLabel(task) && <small><UiText text="За" after=" " />{<UiText text={operationDurationLabel(task) ?? ""} />}</small>}
                  <code>{shortId(task.id)}</code>
                </span>
              </button>
            )) : (
              <div className="task-ledger-empty">
                <strong><UiText text="Операций по выбранным условиям нет" /></strong>
                <span><UiText text="Измените фильтр или запустите новую задачу." /></span>
              </div>
            )}
          </section>
        </div>
      )}
      {resultTask?.resultKind && (
        <OperationResultModal
          actions={(
            <>
              {resultTask.retryable && (
                <button
                  aria-label={busyId === resultTask.id ? uiText("Повтор запускается") : resultTask.retryLabel}
                  className="operation-result-header-action"
                  disabled={busyId === resultTask.id}
                  onClick={() => void mutate(resultTask, "retry")}
                  title={busyId === resultTask.id ? uiText("Повтор запускается…") : resultTask.retryLabel}
                  type="button"
                >
                  <OperationRetryIcon />
                </button>
              )}
              {resultTask.cancellable && (
                <button
                  aria-label={busyId === resultTask.id ? uiText("Операция останавливается") : uiText("Остановить операцию")}
                  className="operation-result-header-action is-danger"
                  disabled={busyId === resultTask.id}
                  onClick={() => setStopConfirmation(resultTask)}
                  title={busyId === resultTask.id ? uiText("Останавливаем…") : uiText("Остановить операцию")}
                  type="button"
                >
                  <OperationStopIcon />
                </button>
              )}
              {resultTask.dismissible && (
                <button
                  aria-label={uiText("Удалить операцию?")}
                  className="operation-result-header-action is-danger"
                  disabled={busyId === resultTask.id}
                  onClick={() => setDismissConfirmation(resultTask)}
                  title={uiText("Удалить операцию?")}
                  type="button"
                >
                  <Icon name="trash" />
                </button>
              )}
            </>
          )}
          description={`${resultTask.description} · ${formatDateTime(resultTask.createdAt, uiLocale)}`}
          kind={resultTask.resultKind}
          onClose={() => setResultId(undefined)}
          operationId={resultTask.id}
          projectId={projectId}
          title={resultTask.title}
        />
      )}
      {stopConfirmation && (
        <OperationStopConfirmation
          busy={busyId === stopConfirmation.id}
          description={stopConfirmation.description}
          onCancel={() => setStopConfirmation(undefined)}
          onConfirm={() => {
            void mutate(stopConfirmation, "cancel").then(() =>
              setStopConfirmation(undefined)
            );
          }}
          title={stopConfirmation.title}
        />
      )}
      {dismissConfirmation && (
        <OperationDismissConfirmation
          busy={busyId === dismissConfirmation.id}
          description={dismissConfirmation.description}
          onCancel={() => setDismissConfirmation(undefined)}
          onConfirm={() => void dismiss(dismissConfirmation)}
          title={dismissConfirmation.title}
        />
      )}
    </section>
  );
}

function frequencyTask(value: FrequencyCollectionSummary, uiLocale: string = "ru-RU"): ProjectTask {
  const completed = value.completedKeywords + value.failedKeywords;
  const routeTrail = connectorRouteTrail(value.connectorAttempts);
  const seasonality = value.mode === "SEASONALITY";
  return {
    id: value.id, kind: "FREQUENCY", resultKind: "frequency", provider: value.provider, title: frequencyCollectionTitle(value),
    description: seasonality
      ? `${providerLabel(value.provider)} · ${frequencyCollectionParameters(value)}`
      : `${providerLabel(value.provider)}${hasConnectorFallback(value.connectorAttempts) ? " · fallback" : ""} · ${value.types.map(frequencyTypeLabel).join(" + ")}`,
    statusLabel: operationStatusLabel(value.status, value.stage), column: taskColumn(value.status), progressCurrent: completed,
    progressTotal: value.selectedKeywords, createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    version: value.version,
    cancellable: ["QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRY_SCHEDULED", "FAILED_RETRYABLE"].includes(value.status),
    dismissible: isDismissibleOperationStatus(value.status),
    retryable: !value.requiresUsageReview && ["FAILED_FINAL", "PARTIALLY_COMPLETED", "ACTION_REQUIRED", "CANCELLED"].includes(value.status),
    retryLabel: value.status === "CANCELLED" ? "Продолжить" : "Повторить ошибки",
    inputFacts: [
      { label: "Источник", value: providerLabel(value.provider) },
      { label: seasonality ? "Детализация" : "Виды частотности", value: seasonality ? value.seasonality?.granularity ?? "—" : value.types.map(frequencyTypeLabel).join(" · ") },
      ...(seasonality && value.seasonality
        ? [{ label: "Период", value: `${value.seasonality.observedFrom} — ${value.seasonality.observedThrough}` }]
        : []),
      { label: "Регион", value: seoRegionDisplayName("WORDSTAT", value.regionCode) },
      { label: "Устройство", value: frequencyDeviceLabel(value.device) },
      { label: "Ключей", value: formatInteger(value.selectedKeywords, uiLocale) },
      ...(value.routingScope
        ? [{ label: "Маршрут", value: connectorRoutingScopeLabel(value.routingScope) }]
        : []),
      ...(routeTrail ? [{ label: "Попытки", value: routeTrail }] : [])
    ],
    resultFacts: [
      { label: "Обработано", value: formatInteger(value.completedKeywords, uiLocale) },
      { label: "С ошибкой", value: formatInteger(value.failedKeywords, uiLocale) },
      { label: "Этап", value: operationStageLabel(value.stage, value.status) }
    ]
  };
}

function aiAnswerTask(value: AiAnswerCollectionSummary, uiLocale: string = "ru-RU"): ProjectTask {
  const completed = value.completedKeywords + value.failedKeywords;
  const routeTrail = connectorRouteTrail(value.connectorAttempts);
  const competitorCollection = isCompetitorCollection(value);
  return {
    id: value.id,
    kind: competitorCollection ? "AI_COMPETITOR_SERP" : "AI_ANSWER",
    resultKind: "ai-answer",
    provider: "ARSENKIN",
    title: aiAnswerCollectionTitle(value),
    description: `Arsenkin Tools · ${value.searchEngine === "YANDEX" ? "Яндекс" : "Google"} · ${frequencyDeviceLabel(value.device)}`,
    statusLabel: operationStatusLabel(value.status, value.stage),
    column: taskColumn(value.status),
    progressCurrent: completed,
    progressTotal: value.selectedKeywords,
    ...(value.providerProgressPercent === undefined ? {} : { providerProgressPercent: value.providerProgressPercent }),
    createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    version: value.version,
    cancellable: [
      "QUEUED",
      "RUNNING",
      "WAITING_RATE_LIMIT",
      "RETRY_SCHEDULED",
      "FAILED_RETRYABLE"
    ].includes(value.status),
    dismissible: isDismissibleOperationStatus(value.status),
    retryable: false,
    retryLabel: "",
    inputFacts: [
      { label: "Поисковая система", value: value.searchEngine === "YANDEX" ? "Яндекс" : "Google" },
      { label: "Регион", value: searchRegionDisplayName(value.searchEngine, value.regionCode) },
      { label: "Устройство", value: frequencyDeviceLabel(value.device) },
      { label: "Ключей", value: formatInteger(value.selectedKeywords, uiLocale) },
      ...(value.routingScope
        ? [{ label: "Маршрут", value: connectorRoutingScopeLabel(value.routingScope) }]
        : []),
      ...(routeTrail ? [{ label: "Попытки", value: routeTrail }] : [])
    ],
    resultFacts: [
      { label: "Сохранено", value: formatInteger(value.completedKeywords, uiLocale) },
      { label: "С ошибкой", value: formatInteger(value.failedKeywords, uiLocale) },
      { label: "Этап", value: operationStageLabel(value.stage, value.status) },
      ...(value.providerProgressPercent === undefined ? [] : [{ label: "Arsenkin", value: `${value.providerProgressPercent}% · текущая задача` }])
    ]
  };
}

function clusteringTask(value: ClusteringRunSummary, uiLocale: string = "ru-RU"): ProjectTask {
  const completed = value.completedKeywords + value.failedKeywords;
  const routeTrail = connectorRouteTrail(value.connectorAttempts);
  const engine = value.searchEngine === "YANDEX" ? "Яндекс" : "Google";
  return {
    id: value.id,
    kind: "CLUSTERING",
    resultKind: "clustering",
    provider: "ARSENKIN",
    title: "Кластеризация запросов",
    description: `Arsenkin Tools · ${engine} · ТОП-${value.depth} · ${value.method === "SOFT" ? "мягкая" : "жёсткая"}`,
    statusLabel: operationStatusLabel(value.status, value.stage),
    column: taskColumn(value.status),
    progressCurrent: completed,
    progressTotal: value.selectedKeywords,
    createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    version: value.version,
    cancellable: [
      "QUEUED",
      "RUNNING",
      "WAITING_RATE_LIMIT",
      "RETRY_SCHEDULED",
      "FAILED_RETRYABLE"
    ].includes(value.status),
    dismissible: isDismissibleOperationStatus(value.status),
    retryable: false,
    retryLabel: "",
    inputFacts: [
      { label: "Поисковая система", value: engine },
      { label: "Регион", value: searchRegionDisplayName(value.searchEngine, value.regionCode) },
      { label: "Метод", value: value.method === "SOFT" ? "Мягкий" : "Жёсткий" },
      { label: "Совпадений", value: String(value.overlapCount) },
      { label: "Глубина", value: `ТОП-${value.depth}` },
      { label: "Частотность", value: value.frequencyTypes.length > 0
        ? value.frequencyTypes.map(clusteringFrequencyTypeLabel).join(", ")
        : "Не собирать" },
      { label: "Главные страницы", value: value.excludeMainPages ? "Исключать" : "Учитывать" },
      { label: "Стоп-домены", value: formatInteger(value.stopDomains.length, uiLocale) },
      { label: "Перекластеризация", value: value.replaceExistingClusters ? "Разрешена" : "Не менять готовые кластеры" },
      { label: "Запросов", value: formatInteger(value.selectedKeywords, uiLocale) },
      ...(value.routingScope
        ? [{ label: "Маршрут", value: connectorRoutingScopeLabel(value.routingScope) }]
        : []),
      ...(routeTrail ? [{ label: "Попытки", value: routeTrail }] : [])
    ],
    resultFacts: [
      { label: "Обработано", value: formatInteger(value.completedKeywords, uiLocale) },
      { label: "Кластеров", value: value.clusterCount === undefined ? "—" : formatInteger(value.clusterCount, uiLocale) },
      { label: "Без кластера", value: value.unclusteredCount === undefined ? "—" : formatInteger(value.unclusteredCount, uiLocale) },
      { label: "Этап", value: operationStageLabel(value.stage, value.status) }
    ]
  };
}

function rankTask(value: RankJobSummary, uiLocale: string = "ru-RU"): ProjectTask {
  const result = value.result;
  const provider = providerLabel(value.provider);
  const searchContext = rankSearchContextLabel(value);
  const routeTrail = connectorRouteTrail(value.connectorAttempts);
  const competitorCollection = isCompetitorCollection(value);
  const depthLabel = rankCollectionDepthLabel(value, value.depth);
  return {
    id: value.id, kind: competitorCollection ? "COMPETITOR_SERP" : "RANK", resultKind: "rank", provider: value.provider, title: rankCollectionTitle(value),
    description: `${provider}${hasConnectorFallback(value.connectorAttempts) ? " · fallback" : ""}${searchContext ? ` · ${searchContext}` : ""}`, statusLabel: operationStatusLabel(value.status, value.stage),
    column: taskColumn(value.status), progressCurrent: Number(value.progress.current), progressTotal: Number(value.progress.total),
    createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(value.status === "FAILED" || value.status === "ACTION_REQUIRED" ? { errorCode: value.failure.code } : {}),
    version: 1,
    cancellable: isCancellableRankJob(value),
    dismissible: isDismissibleOperationStatus(value.status),
    retryable:
      (value.status === "PARTIALLY_COMPLETED" || value.status === "CANCELLED") &&
      (value.status === "CANCELLED" || Number(value.result.failedCount) > 0) &&
      Number(value.result?.submitOutcomeUnknownCount ?? "0") === 0,
    retryLabel: value.status === "CANCELLED"
      ? "Продолжить"
      : competitorCollection ? "Дособрать конкурентов" : "Дособрать позиции",
    inputFacts: [
      { label: "Провайдер", value: provider },
      ...(value.searchEngine
        ? [{ label: "Поисковая система", value: rankSearchSystemLabel(value.searchEngine, value.searchSource, value.yandexLiveMode, value.provider) }]
        : []),
      ...(depthLabel ? [{ label: "Глубина", value: depthLabel }] : []),
      { label: "Профиль съёма", value: value.trackingContextId },
      { label: "Ключей", value: formatInteger(Number(value.progress.total), uiLocale) },
      { label: "Этап", value: rankStageLabel(value.stage) },
      ...(value.routingScope
        ? [{ label: "Маршрут", value: connectorRoutingScopeLabel(value.routingScope) }]
        : []),
      ...(routeTrail ? [{ label: "Попытки", value: routeTrail }] : [])
    ],
    resultFacts: result ? [
      { label: "Сохранено", value: formatInteger(Number(result.persistedCount), uiLocale) },
      { label: "Найдено", value: formatInteger(Number(result.foundCount), uiLocale) },
      { label: "Не найдено", value: formatInteger(Number(result.notFoundCount), uiLocale) },
      { label: "Ошибок", value: formatInteger(Number(result.failedCount), uiLocale) }
    ] : [
      { label: "Обработано", value: `${formatInteger(Number(value.progress.current), uiLocale)} из ${formatInteger(Number(value.progress.total), uiLocale)}` }
    ]
  };
}

function crawlTask(value: TechnicalCrawlSummary, uiLocale: string = "ru-RU"): ProjectTask {
  const httpStatusCheck = value.config.purpose === "HTTP_STATUS_CHECK";
  return {
    id: value.id, kind: "CRAWL", resultKind: "crawl", title: httpStatusCheck ? "Обход сайта" : "Технический аудит",
    description: `${value.config.startUrls.length} стартовых URL · до ${formatInteger(value.config.maxUrls, uiLocale)} страниц`,
    statusLabel: operationStatusLabel(value.status), column: taskColumn(value.status), progressCurrent: value.processedUrls,
    progressTotal: Math.max(value.discoveredUrls, value.processedUrls), createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}), ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    version: value.version,
    cancellable: ["QUEUED", "RUNNING"].includes(value.status), dismissible: isDismissibleOperationStatus(value.status), retryable: false,
    retryLabel: "Повторить",
    inputFacts: [
      { label: "Стартовые URL", value: crawlStartLabel(value.config.startUrls) },
      { label: "Лимит страниц", value: formatInteger(value.config.maxUrls, uiLocale) },
      { label: "Глубина", value: String(value.config.maxDepth) },
      { label: "Скорость", value: `${formatInteger(value.config.requestsPerMinute, uiLocale)} запросов/мин` }
    ],
    resultFacts: [
      { label: "Обнаружено", value: formatInteger(value.discoveredUrls, uiLocale) },
      { label: "Обработано", value: formatInteger(value.processedUrls, uiLocale) },
      { label: "Успешно", value: formatInteger(value.successfulUrls, uiLocale) },
      { label: "Ошибок загрузки", value: formatInteger(value.failedUrls, uiLocale) },
      ...(httpStatusCheck
        ? []
        : [{ label: "SEO-проблем", value: formatInteger(value.issueCount, uiLocale) }])
    ]
  };
}

function researchTask(value: KeywordResearchRunSummary, uiLocale: string = "ru-RU"): ProjectTask {
  const keysSo = value.source === "KEYS_SO";
  const providerName = value.provider === "XMLSTOCK"
    ? "XMLStock"
    : value.provider === "ARSENKIN"
      ? "Arsenkin Tools"
      : "Keys.so";
  return {
    id: value.id, kind: "RESEARCH", resultKind: "research", provider: value.provider, title: keywordResearchCollectionTitle(value),
    description: keysSo
      ? `Keys.so · ${value.domain ?? "—"} · ${(value.database ?? "msk").toUpperCase()}`
      : `${providerName} · ${value.seedCount ?? 0} исходных фраз · ${seoRegionDisplayName("WORDSTAT", value.regionCode ?? "225")}`,
    statusLabel: operationStatusLabel(value.status),
    column: taskColumn(value.status), progressCurrent: value.importedKeywords > 0 ? value.importedKeywords : value.collectedKeywords,
    progressTotal: value.totalAvailable ?? value.maxKeywords, createdAt: value.createdAt,
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}), ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    version: value.version,
    cancellable: ["QUEUED", "RUNNING", "RETRY_SCHEDULED", "READY_TO_IMPORT"].includes(value.status), dismissible: isDismissibleOperationStatus(value.status), retryable: false,
    retryLabel: "Повторить",
    inputFacts: [
      ...(keysSo
        ? [
            { label: "Домен", value: value.domain ?? "—" },
            { label: "База", value: (value.database ?? "msk").toUpperCase() }
          ]
        : [
            { label: "Исходных фраз", value: formatInteger(value.seedCount ?? 0, uiLocale) },
            { label: "Регион", value: seoRegionDisplayName("WORDSTAT", value.regionCode ?? "225") }
          ]),
      { label: "Лимит ключей", value: formatInteger(value.maxKeywords, uiLocale) }
    ],
    resultFacts: [
      { label: "Найдено", value: formatInteger(value.collectedKeywords, uiLocale) },
      { label: "Выбрано", value: formatInteger(value.selectedKeywords, uiLocale) },
      { label: "Импортировано", value: formatInteger(value.importedKeywords, uiLocale) },
      { label: "Доступно у источника", value: value.totalAvailable === undefined ? "—" : formatInteger(value.totalAvailable, uiLocale) }
    ]
  };
}

function exportTask(
  value: SemanticExportJobSummary,
  projectId: string, uiLocale: string = "ru-RU"
): ProjectTask {
  const complete = value.status === "COMPLETED";
  const total = value.totalRows ?? value.rowCount ?? value.processedRows;
  return {
    id: value.id,
    kind: "EXPORT",
    title: `Экспорт семантики · ${exportFormatLabel(value.format)}`,
    description: `${exportScopeLabel(value.scope)}${value.filename ? ` · ${value.filename}` : ""}`,
    statusLabel: operationStatusLabel(value.status, value.stage),
    column: taskColumn(value.status),
    progressCurrent: complete ? total : value.processedRows,
    progressTotal: total,
    createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    ...(complete ? { downloadUrl: semanticExportFileUrl(projectId, value.id) } : {}),
    version: value.version,
    cancellable: [
      "QUEUED",
      "RUNNING",
      "RETRY_SCHEDULED",
      "FAILED_RETRYABLE"
    ].includes(value.status),
    dismissible: isDismissibleOperationStatus(value.status),
    retryable: false,
    retryLabel: "",
    inputFacts: [
      { label: "Формат", value: exportFormatLabel(value.format) },
      { label: "Охват", value: exportScopeLabel(value.scope) }
    ],
    resultFacts: [
      { label: "Строк", value: formatInteger(value.rowCount ?? value.processedRows, uiLocale) },
      ...(value.sizeBytes ? [{ label: "Размер", value: formatByteString(value.sizeBytes) }] : [])
    ]
  };
}

function taskColumn(status: string): TaskColumn {
  if (["QUEUED", "PREPARING", "RETRY_SCHEDULED", "WAITING_RATE_LIMIT"].includes(status)) return "QUEUED";
  if (["RUNNING", "IMPORT_QUEUED", "IMPORTING", "CANCEL_REQUESTED", "FAILED_RETRYABLE"].includes(status)) return "RUNNING";
  if (["FAILED", "FAILED_FINAL", "ACTION_REQUIRED", "PARTIALLY_COMPLETED", "READY_TO_IMPORT"].includes(status)) return "ATTENTION";
  return "COMPLETED";
}


function taskTabLabel(tab: TaskTab): string { return { ALL: "Все", ACTIVE: "Активные", ERRORS: "Требуют внимания", COMPLETED: "Завершённые" }[tab]; }
function providerLabel(provider: "XMLSTOCK" | "ARSENKIN"): string { return provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools"; }
function rankSearchContextLabel(value: RankJobSummary): string | undefined {
  const parts = [
    value.searchEngine
      ? rankSearchSystemLabel(value.searchEngine, value.searchSource, value.yandexLiveMode, value.provider)
      : undefined,
    rankCollectionDepthLabel(value, value.depth)
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
function isRankTaskKind(kind: TaskKind): boolean {
  return kind === "RANK" || kind === "COMPETITOR_SERP";
}
function isAiAnswerTaskKind(kind: TaskKind): boolean {
  return kind === "AI_ANSWER" || kind === "AI_COMPETITOR_SERP";
}
function frequencyTypeLabel(type: string): string { return ({ BASE: "Запрос", EXACT: '"Запрос"', FIXED: '"!Запрос"' } as Readonly<Record<string, string>>)[type] ?? type; }
function clusteringFrequencyTypeLabel(type: string): string { return ({ BASE: "базовая", QUOTED: "фразовая", OVERALL: "общая", EXACT: "точная" } as Readonly<Record<string, string>>)[type] ?? type; }
function frequencyDeviceLabel(device: string): string { return ({ ALL: "Все устройства", DESKTOP: "Десктоп", MOBILE: "Мобильные", PHONE_ONLY: "Телефоны", TABLET_ONLY: "Планшеты" } as Readonly<Record<string, string>>)[device] ?? device; }
function rankStageLabel(stage: string): string { return ({ PREPARING_SCOPE: "Подготовка ключей", WAITING_FOR_QUEUE: "Ожидает очереди", AUTHORIZING: "Проверка доступа", SUBMITTING: "Отправка провайдеру", POLLING: "Ожидание провайдера", FETCHING_RESULT: "Получение результата", STAGING_RESULT: "Обработка результата", PERSISTING_RESULT: "Сохранение позиций", SUBMIT_OUTCOME_UNKNOWN: "Требует проверки", FINISHED: "Завершено" } as Readonly<Record<string, string>>)[stage] ?? stage; }
function crawlStartLabel(urls: readonly string[]): string { const first = urls[0] ?? "—"; return urls.length > 1 ? `${first} · ещё ${urls.length - 1}` : first; }
function progressLabel(task: ProjectTask, uiLocale: string = "ru-RU"): string { return task.downloadUrl ? "Скачать файл" : task.progressTotal < 1 ? task.column === "COMPLETED" ? "Готово" : "Ожидает данных" : `${formatInteger(task.progressCurrent, uiLocale)} из ${formatInteger(task.progressTotal, uiLocale)}`; }
function taskPercent(task: ProjectTask): number { return task.progressTotal < 1 ? 0 : Math.min(100, Math.round(task.progressCurrent / task.progressTotal * 100)); }
function shortId(value: string): string { return value.slice(0, 8); }
function formatInteger(value: number, uiLocale: string = "ru-RU"): string { return new Intl.NumberFormat(uiLocale).format(value); }
function formatDateTime(value: string, uiLocale: string = "ru-RU"): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function formatRelativeDate(value: string, uiLocale: string = "ru-RU"): string { const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; const difference = Date.now() - date.getTime(); if (difference < 60_000) return "только что"; if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} мин назад`; if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} ч назад`; return new Intl.DateTimeFormat(uiLocale, { day: "2-digit", month: "short" }).format(date); }
function taskError(error: unknown): string { return error instanceof BrowserApiError ? error.message : "Не удалось обновить один из источников задач."; }
function exportFormatLabel(value: SemanticExportJobSummary["format"]): string { return value === "GOOGLE_CSV" ? "Google CSV" : value; }
function exportScopeLabel(value: SemanticExportJobSummary["scope"]): string { return ({ SELECTED: "Выбранные строки", CURRENT_PAGE: "Текущая страница", CURRENT_FILTER: "Текущий фильтр", GROUP_SUBTREE: "Дерево папки", FOLDER_MAP: "Карта сайта по папкам", FULL_CORE: "Весь проект" } as const)[value]; }
function formatByteString(value: string): string { const bytes = Number(value); if (!Number.isFinite(bytes) || bytes < 0) return value; if (bytes < 1024) return `${bytes} Б`; if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} КБ`; return `${(bytes / 1_048_576).toFixed(1)} МБ`; }
