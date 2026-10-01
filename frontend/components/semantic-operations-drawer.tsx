"use client";
import { prepareFrequencyRetry, type FrequencyRetryDraft } from "../lib/frequency-retry";
import { SemanticFrequencyDialog } from "./semantic-frequency-dialog";
import { SemanticPositionDialog } from "./semantic-position-dialog";
import { prepareRankRetry, type RankRetryDraft } from "../lib/rank-retry";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiAnswerCollectionSummary,
  ClusteringRunSummary,
  FrequencyCollectionSummary,
  KeywordResearchCollection,
  KeywordResearchRunSummary,
  RankJobSummary,
  SemanticExportCollection,
  SemanticExportJobSummary
} from "@seo-platform/contracts";
import Link from "next/link";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { semanticExportFileUrl } from "../lib/app-path";
import { Icon } from "./icon";
import {
  connectorRoutingScopeLabel,
  hasConnectorFallback
} from "../lib/connector-routing-presentation";
import { compactOperationStatusLabel } from "../lib/operation-status-presentation";
import { operationDurationLabel } from "../lib/operation-duration";
import {
  isDismissibleOperationStatus,
  operationDismissalPath
} from "../lib/operation-dismissal";
import {
  aiAnswerCollectionTitle,
  keywordResearchCollectionTitle,
  rankCollectionDepthLabel,
  rankCollectionTitle
} from "../lib/operation-collection-purpose";
import {
  searchRegionDisplayName,
  seoRegionDisplayName
} from "../lib/seo-regions";
import {
  isCancellableRankJob,
  rankSearchSystemLabel
} from "../lib/rank-jobs";
import {
  OperationResultModal,
  OperationStopIcon
} from "./operation-result-modal";
import { OperationStopConfirmation } from "./operation-stop-confirmation";
import { OperationDismissConfirmation } from "./operation-dismiss-confirmation";
import { ProviderLogo } from "./provider-logo";
import { SemanticRankContext } from "./semantic-rank-context";
import {
  frequencyCollectionCompactTitle,
  frequencyCollectionParameters,
  frequencyCollectionTitle
} from "../lib/frequency-operation-presentation";
import { useUiLocale, UiText } from "./ui-locale";
import { SemanticSideDrawer } from "./semantic-side-drawer";


type OperationTab = "ACTIVE" | "COMPLETED" | "ERROR";

export function SemanticOperationsDrawer({
  onClose,
  onClusteringApplied,
  onFrequencySettled,
  projectId,
  workspaceId,
  refreshToken = 0,
  watchedFrequencyId
}: Readonly<{
  onClose: () => void;
  onClusteringApplied?: () => void;
  onFrequencySettled?: () => void;
  projectId: string;
  workspaceId: string;
  refreshToken?: number;
  watchedFrequencyId?: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const [rankRetry, setRankRetry] = useState<RankRetryDraft>();
  const [frequencyRetry, setFrequencyRetry] = useState<FrequencyRetryDraft>();
  const frequencyRetryLoad = useRef<AbortController | undefined>(undefined);
  const { t: uiText } = useUiLocale();
  const [frequencies, setFrequencies] = useState<readonly FrequencyCollectionSummary[]>([]);
  const [ranks, setRanks] = useState<readonly RankJobSummary[]>([]);
  const [aiAnswers, setAiAnswers] = useState<readonly AiAnswerCollectionSummary[]>([]);
  const [clusteringRuns, setClusteringRuns] = useState<readonly ClusteringRunSummary[]>([]);
  const [researchRuns, setResearchRuns] = useState<readonly KeywordResearchRunSummary[]>([]);
  const [semanticExports, setSemanticExports] = useState<readonly SemanticExportJobSummary[]>([]);
  const [tab, setTab] = useState<OperationTab>("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [cancellingId, setCancellingId] = useState<string>();
  const [dismissingId, setDismissingId] = useState<string>();
  const [retryingId, setRetryingId] = useState<string>();
  const [selectedOperation, setSelectedOperation] = useState<Operation>();
  const [stopConfirmation, setStopConfirmation] = useState<Operation>();
  const [dismissConfirmation, setDismissConfirmation] = useState<Operation>();
  const settledFrequencyNotifications = useRef(new Set<string>());
  const onFrequencySettledRef = useRef(onFrequencySettled);
  const requestInFlight = useRef(false);

  useEffect(() => {
    setDismissConfirmation(undefined);
    setFrequencyRetry(undefined);
    setRankRetry(undefined);
    setSelectedOperation(undefined);
    setStopConfirmation(undefined);
    return () => frequencyRetryLoad.current?.abort();
  }, [projectId]);

  useEffect(() => {
    onFrequencySettledRef.current = onFrequencySettled;
  }, [onFrequencySettled]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const [frequencyResult, rankResult, aiAnswerResult, clusteringResult, researchResult, exportResult] = await Promise.allSettled([
        browserApiRequest<{ readonly collections: readonly FrequencyCollectionSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections`,
          signal ? { signal } : {}
        ),
        browserApiRequest<{ readonly jobs: readonly RankJobSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/rank-runs`,
          signal ? { signal } : {}
        ),
        browserApiRequest<{ readonly collections: readonly AiAnswerCollectionSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/ai-answer-collections`,
          signal ? { signal } : {}
        ),
        browserApiRequest<{ readonly runs: readonly ClusteringRunSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/clustering-runs`,
          signal ? { signal } : {}
        ),
        browserApiRequest<KeywordResearchCollection>(
          `/app/api/projects/${encodeURIComponent(projectId)}/keyword-research-runs`,
          signal ? { signal } : {}
        ),
        browserApiRequest<SemanticExportCollection>(
          `/app/api/projects/${encodeURIComponent(projectId)}/exports`,
          signal ? { signal } : {}
        )
      ]);
      if (signal?.aborted) return;
      if (frequencyResult.status === "fulfilled") {
        setFrequencies(frequencyResult.value.collections);
        const watched = frequencyResult.value.collections.find(
          ({ id }) => id === watchedFrequencyId
        );
        if (
          watched &&
          isTerminalFrequency(watched.status) &&
          !settledFrequencyNotifications.current.has(watched.id)
        ) {
          settledFrequencyNotifications.current.add(watched.id);
          onFrequencySettledRef.current?.();
        }
      }
      if (rankResult.status === "fulfilled") {
        setRanks(rankResult.value.jobs);
      }
      if (aiAnswerResult.status === "fulfilled") {
        setAiAnswers(aiAnswerResult.value.collections);
      }
      if (clusteringResult.status === "fulfilled") {
        setClusteringRuns(clusteringResult.value.runs);
      }
      if (researchResult.status === "fulfilled") {
        setResearchRuns(researchResult.value.runs);
      }
      if (exportResult.status === "fulfilled") {
        setSemanticExports(exportResult.value.exports);
      }
      const failures = [frequencyResult, rankResult, aiAnswerResult, clusteringResult, researchResult, exportResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => operationError(result.reason));
      setError(failures.length > 0 ? [...new Set(failures)].join(" · ") : undefined);
    } catch (requestError) {
      if (!signal?.aborted) setError(operationError(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
      requestInFlight.current = false;
    }
  }, [projectId, watchedFrequencyId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void load(controller.signal), 2_000);
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
  }, [load, refreshToken]);

  const allOperations = useMemo(() => {
    const values: Operation[] = [
      ...frequencies.map(frequencyOperation),
      ...ranks.map(value => rankOperation(value, uiLocale)),
      ...aiAnswers.map(aiAnswerOperation),
      ...clusteringRuns.map(clusteringOperation),
      ...researchRuns.map(value => researchOperation(value, uiLocale)),
      ...semanticExports.map(exportOperation)
    ];
    return values.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  }, [aiAnswers, clusteringRuns, frequencies, ranks, researchRuns, semanticExports, uiLocale]);

  const operations = useMemo(
    () => allOperations.filter((operation) => operation.tab === tab),
    [allOperations, tab]
  );

  const recentlyCompleted = useMemo(
    () => allOperations
      .filter(({ tab: operationTab }) => operationTab === "COMPLETED")
      .slice(0, 5),
    [allOperations]
  );

  const counts = useMemo(() => ({
    ACTIVE: allOperations.filter(({ tab }) => tab === "ACTIVE").length,
    COMPLETED: allOperations.filter(({ tab }) => tab === "COMPLETED").length,
    ERROR: allOperations.filter(({ tab }) => tab === "ERROR").length
  }), [allOperations]);
  const openedOperation = selectedOperation
    ? allOperations.find((operation) =>
        operation.id === selectedOperation.id &&
        operation.kind === selectedOperation.kind
      ) ?? selectedOperation
    : undefined;

  async function cancel(operation: Operation): Promise<void> {
    const current = allOperations.find(({ id, kind }) =>
      id === operation.id && kind === operation.kind
    ) ?? operation;
    if (!current.cancellable) {
      await load();
      return;
    }
    setCancellingId(current.id);
    setError(undefined);
    try {
      if (current.kind === "FREQUENCY") {
        await browserApiRequest(
          `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {} }
        );
      } else if (current.kind === "RANK") {
        await browserApiRequest(
          `/app/api/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {} }
        );
      } else if (current.kind === "AI_ANSWER") {
        await browserApiRequest(
          `/app/api/projects/${encodeURIComponent(projectId)}/ai-answer-collections/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {} }
        );
      } else if (current.kind === "CLUSTERING") {
        await browserApiRequest(
          `/app/api/projects/${encodeURIComponent(projectId)}/clustering-runs/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {} }
        );
      } else if (current.kind === "RESEARCH") {
        await browserApiRequest(
          `/app/api/projects/${encodeURIComponent(projectId)}/keyword-research-runs/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {}, ifMatch: current.version }
        );
      } else {
        await browserApiRequest(
          `/app/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(current.id)}/cancel`,
          { method: "POST", body: {}, ifMatch: current.version }
        );
      }
      await load();
    } catch (requestError) {
      setError(operationError(requestError));
    } finally {
      setCancellingId(undefined);
    }
  }

  async function retry(operation: Operation): Promise<void> {
    if (operation.kind === "EXPORT" || operation.kind === "AI_ANSWER" || operation.kind === "CLUSTERING" || operation.kind === "RESEARCH") return;
    setRetryingId(operation.id);
    setError(undefined);
    try {
      if (operation.kind === "FREQUENCY") {
        if (operation.errorCode === "CONNECTOR_NOT_READY") {
          await browserApiRequest(
            `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections/${encodeURIComponent(operation.id)}/retry-failed`,
            { method: "POST", body: { version: operation.version } }
          );
        } else {
          frequencyRetryLoad.current?.abort();
          const controller = new AbortController(); frequencyRetryLoad.current = controller;
          const draft = await prepareFrequencyRetry(projectId, operation.id, controller.signal);
          if (!controller.signal.aborted) setFrequencyRetry(draft);
        }
      } else {
        frequencyRetryLoad.current?.abort();
        const controller = new AbortController(); frequencyRetryLoad.current = controller;
        const draft = await prepareRankRetry(projectId, operation.id, controller.signal);
        if (!controller.signal.aborted) setRankRetry(draft);
      }
      setTab("ACTIVE");
      await load();
    } catch (requestError) {
      setError(operationError(requestError));
    } finally {
      setRetryingId(undefined);
    }
  }

  async function dismiss(operation: Operation): Promise<void> {
    const current = allOperations.find(({ id, kind }) =>
      id === operation.id && kind === operation.kind
    ) ?? operation;
    if (!current.dismissible) {
      setDismissConfirmation(undefined);
      await load();
      return;
    }
    setDismissingId(current.id);
    setError(undefined);
    try {
      await browserApiRequest(operationDismissalPath(projectId, current.id), {
        method: "DELETE"
      });
      setFrequencies((items) => items.filter(({ id }) => id !== current.id));
      setRanks((items) => items.filter(({ id }) => id !== current.id));
      setAiAnswers((items) => items.filter(({ id }) => id !== current.id));
      setClusteringRuns((items) => items.filter(({ id }) => id !== current.id));
      setResearchRuns((items) => items.filter(({ id }) => id !== current.id));
      setSemanticExports((items) => items.filter(({ id }) => id !== current.id));
      setSelectedOperation(undefined);
      setDismissConfirmation(undefined);
      await load();
    } catch (requestError) {
      setError(operationError(requestError));
    } finally {
      setDismissingId(undefined);
    }
  }

  return (
    <>
    {rankRetry && <SemanticPositionDialog projectId={projectId} workspaceId={rankRetry.result.job.workspaceId} groups={rankRetry.groups} initialSelections={rankRetry.selections} initialRun={rankRetry.result} mode={rankRetry.result.execution.purpose === "COMPETITOR_SERP" ? "competitors" : "positions"} onClose={() => setRankRetry(undefined)} onStarted={() => { setRankRetry(undefined); void load(); }} />}
      {frequencyRetry && <SemanticFrequencyDialog projectId={projectId} workspaceId={workspaceId} groups={frequencyRetry.groups} initialSelections={frequencyRetry.selections} initialConfiguration={frequencyRetry.collection} onClose={() => setFrequencyRetry(undefined)} onStarted={() => { setFrequencyRetry(undefined); void load(); }} />}
    <SemanticSideDrawer
      ariaLabel="Задачи и операции"
      className="semantic-operations-drawer"
      closeLabel="Закрыть операции"
      eyebrow="Прогресс обновляется автоматически"
      onClose={onClose}
      presenceKey="semantic-operations-drawer"
      title="Задачи и операции"
    >
      <div className="semantic-operation-tabs" role="tablist">
        {(["ACTIVE", "COMPLETED", "ERROR"] as const).map((value) => (
          <button aria-selected={tab === value} key={value} onClick={() => setTab(value)} role="tab" type="button">
            {<UiText text={tabLabel(value) ?? ""} />} <span>{counts[value]}</span>
          </button>
        ))}
      </div>
      <div className="semantic-operation-list">
        {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
        {loading ? (
          <div className="semantic-dialog-loading" role="status"><UiText text="Загружаем журнал операций…" /></div>
        ) : operations.length > 0 ? operations.map((operation) => (
          <article className={`semantic-operation-card state-${operation.tab.toLocaleLowerCase()}`} key={`${operation.kind}:${operation.id}`}>
            <header>
              <strong className="provider-inline">
                {operation.provider ? (
                  <ProviderLogo provider={operation.provider} size="compact" />
                ) : (
                  <span aria-hidden="true" className="semantic-operation-export-mark"><Icon name="export" /></span>
                )}
                <span>{operation.title}</span>
              </strong>
              <span className="semantic-operation-status">{operation.statusLabel}</span>
            </header>
            {operation.rankContext && (
              <div className="semantic-operation-rank-context">
                <SemanticRankContext {...operation.rankContext} />
              </div>
            )}
            <div className="semantic-operation-progress-head">
              <strong>{operation.percent}%</strong>
              <span>{operation.progressLabel}</span>
            </div>
            <div className="semantic-operation-progress"><i style={{ width: `${operation.percent}%` }} /></div>
            <div className="semantic-operation-meta"><span>{operation.routeLabel ?? <UiText text="Фоновая операция" />}</span><time>{formatDateTime(operation.createdAt, uiLocale)}</time></div>
            {(operation.durationLabel || operation.resultLabel) && (
              <div className="semantic-operation-card-facts">
                {operation.resultLabel && <span>{operation.resultLabel}</span>}
                {operation.durationLabel && <span><UiText text="Выполнено за" after=" " /><strong>{operation.durationLabel}</strong></span>}
              </div>
            )}
            {operation.errorCode && <small><UiText text="Код:" after=" " />{operation.errorCode}</small>}
            <footer>
              {operation.retryable && (
                <button className="semantic-operation-retry" disabled={retryingId === operation.id} onClick={() => void retry(operation)} type="button">
                  {retryingId === operation.id
                    ? <UiText text="Запускаем…" />
                    : operation.retryLabel}
                </button>
              )}
              {operation.downloadable && (
                <a
                  className="semantic-operation-download"
                  href={semanticExportFileUrl(projectId, operation.id)}
                >
                  <UiText text="Скачать файл" /></a>
              )}
              {operation.cancellable && (
                <button disabled={cancellingId === operation.id} onClick={() => setStopConfirmation(operation)} type="button">
                  {cancellingId === operation.id ? <UiText text="Останавливаем…" /> : <UiText text="Остановить" />}
                </button>
              )}
              {operation.dismissible && (
                <button
                  disabled={dismissingId === operation.id}
                  onClick={() => setDismissConfirmation(operation)}
                  type="button"
                >
                  {dismissingId === operation.id ? <UiText text="Удаляем…" /> : <UiText text="Удалить" />}
                </button>
              )}
              {(operation.kind === "FREQUENCY" || operation.kind === "RANK" || operation.kind === "AI_ANSWER" || operation.kind === "CLUSTERING" || operation.kind === "RESEARCH") && (
                <button
                  className="semantic-operation-open"
                  onClick={() => setSelectedOperation(operation)}
                  type="button"
                >
                  <UiText text="Открыть лог" /></button>
              )}
            </footer>
          </article>
        )) : (
          <div className="semantic-inspector-empty semantic-operation-empty">
            <strong>{tab === "ACTIVE" ? <UiText text="Активных задач нет" /> : <UiText text="В этом разделе задач нет" />}</strong>
            <span><UiText text="История хранится на сервере и обновляется без перезагрузки страницы." /></span>
          </div>
        )}
        {tab === "ACTIVE" && !loading && recentlyCompleted.length > 0 && (
          <section className="semantic-recent-operations">
            <h3><UiText text="Недавно завершённые" /></h3>
            {recentlyCompleted.map((operation) => operation.kind === "EXPORT" ? (
              <a
                href={semanticExportFileUrl(projectId, operation.id)}
                key={`recent:${operation.kind}:${operation.id}`}
              >
                <span aria-hidden="true">↓</span>
                <strong>{operation.title}</strong>
                <time>{formatShortTime(operation.createdAt, uiLocale)}</time>
              </a>
            ) : (
              <button
                key={`recent:${operation.kind}:${operation.id}`}
                onClick={() => setSelectedOperation(operation)}
                type="button"
              >
                <span aria-hidden="true">✓</span>
                <strong>{operation.title}</strong>
                <time>{formatShortTime(operation.createdAt, uiLocale)}</time>
              </button>
            ))}
          </section>
        )}
        {!loading && (
          <Link className="semantic-operation-journal-link" href="/app/tasks">
            <UiText text="Открыть журнал операций" /></Link>
        )}
      </div>
    </SemanticSideDrawer>
    {openedOperation && (
      openedOperation.kind === "FREQUENCY" ||
      openedOperation.kind === "RANK" ||
      openedOperation.kind === "AI_ANSWER" ||
      openedOperation.kind === "CLUSTERING" ||
      openedOperation.kind === "RESEARCH"
    ) && (
      <OperationResultModal
        actions={(
          <>
          {openedOperation.cancellable && <button
            aria-label={cancellingId === openedOperation.id ? uiText("Операция останавливается") : uiText("Остановить операцию")}
            className="operation-result-header-action is-danger"
            disabled={cancellingId === openedOperation.id}
            onClick={() => setStopConfirmation(openedOperation)}
            title={cancellingId === openedOperation.id ? uiText("Останавливаем…") : uiText("Остановить операцию")}
            type="button"
          >
            <OperationStopIcon />
          </button>}
          {openedOperation.dismissible && <button
            aria-label={uiText("Удалить операцию?")}
            className="operation-result-header-action is-danger"
            disabled={dismissingId === openedOperation.id}
            onClick={() => setDismissConfirmation(openedOperation)}
            title={uiText("Удалить операцию?")}
            type="button"
          >
            <Icon name="trash" />
          </button>}
          </>
        )}
        description={`${openedOperation.description} · ${formatDateTime(openedOperation.createdAt, uiLocale)}`}
        kind={openedOperation.kind === "FREQUENCY"
          ? "frequency"
          : openedOperation.kind === "AI_ANSWER"
            ? "ai-answer"
            : openedOperation.kind === "CLUSTERING"
              ? "clustering"
              : openedOperation.kind === "RESEARCH"
                ? "research"
            : "rank"}
        {...(onClusteringApplied ? { onClusteringApplied } : {})}
        onClose={() => setSelectedOperation(undefined)}
        operationId={openedOperation.id}
        projectId={projectId}
        title={openedOperation.resultTitle}
      />
    )}
    {stopConfirmation && (
      <OperationStopConfirmation
        busy={cancellingId === stopConfirmation.id}
        description={stopConfirmation.description}
        onCancel={() => setStopConfirmation(undefined)}
        onConfirm={() => {
          void cancel(stopConfirmation).then(() => setStopConfirmation(undefined));
        }}
        title={stopConfirmation.title}
      />
    )}
    {dismissConfirmation && (
      <OperationDismissConfirmation
        busy={dismissingId === dismissConfirmation.id}
        description={dismissConfirmation.description}
        onCancel={() => setDismissConfirmation(undefined)}
        onConfirm={() => void dismiss(dismissConfirmation)}
        title={dismissConfirmation.title}
      />
    )}
    </>
  );
}

interface Operation {
  readonly id: string;
  readonly kind: "FREQUENCY" | "RANK" | "AI_ANSWER" | "CLUSTERING" | "RESEARCH" | "EXPORT";
  readonly provider?: "XMLSTOCK" | "ARSENKIN" | "KEYS_SO";
  readonly title: string;
  readonly resultTitle: string;
  readonly description: string;
  readonly statusLabel: string;
  readonly progressLabel: string;
  readonly percent: number;
  readonly tab: OperationTab;
  readonly cancellable: boolean;
  readonly retryable: boolean;
  readonly retryLabel: string;
  readonly downloadable: boolean;
  readonly dismissible: boolean;
  readonly version: number;
  readonly errorCode?: string;
  readonly routeLabel?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationLabel?: string;
  readonly resultLabel?: string;
  readonly competitorCollection?: boolean;
  readonly rankContext?: Readonly<{
    searchEngine: "GOOGLE" | "YANDEX";
    regionCode: string;
    device: "DESKTOP" | "MOBILE";
  }>;
}

function frequencyOperation(value: FrequencyCollectionSummary): Operation {
  const done = value.completedKeywords + value.failedKeywords;
  const durationLabel = operationDurationLabel(value);
  const seasonality = value.mode === "SEASONALITY";
  const providerRequestCount = value.provider === "XMLSTOCK" && !seasonality
    ? value.selectedKeywords * value.types.length
    : undefined;
  const completedProviderRequests = providerRequestCount === undefined
    ? undefined
    : Math.min(providerRequestCount, done * value.types.length);
  return {
    id: value.id,
    kind: "FREQUENCY",
    provider: value.provider,
    title: frequencyCollectionCompactTitle(value),
    resultTitle: frequencyCollectionTitle(value),
    description: seasonality
      ? `${value.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools"} · ${frequencyCollectionParameters(value)}`
      : `${value.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools"} · ${value.types.map(frequencyTypeLabel).join(" + ")}`,
    statusLabel: compactOperationStatusLabel(value.status),
    progressLabel: `${done} из ${value.selectedKeywords}`,
    percent: value.selectedKeywords > 0 ? Math.round(done / value.selectedKeywords * 100) : 0,
    tab: operationTab(value.status),
    cancellable: ["QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRY_SCHEDULED", "FAILED_RETRYABLE"].includes(value.status),
    retryable: !value.requiresUsageReview && ["FAILED_FINAL", "PARTIALLY_COMPLETED", "ACTION_REQUIRED", "CANCELLED"].includes(value.status),
    retryLabel: value.status === "CANCELLED" ||
      value.failureCode === "CONNECTOR_NOT_READY"
      ? "Продолжить"
      : "Повторить ошибки",
    downloadable: false,
    dismissible: isDismissibleOperationStatus(value.status),
    version: value.version,
    ...(value.routingScope
      ? {
          routeLabel: `${connectorRoutingScopeLabel(value.routingScope)}${hasConnectorFallback(value.connectorAttempts) ? " · fallback выполнен" : ""}`
        }
      : {}),
    ...(value.failureCode && value.failureCode !== "PROVIDER_CONCURRENCY_LIMITED"
      ? { errorCode: value.failureCode }
      : {}),
    createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(durationLabel
      ? { durationLabel }
      : {}),
    ...(providerRequestCount !== undefined && completedProviderRequests !== undefined
      ? {
          resultLabel: `API-запросов: ${completedProviderRequests} из ${providerRequestCount}`
        }
      : {})
  };
}

function rankOperation(value: RankJobSummary, uiLocale: string = "ru-RU"): Operation {
  const competitorCollection = value.purpose === "COMPETITOR_SERP";
  const current = Number(value.progress.current);
  const total = Number(value.progress.total);
  const providerName = value.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin";
  const searchSystem = value.searchEngine
    ? rankSearchSystemLabel(
        value.searchEngine,
        value.searchSource,
        value.yandexLiveMode,
        value.provider
      )
    : undefined;
  const description = [
    providerName,
    searchSystem,
    rankCollectionDepthLabel(value, value.depth)
  ].filter((part): part is string => Boolean(part)).join(" · ");
  const durationLabel = operationDurationLabel(value);
  return {
    id: value.id,
    kind: "RANK",
    provider: value.provider,
    title: `${competitorCollection ? "Выдача конкурентов" : "Проверка позиций"} · ${description}`,
    resultTitle: rankCollectionTitle(value),
    description,
    statusLabel: compactOperationStatusLabel(value.status),
    progressLabel: `${current} из ${total}`,
    percent: total > 0 ? Math.round(current / total * 100) : 0,
    tab: operationTab(value.status),
    cancellable: isCancellableRankJob(value),
    retryable:
      (value.status === "PARTIALLY_COMPLETED" || value.status === "CANCELLED") &&
      (value.status === "CANCELLED" || Number(value.result.failedCount) > 0) &&
      Number(value.result?.submitOutcomeUnknownCount ?? "0") === 0,
    retryLabel: value.status === "CANCELLED"
      ? "Продолжить"
      : competitorCollection ? "Дособрать конкурентов" : "Дособрать позиции",
    downloadable: false,
    dismissible: isDismissibleOperationStatus(value.status),
    version: 1,
    ...(competitorCollection ? { competitorCollection: true } : {}),
    ...(value.searchEngine && value.regionCode && value.device
      ? {
          rankContext: {
            searchEngine: value.searchEngine,
            regionCode: value.regionCode,
            device: value.device
          }
        }
      : {}),
    ...(value.routingScope
      ? {
          routeLabel: `${connectorRoutingScopeLabel(value.routingScope)}${hasConnectorFallback(value.connectorAttempts) ? " · fallback выполнен" : ""}`
        }
      : {}),
    ...(value.status === "FAILED" || value.status === "ACTION_REQUIRED"
      ? { errorCode: value.failure.code }
      : {}),
    createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(durationLabel
      ? { durationLabel }
      : {}),
    ...(value.result
      ? {
          resultLabel: competitorCollection
            ? `Сохранено срезов: ${formatInteger(Number(value.result.persistedCount), uiLocale)}`
            : `Найдено позиций: ${formatInteger(Number(value.result.foundCount), uiLocale)}`
        }
      : {})
  };
}

function aiAnswerOperation(value: AiAnswerCollectionSummary): Operation {
  const competitorCollection = value.purpose === "COMPETITOR_SERP";
  const done = value.completedKeywords + value.failedKeywords;
  const engine = value.searchEngine === "YANDEX" ? "Яндекс" : "Google";
  const device = value.device === "DESKTOP" ? "десктоп" : "мобильное";
  const durationLabel = operationDurationLabel(value);
  return {
    id: value.id,
    kind: "AI_ANSWER",
    provider: "ARSENKIN",
    title: `${aiAnswerCollectionTitle(value)} · ${engine}`,
    resultTitle: aiAnswerCollectionTitle(value),
    description: `Arsenkin · ${engine} · ${searchRegionDisplayName(value.searchEngine, value.regionCode)} · ${device}`,
    statusLabel: compactOperationStatusLabel(value.status),
    progressLabel: `${done} из ${value.selectedKeywords}`,
    percent: value.selectedKeywords > 0
      ? Math.round(done / value.selectedKeywords * 100)
      : 0,
    tab: operationTab(value.status),
    cancellable: [
      "QUEUED",
      "RUNNING",
      "WAITING_RATE_LIMIT",
      "RETRY_SCHEDULED",
      "FAILED_RETRYABLE"
    ].includes(value.status),
    retryable: false,
    retryLabel: "",
    downloadable: false,
    dismissible: isDismissibleOperationStatus(value.status),
    version: value.version,
    ...(competitorCollection ? { competitorCollection: true } : {}),
    rankContext: {
      searchEngine: value.searchEngine,
      regionCode: value.regionCode,
      device: value.device
    },
    ...(value.routingScope
      ? {
          routeLabel: `${connectorRoutingScopeLabel(value.routingScope)}${hasConnectorFallback(value.connectorAttempts) ? " · fallback выполнен" : ""}`
        }
      : {}),
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(durationLabel
      ? { durationLabel }
      : {})
  };
}

function clusteringOperation(value: ClusteringRunSummary): Operation {
  const done = value.completedKeywords + value.failedKeywords;
  const engine = value.searchEngine === "YANDEX" ? "Яндекс" : "Google";
  const durationLabel = operationDurationLabel(value);
  return {
    id: value.id,
    kind: "CLUSTERING",
    provider: "ARSENKIN",
    title: `Кластеризация запросов · ${engine}`,
    resultTitle: "Кластеризация запросов",
    description: `Arsenkin · ${engine} · ТОП-${value.depth} · ${value.method === "SOFT" ? "мягкая" : "жёсткая"}`,
    statusLabel: compactOperationStatusLabel(value.status),
    progressLabel: value.status === "COMPLETED" && value.clusterCount !== undefined
      ? `${value.clusterCount} кластеров`
      : `${done} из ${value.selectedKeywords}`,
    percent: value.status === "COMPLETED"
      ? 100
      : value.selectedKeywords > 0
        ? Math.round(done / value.selectedKeywords * 100)
        : 0,
    tab: operationTab(value.status),
    cancellable: [
      "QUEUED",
      "RUNNING",
      "WAITING_RATE_LIMIT",
      "RETRY_SCHEDULED",
      "FAILED_RETRYABLE"
    ].includes(value.status),
    retryable: false,
    retryLabel: "",
    downloadable: false,
    dismissible: isDismissibleOperationStatus(value.status),
    version: value.version,
    ...(value.routingScope
      ? {
          routeLabel: `${connectorRoutingScopeLabel(value.routingScope)}${hasConnectorFallback(value.connectorAttempts) ? " · fallback выполнен" : ""}`
        }
      : {}),
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(durationLabel
      ? { durationLabel }
      : {})
  };
}

function researchOperation(value: KeywordResearchRunSummary, uiLocale: string = "ru-RU"): Operation {
  const keysSo = value.source === "KEYS_SO";
  const current = value.importedKeywords > 0
    ? value.importedKeywords
    : value.collectedKeywords;
  const total = value.totalAvailable ?? value.maxKeywords;
  const durationLabel = operationDurationLabel(value);
  const providerLabel = value.provider === "XMLSTOCK"
    ? "XMLStock"
    : value.provider === "ARSENKIN"
      ? "Arsenkin Tools"
      : "Keys.so";
  return {
    id: value.id,
    kind: "RESEARCH",
    provider: value.provider,
    title: keywordResearchCollectionTitle(value),
    resultTitle: keywordResearchCollectionTitle(value),
    description: keysSo
      ? `${providerLabel} · ${value.domain ?? "—"}`
      : `${providerLabel} · ${value.seedCount ?? 0} исходных фраз · ${seoRegionDisplayName("WORDSTAT", value.regionCode ?? "225")}`,
    statusLabel: compactOperationStatusLabel(value.status),
    progressLabel: value.status === "READY_TO_IMPORT"
      ? `Найдено ${formatInteger(value.collectedKeywords, uiLocale)}`
      : total > 0
        ? `${formatInteger(current, uiLocale)} из ${formatInteger(total, uiLocale)}`
        : "Ожидает данных",
    percent: value.status === "READY_TO_IMPORT" || value.status === "COMPLETED"
      ? 100
      : total > 0
        ? Math.min(100, Math.round(current / total * 100))
        : 0,
    tab: operationTab(value.status),
    cancellable: [
      "QUEUED",
      "RUNNING",
      "RETRY_SCHEDULED",
      "READY_TO_IMPORT"
    ].includes(value.status),
    retryable: false,
    retryLabel: "",
    downloadable: false,
    dismissible: isDismissibleOperationStatus(value.status),
    version: value.version,
    routeLabel: keysSo ? "Данные домена" : "Расширение семантики",
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    createdAt: value.createdAt,
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(durationLabel ? { durationLabel } : {}),
    ...(value.collectedKeywords > 0
      ? { resultLabel: `Найдено запросов: ${formatInteger(value.collectedKeywords, uiLocale)}` }
      : {})
  };
}

function exportOperation(value: SemanticExportJobSummary): Operation {
  const total = value.totalRows ?? value.rowCount ?? value.processedRows;
  const complete = value.status === "COMPLETED";
  const durationLabel = operationDurationLabel(value);
  return {
    id: value.id,
    kind: "EXPORT",
    title: `Экспорт семантики · ${exportFormatLabel(value.format)}`,
    resultTitle: "Экспорт семантики",
    description: `${exportFormatLabel(value.format)} · ${exportScopeLabel(value.scope)}`,
    statusLabel: compactOperationStatusLabel(value.status),
    progressLabel: complete
      ? `${value.rowCount ?? value.processedRows} строк`
      : total > 0
        ? `${value.processedRows} из ${total}`
        : `${value.processedRows} строк`,
    percent: complete
      ? 100
      : total > 0
        ? Math.min(100, Math.round(value.processedRows / total * 100))
        : 0,
    tab: operationTab(value.status),
    cancellable: [
      "QUEUED",
      "RUNNING",
      "RETRY_SCHEDULED",
      "FAILED_RETRYABLE"
    ].includes(value.status),
    retryable: false,
    retryLabel: "",
    downloadable: complete,
    dismissible: isDismissibleOperationStatus(value.status),
    version: value.version,
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    routeLabel: exportScopeLabel(value.scope),
    createdAt: value.createdAt,
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(durationLabel
      ? { durationLabel }
      : {})
  };
}

function exportFormatLabel(format: SemanticExportJobSummary["format"]): string {
  return format === "GOOGLE_CSV" ? "Google CSV" : format;
}

function exportScopeLabel(scope: SemanticExportJobSummary["scope"]): string {
  return {
    SELECTED: "выбранные строки",
    CURRENT_PAGE: "текущая страница",
    CURRENT_FILTER: "текущий фильтр",
    GROUP_SUBTREE: "группа и подгруппы",
    FOLDER_MAP: "карта сайта по папкам",
    FULL_CORE: "весь проект"
  }[scope];
}

function operationTab(status: string): OperationTab {
  if (["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED"].includes(status)) return "COMPLETED";
  if (["FAILED", "FAILED_FINAL", "ACTION_REQUIRED", "EXPIRED"].includes(status)) return "ERROR";
  return "ACTIVE";
}

function isTerminalFrequency(status: string): boolean {
  return [
    "ACTION_REQUIRED",
    "CANCELLED",
    "PARTIALLY_COMPLETED",
    "COMPLETED",
    "FAILED_FINAL"
  ].includes(status);
}

function frequencyTypeLabel(type: string): string {
  return { BASE: "без операторов", EXACT: '""', FIXED: '"!"' }[type] ?? type;
}

function tabLabel(value: OperationTab): string {
  return { ACTIVE: "Активные", COMPLETED: "Завершённые", ERROR: "Ошибки" }[value];
}

function formatDateTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(uiLocale, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatShortTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, {
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
}

function formatInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}

function operationError(error: unknown): string {
  return error instanceof BrowserApiError ? error.message : "Не удалось обновить журнал операций.";
}
