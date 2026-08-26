"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminOperationSearchResult,
  AdminOperationStatusGroup,
  AdminOperationSummary
} from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";

export function OperationAdministration() {
  const [status, setStatus] = useState<AdminOperationStatusGroup>("ALL");
  const [type, setType] = useState("");
  const [result, setResult] = useState<AdminOperationSearchResult>();
  const [selected, setSelected] = useState<AdminOperationSummary>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async (cursor?: string, silent = false) => {
    if (!silent) {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
    }
    setError(undefined);
    const params = new URLSearchParams({ status, limit: "50" });
    if (type) params.set("type", type);
    if (cursor) params.set("cursor", cursor);
    const response = await adminApi<AdminOperationSearchResult>(
      `/api/operations?${params.toString()}`
    );
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
    setSelected((current) => current
      ? response.data.data.find((operation) => operation.id === current.id) ?? current
      : undefined
    );
  }, [status, type]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (status === "COMPLETED" || status === "ATTENTION") return;
    const timer = window.setInterval(() => void load(undefined, true), 15_000);
    return () => window.clearInterval(timer);
  }, [load, status]);

  const visibleTypes = useMemo(() => result?.types ?? [], [result]);
  return (
    <div className="content operation-admin">
      <section className="heading">
        <div><p>Execution control plane</p><h1>Операции</h1></div>
        <span className="system-state"><i /> Обновление каждые 15 секунд</span>
      </section>
      <section className="metric-grid workspace-metrics">
        <Metric label="Всего" value={result?.totals.total} tone="neutral" />
        <Metric label="В процессе" value={result?.totals.active} tone="active" />
        <Metric label="Завершены" value={result?.totals.completed} tone="success" />
        <Metric label="Требуют внимания" value={result?.totals.attention} tone="danger" />
      </section>
      <section className="panel operation-panel">
        <header className="operation-toolbar">
          <div><h2>Журнал выполнения</h2><p>Без входных payload’ов, секретов и текстов запросов</p></div>
          <div className="filters">
            <select aria-label="Состояние операций" onChange={(event) => setStatus(event.target.value as AdminOperationStatusGroup)} value={status}>
              <option value="ALL">Все состояния</option>
              <option value="ACTIVE">В процессе</option>
              <option value="COMPLETED">Завершённые</option>
              <option value="ATTENTION">Ошибки и внимание</option>
            </select>
            <select aria-label="Тип операции" onChange={(event) => setType(event.target.value)} value={type}>
              <option value="">Все типы</option>
              {visibleTypes.map((item) => <option key={item.type} value={item.type}>{operationType(item.type)} · {formatNumber(item.count)}</option>)}
            </select>
          </div>
        </header>
        {error && <div className="form-alert workspace-message" role="alert">{error}</div>}
        {loading ? (
          <div className="empty">Загружаем операции…</div>
        ) : !result || result.data.length === 0 ? (
          <div className="empty"><strong>Операций нет</strong><span>Для выбранного фильтра ничего не найдено.</span></div>
        ) : (
          <div className="operation-table-wrap">
            <div className="operation-row operation-head" aria-hidden="true">
              <span>Операция</span><span>Контекст</span><span>Состояние</span><span>Прогресс / результат</span><span>Время</span><span />
            </div>
            {result.data.map((operation) => <OperationRow key={operation.id} onOpen={() => setSelected(operation)} operation={operation} />)}
          </div>
        )}
        {result?.nextCursor && (
          <button className="ghost operation-more" disabled={loadingMore} onClick={() => void load(result.nextCursor)} type="button">
            {loadingMore ? "Загружаем…" : "Показать ещё 50"}
          </button>
        )}
      </section>
      {selected && <OperationDrawer onClose={() => setSelected(undefined)} operation={selected} />}
    </div>
  );
}

function OperationRow({ onOpen, operation }: Readonly<{ onOpen: () => void; operation: AdminOperationSummary }>) {
  const percent = progressPercent(operation);
  return (
    <article className="operation-row">
      <div className="operation-primary">
        <span className="operation-kind">{typeMark(operation.type)}</span>
        <div><strong>{operationType(operation.type)}</strong><small>{operation.provider ?? "Без провайдера"} · {shortId(operation.id)}</small></div>
      </div>
      <div className="operation-context" data-label="Контекст">
        <strong>{operation.project?.name ?? "Без проекта"}</strong>
        <small>{operation.workspace?.name ?? operation.workspaceId}</small>
      </div>
      <div data-label="Состояние"><OperationStatus status={operation.status} type={operation.type} />{operation.stage && <small className="operation-stage">{operation.stage}</small>}</div>
      <div className="operation-progress" data-label="Прогресс / результат">
        <div><strong>{progressLabel(operation)}</strong><small>{resultLabel(operation)}</small></div>
        {percent !== undefined && <span><i style={{ width: `${percent}%` }} /></span>}
      </div>
      <time dateTime={operation.updatedAt}>{formatDate(operation.finishedAt ?? operation.updatedAt)}</time>
      <button className="ghost workspace-open" onClick={onOpen} type="button">Детали</button>
    </article>
  );
}

