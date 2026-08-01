"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FrequencyCollectionSummary,
  RankJobSummary
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";

type OperationTab = "ACTIVE" | "COMPLETED" | "ERROR";

export function SemanticOperationsDrawer({
  onClose,
  projectId,
  refreshToken = 0
}: Readonly<{
  onClose: () => void;
  projectId: string;
  refreshToken?: number;
}>) {
  const [frequencies, setFrequencies] = useState<readonly FrequencyCollectionSummary[]>([]);
  const [ranks, setRanks] = useState<readonly RankJobSummary[]>([]);
  const [tab, setTab] = useState<OperationTab>("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [cancellingId, setCancellingId] = useState<string>();
  const [retryingId, setRetryingId] = useState<string>();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [frequencyResult, rankResult] = await Promise.all([
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
      setFrequencies(frequencyResult.collections);
      setRanks(rankResult.jobs);
      setError(undefined);
    } catch (requestError) {
      if (!signal?.aborted) setError(operationError(requestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    const timer = window.setInterval(() => void load(controller.signal), 4_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load, refreshToken]);

  const operations = useMemo(() => {
    const values: Operation[] = [
      ...frequencies.map((value) => frequencyOperation(value, projectId)),
      ...ranks.map((value) => rankOperation(value, projectId))
    ];
    return values
      .filter((operation) => operation.tab === tab)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [frequencies, projectId, ranks, tab]);

  const counts = useMemo(() => ({
    ACTIVE: [...frequencies.map((value) => frequencyOperation(value, projectId)), ...ranks.map((value) => rankOperation(value, projectId))].filter(({ tab }) => tab === "ACTIVE").length,
    COMPLETED: [...frequencies.map((value) => frequencyOperation(value, projectId)), ...ranks.map((value) => rankOperation(value, projectId))].filter(({ tab }) => tab === "COMPLETED").length,
    ERROR: [...frequencies.map((value) => frequencyOperation(value, projectId)), ...ranks.map((value) => rankOperation(value, projectId))].filter(({ tab }) => tab === "ERROR").length
  }), [frequencies, projectId, ranks]);

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
      {error && <div className="inline-alert danger" role="alert">{error}</div>}
      {loading ? (
        <div className="semantic-dialog-loading" role="status">Загружаем журнал операций…</div>
      ) : operations.length > 0 ? operations.map((operation) => (
        <article key={`${operation.kind}:${operation.id}`}>
          <header><strong>{operation.title}</strong><span>{operation.statusLabel}</span></header>
          <div className="semantic-operation-progress"><i style={{ width: `${operation.percent}%` }} /></div>
          <div><span>{operation.progressLabel}</span><time>{formatDateTime(operation.createdAt)}</time></div>
          {operation.errorCode && <small>Код: {operation.errorCode}</small>}
          <footer>
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
            <a href={operation.href}>{operation.kind === "RANK" ? "Открыть позиции" : "Открыть семантику"}</a>
          </footer>
        </article>
      )) : (
        <div className="semantic-inspector-empty"><strong>В этом разделе задач нет</strong><span>История хранится на сервере и появится после первого запуска.</span></div>
      )}
    </aside>
  );
}

interface Operation {
  readonly id: string;
  readonly kind: "FREQUENCY" | "RANK";
  readonly title: string;
  readonly statusLabel: string;
  readonly progressLabel: string;
  readonly percent: number;
  readonly tab: OperationTab;
  readonly cancellable: boolean;
  readonly retryable: boolean;
  readonly version: number;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly href: string;
}

function frequencyOperation(value: FrequencyCollectionSummary, projectId: string): Operation {
  const done = value.completedKeywords + value.failedKeywords;
  return {
    id: value.id,
    kind: "FREQUENCY",
    title: `Частотность · ${value.types.map(frequencyTypeLabel).join(" + ")}`,
    statusLabel: frequencyStatus(value.status),
    progressLabel: `${done} из ${value.selectedKeywords}`,
    percent: value.selectedKeywords > 0 ? Math.round(done / value.selectedKeywords * 100) : 0,
    tab: operationTab(value.status),
    cancellable: ["QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRY_SCHEDULED", "FAILED_RETRYABLE"].includes(value.status),
    retryable: ["FAILED_FINAL", "PARTIALLY_COMPLETED", "ACTION_REQUIRED"].includes(value.status),
    version: value.version,
    ...(value.failureCode ? { errorCode: value.failureCode } : {}),
    createdAt: value.createdAt,
    href: `/app/semantics?projectId=${encodeURIComponent(projectId)}`
  };
}

function rankOperation(value: RankJobSummary, projectId: string): Operation {
  const current = Number(value.progress.current);
  const total = Number(value.progress.total);
  return {
    id: value.id,
    kind: "RANK",
    title: "Проверка позиций · Arsenkin",
    statusLabel: frequencyStatus(value.status),
    progressLabel: `${current} из ${total}`,
    percent: total > 0 ? Math.round(current / total * 100) : 0,
    tab: operationTab(value.status),
    cancellable: ["PREPARING", "QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(value.status),
    retryable: false,
    version: 1,
    ...(value.status === "FAILED" || value.status === "ACTION_REQUIRED"
      ? { errorCode: value.failure.code }
      : {}),
    createdAt: value.createdAt,
    href: `/app/projects/${encodeURIComponent(projectId)}/rankings`
  };
}

function operationTab(status: string): OperationTab {
  if (["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED"].includes(status)) return "COMPLETED";
  if (["FAILED", "FAILED_FINAL", "ACTION_REQUIRED", "EXPIRED"].includes(status)) return "ERROR";
  return "ACTIVE";
}

function frequencyStatus(status: string): string {
  const labels: Readonly<Record<string, string>> = {
    PREPARING: "Подготовка", QUEUED: "В очереди", RUNNING: "Выполняется",
    WAITING_RATE_LIMIT: "Ждёт лимита", RETRY_SCHEDULED: "Повтор запланирован",
    FAILED_RETRYABLE: "Ожидает повтора", CANCEL_REQUESTED: "Останавливается",
    CANCELLED: "Отменено", COMPLETED: "Завершено", PARTIALLY_COMPLETED: "Частично",
    FAILED: "Ошибка", FAILED_FINAL: "Ошибка", ACTION_REQUIRED: "Требует внимания", EXPIRED: "Истекло"
  };
  return labels[status] ?? status;
}

function frequencyTypeLabel(type: string): string {
  return { BASE: "базовая", EXACT: "фразовая", FIXED: "точная" }[type] ?? type;
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
