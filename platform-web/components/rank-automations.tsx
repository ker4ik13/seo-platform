"use client";

import type {
  AutomationRunCollection,
  AutomationRunSummary,
  RankTrackingAutomationSettings,
  RankTrackingAutomationSummary,
  TrackingContextSettings
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import {
  automationRunStatusLabel,
  emptyRankAutomationDraft,
  rankAutomationApiPath,
  rankAutomationDraft,
  rankAutomationInput,
  rankAutomationsApiPath,
  rankAutomationScheduleLabel,
  type RankAutomationDraft,
  type RankAutomationDraftErrors,
  validateRankAutomationDraft
} from "../lib/rank-automations";
import { trackingContextsApiPath } from "../lib/tracking-contexts";

interface EditorState {
  readonly automation?: RankTrackingAutomationSummary;
  readonly draft: RankAutomationDraft;
}

export function RankAutomations({
  projectId
}: Readonly<{
  projectId: string;
}>) {
  const [collection, setCollection] =
    useState<RankTrackingAutomationSettings>();
  const [contexts, setContexts] = useState<TrackingContextSettings>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [editor, setEditor] = useState<EditorState>();
  const [errors, setErrors] = useState<RankAutomationDraftErrors>({});
  const [runsByAutomation, setRunsByAutomation] = useState<
    Readonly<Record<string, AutomationRunCollection>>
  >({});
  const [runsLoading, setRunsLoading] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [online, setOnline] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(undefined);
      try {
        const [nextCollection, nextContexts] = await Promise.all([
          browserApiRequest<RankTrackingAutomationSettings>(
            rankAutomationsApiPath(projectId),
            signal ? { signal } : {}
          ),
          browserApiRequest<TrackingContextSettings>(
            trackingContextsApiPath(projectId),
            signal ? { signal } : {}
          )
        ]);
        setCollection(nextCollection);
        setContexts(nextContexts);
      } catch (error) {
        if (signal?.aborted) return;
        setLoadError(errorMessage(error, "Не удалось загрузить автоматизации."));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, retry]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    globalThis.addEventListener("online", update);
    globalThis.addEventListener("offline", update);
    return () => {
      globalThis.removeEventListener("online", update);
      globalThis.removeEventListener("offline", update);
    };
  }, []);

  const activeContexts = useMemo(
    () => contexts?.contexts.filter(({ status }) => status === "ACTIVE") ?? [],
    [contexts]
  );
  const mutationsAllowed =
    online &&
    collection?.access.canManage === true;
  const enableAllowed =
    online &&
    collection?.access.canEnable === true;
  const anyBusy = busyId !== undefined;

  function startCreate(): void {
    setErrors({});
    setOperationError(undefined);
    setSuccess(undefined);
    setEditor({
      draft: {
        ...emptyRankAutomationDraft(),
        ...(activeContexts[0]
          ? { trackingContextId: activeContexts[0].id }
          : {})
      }
    });
  }

  function startEdit(automation: RankTrackingAutomationSummary): void {
    setErrors({});
    setOperationError(undefined);
    setSuccess(undefined);
    setEditor({ automation, draft: rankAutomationDraft(automation) });
  }

  function changeDraft(patch: Partial<RankAutomationDraft>): void {
    setEditor((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...patch } }
        : current
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor || !mutationsAllowed) return;
    const nextErrors = validateRankAutomationDraft(editor.draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const existing = editor.automation;
    const busy = existing?.id ?? "create";
    setBusyId(busy);
    setOperationError(undefined);
    setSuccess(undefined);
    try {
      const saved = await browserApiRequest<RankTrackingAutomationSummary>(
        existing
          ? rankAutomationApiPath(projectId, existing.id)
          : rankAutomationsApiPath(projectId),
        {
          method: existing ? "PATCH" : "POST",
          body: rankAutomationInput(editor.draft),
          ...(existing
            ? { ifMatch: existing.version }
            : {
                idempotencyKey: `rank-automation:${globalThis.crypto.randomUUID()}`
              })
        }
      );
      setCollection((current) =>
        current ? withAutomation(current, saved) : current
      );
      setEditor(undefined);
      setSuccess(
        existing
          ? "Автоматизация обновлена и расписание синхронизировано."
          : "Автоматизация создана и расписание синхронизировано."
      );
    } catch (error) {
      setOperationError(
        errorMessage(error, "Не удалось сохранить автоматизацию.")
      );
      if (isVersionConflict(error)) void load();
    } finally {
      setBusyId(undefined);
    }
  }

  async function setEnabled(
    automation: RankTrackingAutomationSummary,
    action: "pause" | "resume"
  ): Promise<void> {
    setBusyId(automation.id);
    setOperationError(undefined);
    setSuccess(undefined);
    try {
      const saved = await browserApiRequest<RankTrackingAutomationSummary>(
        `${rankAutomationApiPath(projectId, automation.id)}/${action}`,
        {
          method: "POST",
          body: {},
          ifMatch: automation.version
        }
      );
      setCollection((current) =>
        current ? withAutomation(current, saved) : current
      );
      setSuccess(
        action === "pause"
          ? "Расписание приостановлено."
          : "Расписание включено."
      );
    } catch (error) {
      setOperationError(
        errorMessage(
          error,
          action === "pause"
            ? "Не удалось приостановить расписание."
            : "Не удалось включить расписание."
        )
      );
      if (isVersionConflict(error)) void load();
    } finally {
      setBusyId(undefined);
    }
  }

  async function runNow(
    automation: RankTrackingAutomationSummary
  ): Promise<void> {
    setBusyId(automation.id);
    setOperationError(undefined);
    setSuccess(undefined);
    try {
      const run = await browserApiRequest<AutomationRunSummary>(
        `${rankAutomationApiPath(projectId, automation.id)}/runs`,
        {
          method: "POST",
          body: {},
          ifMatch: automation.version,
          idempotencyKey: `rank-automation-run:${globalThis.crypto.randomUUID()}`
        }
      );
      setRunsByAutomation((current) => ({
        ...current,
        [automation.id]: prependRun(current[automation.id], run)
      }));
      setSuccess(
        run.status === "SKIPPED"
          ? "Запуск пропущен: предыдущий запуск ещё выполняется."
          : "Ручной съём создан. Ход выполнения доступен в истории запусков."
      );
    } catch (error) {
      setOperationError(errorMessage(error, "Не удалось запустить съём."));
    } finally {
      setBusyId(undefined);
    }
  }

  async function toggleRuns(automationId: string): Promise<void> {
    if (runsByAutomation[automationId]) {
      setRunsByAutomation((current) => {
        const next = { ...current };
        delete next[automationId];
        return next;
      });
      return;
    }
    setRunsLoading(automationId);
    setOperationError(undefined);
    try {
      const runs = await browserApiRequest<AutomationRunCollection>(
        `${rankAutomationApiPath(projectId, automationId)}/runs`
      );
      setRunsByAutomation((current) => ({
        ...current,
        [automationId]: runs
      }));
    } catch (error) {
      setOperationError(
        errorMessage(error, "Не удалось загрузить историю запусков.")
      );
    } finally {
      setRunsLoading(undefined);
    }
  }

  if (loading && !collection) {
    return (
      <section aria-busy="true" className="panel automation-loading">
        <span aria-hidden="true" className="spinner" />
        <div>
          <strong>Загружаем расписания…</strong>
          <p>Проверяем лимит тарифа, контексты и последние состояния.</p>
        </div>
      </section>
    );
  }

  if (!collection || !contexts) {
    return (
      <section className="panel panel-empty">
        <span aria-hidden="true" className="state-icon">!</span>
        <strong>Автоматизации недоступны</strong>
        <p>{loadError ?? "Не удалось получить актуальное состояние."}</p>
        <button
          className="secondary-button"
          disabled={!online || loading}
          onClick={() => setRetry((value) => value + 1)}
          type="button"
        >
          {online ? "Повторить" : "Ждём соединение"}
        </button>
      </section>
    );
  }

  return (
    <div className="automation-stack">
      {!online && (
        <div className="inline-alert warning" role="status">
          Офлайн-режим: данные остаются видимыми, изменения отключены.
        </div>
      )}
      {operationError && (
        <div className="inline-alert danger" role="alert">
          {operationError}
        </div>
      )}
      {success && (
        <div className="inline-alert success" role="status">{success}</div>
      )}
      {!mutationsAllowed && (
        <div className="inline-alert warning" role="note">
          {mutationRestriction(online, collection)}
        </div>
      )}
      {mutationsAllowed && !enableAllowed && (
        <div className="inline-alert info" role="note">
          Расписания можно редактировать, но вашей роли недоступны включение
          и ручной запуск автоматизаций.
        </div>
      )}

      <section className="panel automation-overview">
        <header className="security-card-header">
          <div>
            <h2>Автоматические съёмы</h2>
            <p>
              Включено {collection.enabledCount} из{" "}
              {collection.limit} по текущему тарифу.
            </p>
          </div>
          <div className="automation-actions">
            <button
              className="secondary-button"
              disabled={loading || anyBusy}
              onClick={() => setRetry((value) => value + 1)}
              type="button"
            >
              {loading ? "Обновляем…" : "Обновить"}
            </button>
            <button
              className="primary-button"
              disabled={
                !mutationsAllowed ||
                anyBusy ||
                activeContexts.length === 0
              }
              onClick={startCreate}
              type="button"
            >
              Новое расписание
            </button>
          </div>
        </header>
        {activeContexts.length === 0 && (
          <div className="inline-alert info" role="note">
            Сначала создайте активный контекст и назначьте ему запросы.
          </div>
        )}
        {collection.enabledCount >= collection.limit && (
          <div className="inline-alert warning" role="note">
            Лимит активных расписаний исчерпан. Приостановите одно из них или
            смените тариф.
          </div>
        )}
      </section>

      {editor && (
        <AutomationEditor
          contexts={activeContexts}
          editor={editor}
          canEnable={enableAllowed}
          errors={errors}
          onCancel={() => setEditor(undefined)}
          onChange={changeDraft}
          onSubmit={submit}
          saving={busyId === (editor.automation?.id ?? "create")}
        />
      )}

      {collection.automations.length === 0 ? (
        <section className="panel panel-empty">
          <span aria-hidden="true" className="state-icon">⌁</span>
          <strong>Расписаний пока нет</strong>
          <p>
            Создайте первое расписание или запускайте съём вручную из карточки
            контекста.
          </p>
        </section>
      ) : (
        <div className="automation-list">
          {collection.automations.map((automation) => (
            <AutomationCard
              automation={automation}
              busy={busyId === automation.id}
              canEnable={enableAllowed}
              canManage={mutationsAllowed}
              key={automation.id}
              onEdit={() => startEdit(automation)}
              onRun={() => void runNow(automation)}
              onStatus={(action) => void setEnabled(automation, action)}
              onToggleRuns={() => void toggleRuns(automation.id)}
              runs={runsByAutomation[automation.id]}
              runsLoading={runsLoading === automation.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AutomationEditor({
  contexts,
  editor,
  canEnable,
  errors,
  onCancel,
  onChange,
  onSubmit,
  saving
}: Readonly<{
  contexts: TrackingContextSettings["contexts"];
  editor: EditorState;
  canEnable: boolean;
  errors: RankAutomationDraftErrors;
  onCancel: () => void;
  onChange: (patch: Partial<RankAutomationDraft>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}>) {
  const draft = editor.draft;
  return (
    <form className="panel automation-editor" onSubmit={onSubmit}>
      <header className="security-card-header">
        <div>
          <h2>{editor.automation ? "Изменить расписание" : "Новое расписание"}</h2>
          <p>Время рассчитывается в выбранном часовом поясе.</p>
        </div>
      </header>
      <div className="automation-form-grid">
        <Field label="Название" error={errors.name} wide>
          <input
            aria-invalid={Boolean(errors.name)}
            maxLength={160}
            onChange={(event) => onChange({ name: event.target.value })}
            value={draft.name}
          />
        </Field>
        <Field label="Контекст" error={errors.trackingContextId} wide>
          <select
            aria-invalid={Boolean(errors.trackingContextId)}
            onChange={(event) =>
              onChange({ trackingContextId: event.target.value })
            }
            value={draft.trackingContextId}
          >
            {contexts.map((context) => (
              <option key={context.id} value={context.id}>
                {context.name} · {context.assignedKeywordCount} запросов
              </option>
            ))}
          </select>
        </Field>
        <Field label="Периодичность">
          <select
            onChange={(event) =>
              onChange({
                cadence: event.target.value as RankAutomationDraft["cadence"]
              })
            }
            value={draft.cadence}
          >
            <option value="DAILY">Каждый день</option>
            <option value="WEEKLY">По дням недели</option>
          </select>
        </Field>
        <Field label="Часовой пояс" error={errors.timezone}>
          <input
            aria-invalid={Boolean(errors.timezone)}
            maxLength={64}
            onChange={(event) => onChange({ timezone: event.target.value })}
            placeholder="Europe/Moscow"
            value={draft.timezone}
          />
        </Field>
        <Field label="Час" error={errors.time}>
          <input
            aria-invalid={Boolean(errors.time)}
            inputMode="numeric"
            max="23"
            min="0"
            onChange={(event) => onChange({ hour: event.target.value })}
            type="number"
            value={draft.hour}
          />
        </Field>
        <Field label="Минута" error={errors.time}>
          <input
            aria-invalid={Boolean(errors.time)}
            inputMode="numeric"
            max="59"
            min="0"
            onChange={(event) => onChange({ minute: event.target.value })}
            type="number"
            value={draft.minute}
          />
        </Field>
        {draft.cadence === "WEEKLY" && (
          <fieldset className="automation-weekdays">
            <legend>Дни недели</legend>
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(
              (label, index) => {
                const weekday = index + 1;
                return (
                  <label key={label}>
                    <input
                      checked={draft.weekdays.includes(weekday)}
                      onChange={(event) =>
                        onChange({
                          weekdays: event.target.checked
                            ? [...draft.weekdays, weekday]
                            : draft.weekdays.filter(
                                (value) => value !== weekday
                              )
                        })
                      }
                      type="checkbox"
                    />
                    {label}
                  </label>
                );
              }
            )}
            {errors.weekdays && <em>{errors.weekdays}</em>}
          </fieldset>
        )}
        <Field label="Максимум запросов за запуск" error={errors.maxItems}>
          <input
            aria-invalid={Boolean(errors.maxItems)}
            max="1000"
            min="1"
            onChange={(event) => onChange({ maxItems: event.target.value })}
            type="number"
            value={draft.maxItems}
          />
        </Field>
        <Field
          label="Автопауза после ошибок"
          error={errors.failureThreshold}
        >
          <input
            aria-invalid={Boolean(errors.failureThreshold)}
            max="10"
            min="1"
            onChange={(event) =>
              onChange({ failureThreshold: event.target.value })
            }
            type="number"
            value={draft.failureThreshold}
          />
        </Field>
        <label className="checkbox-field automation-enabled">
          <input
            checked={draft.enabled}
            disabled={!canEnable}
            onChange={(event) => onChange({ enabled: event.target.checked })}
            type="checkbox"
          />
          <span>
            <strong>Включить после сохранения</strong>
            <small>
              Система проверит тариф, доступ к проекту и источник данных.
            </small>
          </span>
        </label>
      </div>
      <footer className="automation-editor-actions">
        <button
          className="secondary-button"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Отмена
        </button>
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </footer>
    </form>
  );
}

function Field({
  children,
  error,
  label,
  wide = false
}: Readonly<{
  children: ReactNode;
  error?: string | undefined;
  label: string;
  wide?: boolean;
}>) {
  return (
    <label className={`automation-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
      {error && <em>{error}</em>}
    </label>
  );
}

function AutomationCard({
  automation,
  busy,
  canEnable,
  canManage,
  onEdit,
  onRun,
  onStatus,
  onToggleRuns,
  runs,
  runsLoading
}: Readonly<{
  automation: RankTrackingAutomationSummary;
  busy: boolean;
  canEnable: boolean;
  canManage: boolean;
  onEdit: () => void;
  onRun: () => void;
  onStatus: (action: "pause" | "resume") => void;
  onToggleRuns: () => void;
  runs: AutomationRunCollection | undefined;
  runsLoading: boolean;
}>) {
  return (
    <article className="panel automation-card">
      <header>
        <div>
          <div className="automation-title-row">
            <h2>{automation.name}</h2>
            <span
              className={`status-pill ${automation.enabled ? "success" : "neutral"}`}
            >
              {automation.enabled ? "Включено" : "На паузе"}
            </span>
          </div>
          <p>
            {rankAutomationScheduleLabel(
              automation.schedule,
              automation.timezone
            )}
          </p>
        </div>
        <div className="automation-actions">
          <button
            className="secondary-button"
            disabled={busy || !canEnable}
            onClick={onRun}
            type="button"
          >
            Запустить сейчас
          </button>
          <button
            className="secondary-button"
            disabled={busy || !canManage}
            onClick={onEdit}
            type="button"
          >
            Изменить
          </button>
          <button
            className="secondary-button"
            disabled={busy || !canEnable}
            onClick={() => onStatus(automation.enabled ? "pause" : "resume")}
            type="button"
          >
            {automation.enabled ? "Пауза" : "Включить"}
          </button>
        </div>
      </header>
      <dl className="automation-facts">
        <div>
          <dt>За запуск</dt>
          <dd>до {formatInteger(automation.maxItems)}</dd>
        </div>
        <div>
          <dt>Следующий запуск</dt>
          <dd>{formatDate(automation.nextRunAt)}</dd>
        </div>
        <div>
          <dt>Последний запуск</dt>
          <dd>{formatDate(automation.lastRunAt)}</dd>
        </div>
        <div>
          <dt>Ошибки подряд</dt>
          <dd>
            {automation.consecutiveErrors} / {automation.failureThreshold}
          </dd>
        </div>
      </dl>
      {automation.pausedReason === "FAILURE_THRESHOLD" && (
        <div className="inline-alert warning" role="alert">
          Расписание автоматически приостановлено после повторных ошибок.
          Проверьте API-ключ и контекст перед включением.
        </div>
      )}
      <button
        className="automation-runs-toggle"
        disabled={runsLoading}
        onClick={onToggleRuns}
        type="button"
      >
        {runsLoading
          ? "Загружаем…"
          : runs
            ? "Скрыть историю"
            : "Показать историю запусков"}
      </button>
      {runs && <AutomationRuns runs={runs} />}
    </article>
  );
}

function AutomationRuns({
  runs
}: Readonly<{ runs: AutomationRunCollection }>) {
  if (runs.runs.length === 0) {
    return <p className="automation-runs-empty">Запусков ещё не было.</p>;
  }
  return (
    <div className="automation-runs">
      {runs.runs.map((run) => (
        <div className="automation-run-row" key={run.id}>
          <span className={`run-status ${run.status.toLowerCase()}`}>
            {automationRunStatusLabel(run.status)}
          </span>
          <span>{run.trigger === "MANUAL" ? "Вручную" : "По расписанию"}</span>
          <time dateTime={run.scheduledFor}>{formatDate(run.scheduledFor)}</time>
          <span title={run.jobId}>
            {run.jobId
              ? `Job ${run.jobId.slice(0, 8)}`
              : run.errorCode ?? "—"}
          </span>
        </div>
      ))}
      {runs.truncated && (
        <small>Показаны последние 50 запусков.</small>
      )}
    </div>
  );
}

function withAutomation(
  collection: RankTrackingAutomationSettings,
  automation: RankTrackingAutomationSummary
): RankTrackingAutomationSettings {
  const found = collection.automations.some(({ id }) => id === automation.id);
  const automations = found
    ? collection.automations.map((item) =>
        item.id === automation.id ? automation : item
      )
    : [automation, ...collection.automations];
  return {
    ...collection,
    automations,
    enabledCount: automations.filter(({ enabled }) => enabled).length
  };
}

function prependRun(
  current: AutomationRunCollection | undefined,
  run: AutomationRunSummary
): AutomationRunCollection {
  const withoutReplay =
    current?.runs.filter(({ id }) => id !== run.id) ?? [];
  return {
    runs: [run, ...withoutReplay].slice(0, 50),
    truncated: current?.truncated ?? false
  };
}

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function mutationRestriction(
  online: boolean,
  collection: RankTrackingAutomationSettings
): string {
  if (!online) return "Изменения отключены до восстановления соединения.";
  if (collection.access.mutationRestriction === "WORKSPACE_READ_ONLY") {
    return "Workspace доступен только для чтения; расписания не изменяются.";
  }
  if (collection.access.mutationRestriction === "PROJECT_ARCHIVED") {
    return "Архивный проект доступен только для просмотра.";
  }
  if (collection.access.mutationRestriction === "MISSING_PERMISSION") {
    return "У вашей роли недостаточно прав для изменения автоматизаций.";
  }
  if (!collection.access.canManage) {
    return "У вашей роли нет права изменять расписания.";
  }
  return "";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "QUOTA_EXCEEDED") {
      return "Лимит активных расписаний по тарифу исчерпан.";
    }
    if (error.code === "VERSION_CONFLICT") {
      return "Расписание уже изменено в другой вкладке. Данные обновлены.";
    }
    if (error.status === 403) {
      return "У вашей роли недостаточно прав для этого действия.";
    }
    return `${error.message}${error.requestId ? ` Код запроса: ${error.requestId}.` : ""}`;
  }
  return fallback;
}

function isVersionConflict(error: unknown): boolean {
  return (
    error instanceof BrowserApiError &&
    error.code === "VERSION_CONFLICT"
  );
}
