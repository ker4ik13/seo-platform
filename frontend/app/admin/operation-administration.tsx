"use client";

import { CustomSelect } from "../../components/custom-select";
import { AdminOperationCancel } from "../../components/admin-operation-cancel";
import { Icon } from "../../components/icon";
import { ProviderLogo } from "../../components/provider-logo";
import { adminOperationName, adminSearchProductLabel, operationFailureLabel } from "../../lib/admin-operation-presentation";
import { arsenkinProviderProgressLabel, operationStageLabel } from "../../lib/operation-status-presentation";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  AdminOperationSearchResult,
  AdminOperationStatusGroup,
  AdminOperationSummary
} from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { useAdminAutoRefresh } from "../../lib/use-admin-auto-refresh";
import { UiText, useUiLocale } from "../../components/ui-locale";

export function OperationAdministration({ canControl = false }: Readonly<{ canControl?: boolean }>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<AdminOperationStatusGroup>(() =>
    adminOperationStatus(searchParams.get("status"))
  );
  const [type, setType] = useState(() => adminOperationType(searchParams.get("type")));
  const [result, setResult] = useState<AdminOperationSearchResult>();
  const [selected, setSelected] = useState<AdminOperationSummary>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [error, setError] = useState<string>();
  const latestBaseRequest = useRef<AbortController | null>(null);
  const selectedOperationId = adminOperationId(searchParams.get("operation"));
  const selectedOperationRef = useRef(selectedOperationId);
  selectedOperationRef.current = selectedOperationId;

  const updateUrl = useCallback((changes: Readonly<{
    operation?: string | null;
    status?: AdminOperationStatusGroup;
    type?: string;
  }>) => {
    const next = new URLSearchParams(window.location.search);
    next.set("screen", "operations");
    if (changes.status !== undefined) {
      if (changes.status === "ALL") next.delete("status");
      else next.set("status", changes.status);
    }
    if (changes.type !== undefined) {
      if (changes.type) next.set("type", changes.type);
      else next.delete("type");
    }
    if (changes.operation !== undefined) {
      if (changes.operation) next.set("operation", changes.operation);
      else next.delete("operation");
    }
    const href = `/admin?${next.toString()}`;
    if (changes.operation !== undefined && changes.status === undefined && changes.type === undefined) {
      // Native history updates App Router's search params without reloading
      // the RSC tree or replacing the list under the user's scroll position.
      if (changes.operation) window.history.pushState(null, "", href);
      else window.history.replaceState(null, "", href);
    } else router.replace(href, { scroll: false });
  }, [router]);

  useEffect(() => {
    setStatus(adminOperationStatus(searchParams.get("status")));
    setType(adminOperationType(searchParams.get("type")));
  }, [searchParams]);

  const load = useCallback(async (cursor?: string, silent = false) => {
    const controller = cursor ? undefined : new AbortController();
    if (controller) {
      latestBaseRequest.current?.abort();
      latestBaseRequest.current = controller;
    }
    if (!silent) {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
    }
    setError(undefined);
    const params = new URLSearchParams({ status, limit: "50" });
    if (type) params.set("type", type);
    if (cursor) params.set("cursor", cursor);
    const response = await adminApi<AdminOperationSearchResult>(
      `/api/operations?${params.toString()}`,
      controller ? { signal: controller.signal } : undefined
    );
    if (controller?.signal.aborted) return;
    setLoading(false);
    setLoadingMore(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResult((current) => cursor && current
      ? { ...response.data, data: [...current.data, ...response.data.data] }
      : response.data
    );
    const requested = selectedOperationRef.current
      ? response.data.data.find(({ id }) => id === selectedOperationRef.current)
      : undefined;
    if (requested) setSelected(requested);
    else if (!selectedOperationRef.current) setSelected(undefined);
  }, [status, type]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => latestBaseRequest.current?.abort(), []);
  useEffect(() => {
    if (!selectedOperationId || selected?.id === selectedOperationId) return;
    const controller = new AbortController();
    setSelectedLoading(true);
    void adminApi<AdminOperationSummary>(
      `/api/operations/${encodeURIComponent(selectedOperationId)}`,
      { signal: controller.signal }
    ).then((response) => {
      if (controller.signal.aborted) return;
      if (response.ok) setSelected(response.data);
      else setError(response.message);
    }).finally(() => {
      if (!controller.signal.aborted) setSelectedLoading(false);
    });
    return () => controller.abort();
  }, [selected?.id, selectedOperationId]);
  useAdminAutoRefresh(() => load(undefined, true));

  const visibleTypes = useMemo(() => result?.types ?? [], [result]);
  return (
    <div className="content operation-admin">
      <section className="metric-grid workspace-metrics">
        <Metric label={uiText("Всего")} value={result?.totals.total} tone="neutral" />
        <Metric label={uiText("В процессе")} value={result?.totals.active} tone="active" />
        <Metric label={uiText("Завершены")} value={result?.totals.completed} tone="success" />
        <Metric label={uiText("Требуют внимания")} value={result?.totals.attention} tone="danger" />
      </section>
      <section className="panel operation-panel">
        <header className="operation-toolbar">
          <div className="filters">
            <CustomSelect aria-label={uiText("Состояние операций")} onChange={(event) => {
              const nextStatus = event.target.value as AdminOperationStatusGroup;
              setStatus(nextStatus);
              setSelected(undefined);
              updateUrl({ status: nextStatus, operation: null });
            }} value={status}>
              <option value="ALL"><UiText text="Все состояния" /></option>
              <option value="ACTIVE"><UiText text="В процессе" /></option>
              <option value="COMPLETED"><UiText text="Завершённые" /></option>
              <option value="ATTENTION"><UiText text="Ошибки и внимание" /></option>
            </CustomSelect>
            <CustomSelect aria-label={uiText("Тип операции")} onChange={(event) => {
              const nextType = event.target.value;
              setType(nextType);
              setSelected(undefined);
              updateUrl({ type: nextType, operation: null });
            }} value={type}>
              <option value=""><UiText text="Все типы" /></option>
              {visibleTypes.map((item) => <option key={item.type} value={item.type}>{adminOperationName({ type: item.type })} · {formatNumber(item.count, uiLocale)}</option>)}
            </CustomSelect>
          </div>
        </header>
        {error && <div className="form-alert workspace-message" role="alert">{<UiText text={error ?? ""} />}</div>}
        {loading ? (
          <div className="empty"><UiText text="Загружаем операции…" /></div>
        ) : !result || result.data.length === 0 ? (
          <div className="empty"><strong><UiText text="Операций нет" /></strong><span><UiText text="Для выбранного фильтра ничего не найдено." /></span></div>
        ) : (
          <div className="operation-table-wrap">
            <div className="operation-row operation-head" aria-hidden="true">
              <span><UiText text="Операция" /></span><span><UiText text="Контекст" /></span><span><UiText text="Источник / воркеры" /></span><span><UiText text="Состояние" /></span><span><UiText text="Прогресс / результат" /></span><span><UiText text="Время" /></span><span />
            </div>
            {result.data.map((operation) => <OperationRow key={operation.id} onOpen={() => {
              setSelected(operation);
              updateUrl({ operation: operation.id });
            }} operation={operation} canControl={canControl} onUpdated={() => void load(undefined, true)} />)}
          </div>
        )}
        {result?.nextCursor && (
          <button className="ghost operation-more" disabled={loadingMore} onClick={() => void load(result.nextCursor)} type="button">
            {loadingMore ? <UiText text="Загружаем…" /> : <UiText text="Показать ещё 50" />}
          </button>
        )}
      </section>
      {selectedLoading && (!selected || selected.id !== selectedOperationId) && (
        <div aria-live="polite" className="admin-detail-loading">
          <UiText text="Загружаем операцию…" />
        </div>
      )}
      {selected && selected.id === selectedOperationId && <OperationDrawer onClose={() => {
        setSelected(undefined);
        updateUrl({ operation: null });
      }} operation={selected} />}
    </div>
  );
}

function OperationRow({ onOpen, operation, canControl, onUpdated }: Readonly<{ onOpen: () => void; operation: AdminOperationSummary; canControl: boolean; onUpdated: () => void }>) {
  const { locale: uiLocale } = useUiLocale();
  const percent = progressPercent(operation);
  return (
    <article className="operation-row">
      <div className="operation-primary">
        <span className="operation-kind">{operation.provider === "XMLSTOCK" || operation.provider === "ARSENKIN" || operation.provider === "KEYS_SO"
          ? <ProviderLogo provider={operation.provider} size="compact" />
          : <Icon name={operationIcon(operation.type)} />}</span>
        <div><strong>{adminOperationName(operation)}</strong><small>{providerLabel(operation.provider)} · {shortId(operation.id)}</small></div>
      </div>
      <div className="operation-context" data-label="Контекст">
        <strong>{operation.project?.name ?? <UiText text="Без проекта" />}</strong>
        <small>{operation.workspace?.name ?? operation.workspaceId}</small>
      </div>
      <div className="operation-source" data-label="Источник / воркеры">
        <strong className="operation-source-connection">{[
          adminSearchProductLabel(operation),
          operation.connection
            ? `${operation.connection.label}${operation.connection.displayHint
              ? ` · ${operation.connection.displayHint}` : ""}`
            : undefined
        ].filter(Boolean).join(" · ") || "—"}</strong>
        <OperationWorkerCards workers={operation.workers} />
      </div>
      <div data-label="Состояние"><OperationStatus status={operation.status} />{operation.stage && <small className="operation-stage">{operationStage(operation)}</small>}</div>
      <div className="operation-progress" data-label="Прогресс / результат">
        <div><strong>{<UiText text={progressLabel(operation, uiLocale) ?? ""} />}</strong><small className={operation.providerProgressPercent === undefined ? undefined : "operation-provider-progress"}>{<UiText text={arsenkinProviderProgressLabel(operation.providerProgressPercent, uiLocale) ?? resultLabel(operation, uiLocale) ?? ""} />}</small></div>
        {percent !== undefined && <span><i style={{ width: `${percent}%` }} /></span>}
      </div>
      <time dateTime={operation.updatedAt}>{formatDate(operation.finishedAt ?? operation.updatedAt, uiLocale)}</time>
      <div className="admin-row-actions">{canControl && <AdminOperationCancel operation={operation} onUpdated={onUpdated} />}<button className="ghost workspace-open" onClick={onOpen} type="button"><UiText text="Детали" /></button></div>
    </article>
  );
}

function OperationDrawer({ onClose, operation }: Readonly<{ onClose: () => void; operation: AdminOperationSummary }>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside aria-label={uiText("Операция {0}", [String(operation.id)])} aria-modal="true" className="drawer operation-drawer" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header>
          <div><p><UiText text="Операция" /></p><h2>{adminOperationName(operation)}</h2></div>
          <button aria-label={uiText("Закрыть")} onClick={onClose} type="button">×</button>
        </header>
        <div className="operation-detail-status"><OperationStatus status={operation.status} /><span>{<UiText text={progressLabel(operation, uiLocale) ?? ""} />}</span></div>
        <div className="snapshot">
          <Snapshot label="Operation ID" value={operation.id} />
          <Snapshot label={uiText("Тип")} value={operation.type} />
          <Snapshot label="Workspace" value={operation.workspace?.name ?? operation.workspaceId} />
          <Snapshot label={uiText("Проект")} value={operation.project ? `${operation.project.name} · ${operation.project.domain}` : "Без проекта"} />
          <Snapshot label={uiText("Автор запуска")} value={operation.actor ? `${operation.actor.displayName} · ${operation.actor.email}` : "Системная операция"} />
          <Snapshot label={uiText("Провайдер")} value={providerLabel(operation.provider)} />
          <Snapshot label={uiText("Поисковая система")} value={adminSearchProductLabel(operation) ?? "—"} />
          <Snapshot label={uiText("Подключение")} value={operation.connection ? `${operation.connection.label}${operation.connection.displayHint ? ` · ${operation.connection.displayHint}` : ""}` : "—"} />
          <Snapshot label={uiText("Этап")} value={operation.stage ? operationStage(operation) : "—"} />
          {operation.providerProgressPercent !== undefined && <Snapshot label="Обработка в Arsenkin" value={`${operation.providerProgressPercent}% · текущая задача`} />}
          <Snapshot label={uiText("Попытка")} value={`${operation.attempt} из ${operation.maxAttempts}`} />
          <Snapshot label={uiText("Результат")} value={resultLabel(operation, uiLocale)} />
          <Snapshot label={uiText(operation.errorCode === "PROVIDER_CONCURRENCY_LIMITED" ? "Причина ожидания" : "Код ошибки")}
            value={operation.errorCode === "PROVIDER_CONCURRENCY_LIMITED" ? operationFailureLabel(operation.errorCode) : operation.errorCode ?? "—"} />
          <Snapshot label={uiText("Создана")} value={formatDate(operation.createdAt, uiLocale)} />
          <Snapshot label={uiText("Завершена")} value={operation.finishedAt ? formatDate(operation.finishedAt, uiLocale) : "Ещё выполняется"} />
        </div>
        <div className="operation-worker-details"><h3><UiText text="Воркеры" /></h3><OperationWorkerCards workers={operation.workers} /></div>
        <div className="workspace-readonly">
          <strong><UiText text="Безопасная сводка" /></strong>
          <p className="form-description"><UiText text="Исходные параметры, тексты ключей, ответы провайдера и секреты здесь намеренно не отображаются." /></p>
        </div>
      </aside>
    </div>
  );
}

function OperationWorkerCards({ workers }: Readonly<{ workers: AdminOperationSummary["workers"] }>) {
  const { t: uiText } = useUiLocale();
  if (!workers?.length) return <span className="operation-worker-empty"><UiText text="Нет активных назначений" /></span>;
  const statusLabels = {
    ONLINE: "На связи", OFFLINE: "Нет связи", DRAINING: "Завершает задачи",
    DISABLED: "Выключен", MAIN: "Основной сервер"
  } as const;
  return <div className="operation-worker-list">{workers.map((worker, index) => {
    const status=worker.status ?? (worker.name === "Основной сервер" ? "MAIN" : "OFFLINE");
    const operations=worker.assignedOperations ?? 1;
    const operationLabel=operations%10===1 && operations%100!==11 ? "операция"
      : operations%10>=2 && operations%10<=4 && (operations%100<12 || operations%100>14) ? "операции" : "операций";
    return <div className={`operation-worker-card operation-worker-${status.toLowerCase()}`} key={worker.nodeId ?? `${worker.name}:${index}`}>
      <span aria-hidden="true" className="operation-worker-icon"><Icon name={status === "MAIN" ? "dashboard" : "http"} /></span>
      <span className="operation-worker-copy"><strong>{status === "MAIN" ? uiText("Основной сервер") : worker.name}</strong><small>{operations} {operationLabel} · {worker.activeTasks > 0 ? `${worker.activeTasks} выдано запросов` : "ожидает задачи"}</small></span>
      <span className="operation-worker-status"><i aria-hidden="true" />{statusLabels[status]}</span>
    </div>;
  })}</div>;
}

