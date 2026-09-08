"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminOperationSearchResult,
  AdminOperationStatusGroup,
  AdminOperationSummary
} from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { UiText, useUiLocale } from "../../components/ui-locale";


export function OperationAdministration() {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
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
        <div><p>Execution control plane</p><h1><UiText text="Операции" /></h1></div>
        <span className="system-state"><i /> <UiText text="Обновление каждые 15 секунд" before=" " /></span>
      </section>
      <section className="metric-grid workspace-metrics">
        <Metric label={uiText("Всего")} value={result?.totals.total} tone="neutral" />
        <Metric label={uiText("В процессе")} value={result?.totals.active} tone="active" />
        <Metric label={uiText("Завершены")} value={result?.totals.completed} tone="success" />
        <Metric label={uiText("Требуют внимания")} value={result?.totals.attention} tone="danger" />
      </section>
      <section className="panel operation-panel">
        <header className="operation-toolbar">
          <div><h2><UiText text="Журнал выполнения" /></h2><p><UiText text="Без входных payload’ов, секретов и текстов запросов" /></p></div>
          <div className="filters">
            <select aria-label={uiText("Состояние операций")} onChange={(event) => setStatus(event.target.value as AdminOperationStatusGroup)} value={status}>
              <option value="ALL"><UiText text="Все состояния" /></option>
              <option value="ACTIVE"><UiText text="В процессе" /></option>
              <option value="COMPLETED"><UiText text="Завершённые" /></option>
              <option value="ATTENTION"><UiText text="Ошибки и внимание" /></option>
            </select>
            <select aria-label={uiText("Тип операции")} onChange={(event) => setType(event.target.value)} value={type}>
              <option value=""><UiText text="Все типы" /></option>
              {visibleTypes.map((item) => <option key={item.type} value={item.type}>{operationType(item.type)} · {formatNumber(item.count, uiLocale)}</option>)}
            </select>
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
              <span><UiText text="Операция" /></span><span><UiText text="Контекст" /></span><span><UiText text="Состояние" /></span><span><UiText text="Прогресс / результат" /></span><span><UiText text="Время" /></span><span />
            </div>
            {result.data.map((operation) => <OperationRow key={operation.id} onOpen={() => setSelected(operation)} operation={operation} />)}
          </div>
        )}
        {result?.nextCursor && (
          <button className="ghost operation-more" disabled={loadingMore} onClick={() => void load(result.nextCursor)} type="button">
            {loadingMore ? <UiText text="Загружаем…" /> : <UiText text="Показать ещё 50" />}
          </button>
        )}
      </section>
      {selected && <OperationDrawer onClose={() => setSelected(undefined)} operation={selected} />}
    </div>
  );
}

function OperationRow({ onOpen, operation }: Readonly<{ onOpen: () => void; operation: AdminOperationSummary }>) {
  const uiLocale = useUiLocale().locale;
  const percent = progressPercent(operation);
  return (
    <article className="operation-row">
      <div className="operation-primary">
        <span className="operation-kind">{typeMark(operation.type)}</span>
        <div><strong>{operationType(operation.type)}</strong><small>{operation.provider ?? <UiText text="Без провайдера" />} · {shortId(operation.id)}</small></div>
      </div>
      <div className="operation-context" data-label="Контекст">
        <strong>{operation.project?.name ?? <UiText text="Без проекта" />}</strong>
        <small>{operation.workspace?.name ?? operation.workspaceId}</small>
      </div>
      <div data-label="Состояние"><OperationStatus status={operation.status} type={operation.type} />{operation.stage && <small className="operation-stage">{operation.stage}</small>}</div>
      <div className="operation-progress" data-label="Прогресс / результат">
        <div><strong>{<UiText text={progressLabel(operation, uiLocale) ?? ""} />}</strong><small>{<UiText text={resultLabel(operation, uiLocale) ?? ""} />}</small></div>
        {percent !== undefined && <span><i style={{ width: `${percent}%` }} /></span>}
      </div>
      <time dateTime={operation.updatedAt}>{formatDate(operation.finishedAt ?? operation.updatedAt, uiLocale)}</time>
      <button className="ghost workspace-open" onClick={onOpen} type="button"><UiText text="Детали" /></button>
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
          <div><p><UiText text="Операция" /></p><h2>{operationType(operation.type)}</h2></div>
          <button aria-label={uiText("Закрыть")} onClick={onClose} type="button">×</button>
        </header>
        <div className="operation-detail-status"><OperationStatus status={operation.status} type={operation.type} /><span>{<UiText text={progressLabel(operation, uiLocale) ?? ""} />}</span></div>
        <div className="snapshot">
          <Snapshot label="Operation ID" value={operation.id} />
          <Snapshot label={uiText("Тип")} value={operation.type} />
          <Snapshot label="Workspace" value={operation.workspace?.name ?? operation.workspaceId} />
          <Snapshot label={uiText("Проект")} value={operation.project ? `${operation.project.name} · ${operation.project.domain}` : "Без проекта"} />
          <Snapshot label={uiText("Автор запуска")} value={operation.actor ? `${operation.actor.displayName} · ${operation.actor.email}` : "Системная операция"} />
          <Snapshot label={uiText("Провайдер")} value={operation.provider ?? "—"} />
          <Snapshot label={uiText("Этап")} value={operation.stage ?? "—"} />
          <Snapshot label={uiText("Попытка")} value={`${operation.attempt} из ${operation.maxAttempts}`} />
          <Snapshot label={uiText("Результат")} value={resultLabel(operation, uiLocale)} />
          <Snapshot label={uiText("Код ошибки")} value={operation.errorCode ?? "—"} />
          <Snapshot label={uiText("Создана")} value={formatDate(operation.createdAt, uiLocale)} />
          <Snapshot label={uiText("Завершена")} value={operation.finishedAt ? formatDate(operation.finishedAt, uiLocale) : "Ещё выполняется"} />
        </div>
        <div className="workspace-readonly">
          <strong><UiText text="Безопасная сводка" /></strong>
          <p className="form-description"><UiText text="Исходные параметры, тексты ключей, ответы провайдера и секреты здесь намеренно не отображаются." /></p>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, tone, value }: Readonly<{ label: string; tone: string; value: number | undefined }>) {
  const uiLocale = useUiLocale().locale;
  return <article><span>{label}</span><strong>{value === undefined ? "—" : formatNumber(value, uiLocale)}</strong><small className={`metric-${tone}`}><UiText text="По всем операциям" /></small></article>;
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
  return parts.join(" · ") || (operation.errorCode ? `Код: ${operation.errorCode}` : "Результат ещё не сформирован");
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
