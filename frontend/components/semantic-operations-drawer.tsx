"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FrequencyCollectionSummary,
  RankJobSummary
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  connectorRoutingScopeLabel,
  hasConnectorFallback
} from "../lib/connector-routing-presentation";
import { operationStatusLabel } from "../lib/operation-status-presentation";
import { rankSearchSystemLabel } from "../lib/rank-jobs";
import { OperationResultModal } from "./operation-result-modal";
import { ProviderLogo } from "./provider-logo";

type OperationTab = "ACTIVE" | "COMPLETED" | "ERROR";

export function SemanticOperationsDrawer({
  onClose,
  onFrequencySettled,
  projectId,
  refreshToken = 0,
  watchedFrequencyId
}: Readonly<{
  onClose: () => void;
  onFrequencySettled?: () => void;
  projectId: string;
  refreshToken?: number;
  watchedFrequencyId?: string;
}>) {
  const [frequencies, setFrequencies] = useState<readonly FrequencyCollectionSummary[]>([]);
  const [ranks, setRanks] = useState<readonly RankJobSummary[]>([]);
  const [tab, setTab] = useState<OperationTab>("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [cancellingId, setCancellingId] = useState<string>();
  const [retryingId, setRetryingId] = useState<string>();
  const [selectedOperation, setSelectedOperation] = useState<Operation>();
  const settledFrequencyNotifications = useRef(new Set<string>());
  const onFrequencySettledRef = useRef(onFrequencySettled);
  const requestInFlight = useRef(false);

  useEffect(() => {
    onFrequencySettledRef.current = onFrequencySettled;
  }, [onFrequencySettled]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const [frequencyResult, rankResult] = await Promise.allSettled([
        browserApiRequest<{ readonly collections: readonly FrequencyCollectionSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections`,
          signal ? { signal } : {}
        ),
        browserApiRequest<{ readonly jobs: readonly RankJobSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/rank-runs`,
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
      const failures = [frequencyResult, rankResult]
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

  const operations = useMemo(() => {
    const values: Operation[] = [
      ...frequencies.map(frequencyOperation),
      ...ranks.map(rankOperation)
    ];
    return values
      .filter((operation) => operation.tab === tab)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [frequencies, ranks, tab]);

  const counts = useMemo(() => ({
    ACTIVE: [...frequencies.map(frequencyOperation), ...ranks.map(rankOperation)].filter(({ tab }) => tab === "ACTIVE").length,
    COMPLETED: [...frequencies.map(frequencyOperation), ...ranks.map(rankOperation)].filter(({ tab }) => tab === "COMPLETED").length,
    ERROR: [...frequencies.map(frequencyOperation), ...ranks.map(rankOperation)].filter(({ tab }) => tab === "ERROR").length
  }), [frequencies, ranks]);

  async function cancel(operation: Operation): Promise<void> {
    setCancellingId(operation.id);
    setError(undefined);
    try {
      if (operation.kind === "FREQUENCY") {
        await browserApiRequest(
          `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections/${encodeURIComponent(operation.id)}/cancel`,
          { method: "POST", body: { version: operation.version } }
        );
      } else {
        await browserApiRequest(
          `/app/api/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(operation.id)}/cancel`,
          { method: "POST", body: {} }
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
    if (operation.kind !== "FREQUENCY") return;
    setRetryingId(operation.id);
    setError(undefined);
    try {
      await browserApiRequest(
        `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections/${encodeURIComponent(operation.id)}/retry-failed`,
        { method: "POST", body: { version: operation.version } }
      );
      setTab("ACTIVE");
      await load();
    } catch (requestError) {
      setError(operationError(requestError));
    } finally {
      setRetryingId(undefined);
    }
  }

  return (
    <>
    <aside aria-label="Задачи и операции" className="semantic-operations-drawer">
      <header>
        <div><span>Фоновые процессы</span><h2>Задачи и операции</h2></div>
        <button aria-label="Закрыть операции" onClick={onClose} type="button">×</button>
      </header>
      <div className="semantic-operation-tabs" role="tablist">
        {(["ACTIVE", "COMPLETED", "ERROR"] as const).map((value) => (
          <button aria-selected={tab === value} key={value} onClick={() => setTab(value)} role="tab" type="button">
            {tabLabel(value)} <span>{counts[value]}</span>
          </button>
        ))}
      </div>
      <div className="semantic-operation-list">
        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        {loading ? (
          <div className="semantic-dialog-loading" role="status">Загружаем журнал операций…</div>
        ) : operations.length > 0 ? operations.map((operation) => (
          <article key={`${operation.kind}:${operation.id}`}>
            <header>
              <strong className="provider-inline">
                <ProviderLogo provider={operation.provider} size="compact" />
                <span>{operation.title}</span>
              </strong>
              <span className="semantic-operation-status">{operation.statusLabel}</span>
            </header>
            <div className="semantic-operation-progress"><i style={{ width: `${operation.percent}%` }} /></div>
            <div className="semantic-operation-meta"><span>{operation.progressLabel}</span><time>{formatDateTime(operation.createdAt)}</time></div>
            {operation.routeLabel && <small>{operation.routeLabel}</small>}
            {operation.errorCode && <small>Код: {operation.errorCode}</small>}
            <footer>
              <div>
                {operation.retryable && (
                  <button className="semantic-operation-retry" disabled={retryingId === operation.id} onClick={() => void retry(operation)} type="button">
                    {retryingId === operation.id ? "Перезапускаем…" : "Повторить ошибки"}
                  </button>
                )}
                {operation.cancellable && (
                  <button disabled={cancellingId === operation.id} onClick={() => void cancel(operation)} type="button">
                    {cancellingId === operation.id ? "Останавливаем…" : "Остановить"}
                  </button>
                )}
              </div>
              <button
                className="semantic-operation-open"
                onClick={() => setSelectedOperation(operation)}
                type="button"
              >
                Открыть результат
              </button>
            </footer>
          </article>
        )) : (
          <div className="semantic-inspector-empty semantic-operation-empty"><strong>В этом разделе задач нет</strong><span>История хранится на сервере и появится после первого запуска.</span></div>
        )}
      </div>
    </aside>
    {selectedOperation && (
      <OperationResultModal
        description={`${selectedOperation.description} · ${formatDateTime(selectedOperation.createdAt)}`}
        kind={selectedOperation.kind === "FREQUENCY" ? "frequency" : "rank"}
        onClose={() => setSelectedOperation(undefined)}
        operationId={selectedOperation.id}
        projectId={projectId}
        title={selectedOperation.kind === "FREQUENCY" ? "Сбор частотности" : "Проверка позиций"}
      />
    )}
    </>
  );
}

interface Operation {
  readonly id: string;
  readonly kind: "FREQUENCY" | "RANK";
  readonly provider: "XMLSTOCK" | "ARSENKIN";
  readonly title: string;
  readonly description: string;
  readonly statusLabel: string;
  readonly progressLabel: string;
  readonly percent: number;
  readonly tab: OperationTab;
  readonly cancellable: boolean;
  readonly retryable: boolean;
  readonly version: number;
  readonly errorCode?: string;
  readonly routeLabel?: string;
  readonly createdAt: string;
}

function frequencyOperation(value: FrequencyCollectionSummary): Operation {
  const done = value.completedKeywords + value.failedKeywords;
  return {
    id: value.id,
    kind: "FREQUENCY",
    provider: value.provider,
    title: `Частотность · ${value.types.map(frequencyTypeLabel).join(" + ")}`,
    description: `${value.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools"} · ${value.types.map(frequencyTypeLabel).join(" + ")}`,
    statusLabel: operationStatusLabel(value.status, value.stage),
    progressLabel: `${done} из ${value.selectedKeywords}`,
    percent: value.selectedKeywords > 0 ? Math.round(done / value.selectedKeywords * 100) : 0,
    tab: operationTab(value.status),
    cancellable: ["QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRY_SCHEDULED", "FAILED_RETRYABLE"].includes(value.status),
    retryable: ["FAILED_FINAL", "PARTIALLY_COMPLETED", "ACTION_REQUIRED"].includes(value.status),
    version: value.version,
    ...(value.routingScope
      ? {
          routeLabel: `${connectorRoutingScopeLabel(value.routingScope)}${hasConnectorFallback(value.connectorAttempts) ? " · fallback выполнен" : ""}`
        }
      : {}),
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    createdAt: value.createdAt
  };
}

function rankOperation(value: RankJobSummary): Operation {
  const current = Number(value.progress.current);
  const total = Number(value.progress.total);
  const providerName = value.provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin";
  const searchSystem = value.searchEngine
    ? rankSearchSystemLabel(value.searchEngine, value.searchSource)
    : undefined;
  const description = [
    providerName,
    searchSystem,
    value.depth ? `Топ-${value.depth}` : undefined
  ].filter((part): part is string => Boolean(part)).join(" · ");
  return {
    id: value.id,
    kind: "RANK",
    provider: value.provider,
    title: `Проверка позиций · ${description}`,
    description,
    statusLabel: operationStatusLabel(value.status, value.stage),
    progressLabel: `${current} из ${total}`,
    percent: total > 0 ? Math.round(current / total * 100) : 0,
    tab: operationTab(value.status),
    cancellable: ["PREPARING", "QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(value.status),
    retryable: false,
    version: 1,
    ...(value.routingScope
      ? {
          routeLabel: `${connectorRoutingScopeLabel(value.routingScope)}${hasConnectorFallback(value.connectorAttempts) ? " · fallback выполнен" : ""}`
        }
      : {}),
    ...(value.status === "FAILED" || value.status === "ACTION_REQUIRED"
      ? { errorCode: value.failure.code }
      : {}),
    createdAt: value.createdAt
  };
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function operationError(error: unknown): string {
  return error instanceof BrowserApiError ? error.message : "Не удалось обновить журнал операций.";
}