function Metric({ label, tone, value }: Readonly<{ label: string; tone: string; value: number | undefined }>) {
  const uiLocale = useUiLocale().locale;
  return <article><span>{label}</span><strong>{value === undefined ? "—" : formatNumber(value, uiLocale)}</strong><small className={`metric-${tone}`}><UiText text="По всем операциям" /></small></article>;
}
function OperationStatus({ status }: Readonly<{ status: string }>) {
  return <b className={`status status-${status.toLowerCase().replaceAll("_", "-")}`}>{operationStatus(status)}</b>;
}
function Snapshot({ label, value }: Readonly<{ label: string; value: string }>) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function providerLabel(value: string | undefined): string {
  return ({ XMLSTOCK: "XMLStock", ARSENKIN: "Arsenkin Tools", KEYS_SO: "Keys.so" } as Record<string, string>)[value ?? ""] ?? value ?? "Без провайдера";
}
function operationStatus(value: string): string {
  return ({ DRAFT: "Черновик", ESTIMATING: "Оценка", AWAITING_APPROVAL: "Ожидает запуска", RESERVING_BALANCE: "Резерв", PREPARING: "Подготовка", QUEUED: "В очереди", WAITING_RATE_LIMIT: "Ожидает лимит", RUNNING: "Выполняется", PAUSE_REQUESTED: "Останавливается", PAUSED: "На паузе", CANCEL_REQUESTED: "Отменяется", CANCELLED: "Отменена", RETRY_SCHEDULED: "Ожидает", PARTIALLY_COMPLETED: "Частично завершена", COMPLETED: "Завершена", FAILED_RETRYABLE: "Ожидает", FAILED_FINAL: "Ошибка", ACTION_REQUIRED: "Требует внимания", EXPIRED: "Истекла" } as Record<string, string>)[value] ?? value;
}
function operationIcon(value: string): "rankCheck" | "frequency" | "cluster" | "http" | "search" | "import" | "export" | "operations" {
  return ({ MANUAL_RANK_CHECK: "rankCheck", FREQUENCY_COLLECTION: "frequency", CLUSTERING_RUN: "cluster", TECHNICAL_CRAWL: "http", KEYWORD_RESEARCH: "search", SEMANTIC_IMPORT: "import", SEMANTIC_EXPORT: "export" } as Record<string, ReturnType<typeof operationIcon>>)[value] ?? "operations";
}
function progressLabel(operation: AdminOperationSummary, uiLocale: string = "ru-RU"): string {
  const current = formatDecimal(operation.progress.current, uiLocale);
  return operation.progress.total ? `${current} из ${formatDecimal(operation.progress.total, uiLocale)}` : current;
}
function resultLabel(operation: AdminOperationSummary, uiLocale: string = "ru-RU"): string {
  const parts: string[] = [];
  if (operation.result.succeeded !== undefined) parts.push(`успешно ${formatNumber(operation.result.succeeded, uiLocale)}`);
  if (operation.result.found !== undefined) parts.push(`найдено ${formatNumber(operation.result.found, uiLocale)}`);
  if (operation.result.notFound !== undefined) parts.push(`не найдено ${formatNumber(operation.result.notFound, uiLocale)}`);
  if (operation.result.failed !== undefined) parts.push(`ошибок ${formatNumber(operation.result.failed, uiLocale)}`);
  if (operation.result.issues !== undefined) parts.push(`проблем ${formatNumber(operation.result.issues, uiLocale)}`);
  if (operation.errorCode) parts.push(operationFailureLabel(operation.errorCode));
  if (parts.length > 0) return parts.join(" · ");
  if (
    operation.type === "MANUAL_RANK_CHECK" &&
    operation.status === "RUNNING" &&
    Number(operation.progress.current) > 0
  ) {
    return `сохранено позиций: ${formatDecimal(operation.progress.current, uiLocale)}`;
  }
  return "Результат ещё не сформирован";
}
function operationStage(operation: AdminOperationSummary): string {
  if (
    operation.type === "MANUAL_RANK_CHECK" &&
    operation.stage === "WAITING_EXECUTION_GRANT"
  ) {
    return Number(operation.progress.current) > 0
      ? "Сбор и сохранение позиций"
      : "Подготовка запросов к съёму";
  }
  return operationStageLabel(operation.stage, operation.status);
}
function progressPercent(operation: AdminOperationSummary): number | undefined {
  if (!operation.progress.total) return undefined;
  const current = Number(operation.progress.current);
  const total = Number(operation.progress.total);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}
function formatDecimal(value: string, uiLocale: string = "ru-RU"): string { const parsed = Number(value); return Number.isSafeInteger(parsed) ? formatNumber(parsed, uiLocale) : value; }
function formatNumber(value: number, uiLocale: string = "ru-RU"): string { return new Intl.NumberFormat(uiLocale).format(value); }
function formatDate(value: string, uiLocale: string = "ru-RU"): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(uiLocale, { dateStyle: "short", timeStyle: "short" }).format(date); }
function shortId(value: string): string { return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }

function adminOperationStatus(value: string | null): AdminOperationStatusGroup {
  return ["ALL", "ACTIVE", "COMPLETED", "ATTENTION"].includes(value ?? "")
    ? value as AdminOperationStatusGroup
    : "ALL";
}

function adminOperationType(value: string | null): string {
  return value && /^[A-Z][A-Z0-9_]{0,79}$/u.test(value) ? value : "";
}

function adminOperationId(value: string | null): string | undefined {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
    ? value
    : undefined;
}