function OperationDrawer({ onClose, operation }: Readonly<{ onClose: () => void; operation: AdminOperationSummary }>) {
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside aria-label={`Операция ${operation.id}`} aria-modal="true" className="drawer operation-drawer" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header>
          <div><p>Операция</p><h2>{operationType(operation.type)}</h2></div>
          <button aria-label="Закрыть" onClick={onClose} type="button">×</button>
        </header>
        <div className="operation-detail-status"><OperationStatus status={operation.status} type={operation.type} /><span>{progressLabel(operation)}</span></div>
        <div className="snapshot">
          <Snapshot label="Operation ID" value={operation.id} />
          <Snapshot label="Тип" value={operation.type} />
          <Snapshot label="Workspace" value={operation.workspace?.name ?? operation.workspaceId} />
          <Snapshot label="Проект" value={operation.project ? `${operation.project.name} · ${operation.project.domain}` : "Без проекта"} />
          <Snapshot label="Автор запуска" value={operation.actor ? `${operation.actor.displayName} · ${operation.actor.email}` : "Системная операция"} />
          <Snapshot label="Провайдер" value={operation.provider ?? "—"} />
          <Snapshot label="Этап" value={operation.stage ?? "—"} />
          <Snapshot label="Попытка" value={`${operation.attempt} из ${operation.maxAttempts}`} />
          <Snapshot label="Результат" value={resultLabel(operation)} />
          <Snapshot label="Код ошибки" value={operation.errorCode ?? "—"} />
          <Snapshot label="Создана" value={formatDate(operation.createdAt)} />
          <Snapshot label="Завершена" value={operation.finishedAt ? formatDate(operation.finishedAt) : "Ещё выполняется"} />
        </div>
        <div className="workspace-readonly">
          <strong>Безопасная сводка</strong>
          <p className="form-description">Исходные параметры, тексты ключей, ответы провайдера и секреты здесь намеренно не отображаются.</p>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, tone, value }: Readonly<{ label: string; tone: string; value: number | undefined }>) {
  return <article><span>{label}</span><strong>{value === undefined ? "—" : formatNumber(value)}</strong><small className={`metric-${tone}`}>По всем операциям</small></article>;
}
function OperationStatus({ status, type }: Readonly<{ status: string; type: string }>) {
  const exhaustedValidation = type === "INTEGRATION_CREDENTIAL_VALIDATE" && status === "FAILED_RETRYABLE";
  const tone = exhaustedValidation ? "failed-final" : status.toLowerCase().replaceAll("_", "-");
  return <b className={`status status-${tone}`}>{operationStatus(status, type)}</b>;
}
function Snapshot({ label, value }: Readonly<{ label: string; value: string }>) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function operationType(value: string): string {
  return ({ MANUAL_RANK_CHECK: "Проверка позиций", FREQUENCY_COLLECTION: "Сбор частотности", CLUSTERING_RUN: "Кластеризация запросов", TECHNICAL_CRAWL: "Обход сайта", KEYWORD_RESEARCH: "Исследование запросов", SEMANTIC_IMPORT: "Импорт семантики", SEMANTIC_EXPORT: "Экспорт семантики", INTEGRATION_CREDENTIAL_VALIDATE: "Проверка подключения" } as Record<string, string>)[value] ?? value.toLocaleLowerCase("ru-RU").replaceAll("_", " ");
}
function operationStatus(value: string, type: string): string {
  if (value === "FAILED_RETRYABLE" && type === "INTEGRATION_CREDENTIAL_VALIDATE") {
    return "Повторы исчерпаны";
  }
  return ({ DRAFT: "Черновик", ESTIMATING: "Оценка", AWAITING_APPROVAL: "Ожидает запуска", RESERVING_BALANCE: "Резерв", PREPARING: "Подготовка", QUEUED: "В очереди", WAITING_RATE_LIMIT: "Ожидает лимит", RUNNING: "Выполняется", PAUSE_REQUESTED: "Останавливается", PAUSED: "На паузе", CANCEL_REQUESTED: "Отменяется", CANCELLED: "Отменена", RETRY_SCHEDULED: "Повтор запланирован", PARTIALLY_COMPLETED: "Частично завершена", COMPLETED: "Завершена", FAILED_RETRYABLE: "Повтор после ошибки", FAILED_FINAL: "Ошибка", ACTION_REQUIRED: "Требует внимания", EXPIRED: "Истекла" } as Record<string, string>)[value] ?? value;
}
function typeMark(value: string): string { return ({ MANUAL_RANK_CHECK: "↗", FREQUENCY_COLLECTION: "ƒ", CLUSTERING_RUN: "◫", TECHNICAL_CRAWL: "⌁", KEYWORD_RESEARCH: "◎", SEMANTIC_IMPORT: "↓", SEMANTIC_EXPORT: "↑" } as Record<string, string>)[value] ?? "•"; }
function progressLabel(operation: AdminOperationSummary): string {
  const current = formatDecimal(operation.progress.current);
  return operation.progress.total ? `${current} из ${formatDecimal(operation.progress.total)}` : current;
}
function resultLabel(operation: AdminOperationSummary): string {
  const parts: string[] = [];
  if (operation.result.succeeded !== undefined) parts.push(`успешно ${formatNumber(operation.result.succeeded)}`);
  if (operation.result.found !== undefined) parts.push(`найдено ${formatNumber(operation.result.found)}`);
  if (operation.result.notFound !== undefined) parts.push(`не найдено ${formatNumber(operation.result.notFound)}`);
  if (operation.result.failed !== undefined) parts.push(`ошибок ${formatNumber(operation.result.failed)}`);
  if (operation.result.issues !== undefined) parts.push(`проблем ${formatNumber(operation.result.issues)}`);
  return parts.join(" · ") || (operation.errorCode ? `Код: ${operation.errorCode}` : "Результат ещё не сформирован");
}
function progressPercent(operation: AdminOperationSummary): number | undefined {
  if (!operation.progress.total) return undefined;
  const current = Number(operation.progress.current);
  const total = Number(operation.progress.total);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}
function formatDecimal(value: string): string { const parsed = Number(value); return Number.isSafeInteger(parsed) ? formatNumber(parsed) : value; }
function formatNumber(value: number): string { return new Intl.NumberFormat("ru-RU").format(value); }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date); }
function shortId(value: string): string { return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }
