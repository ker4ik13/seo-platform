"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RankTrackingAutomationSettings,
  RankTrackingAutomationSummary,
  TrackingContextSettings
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import {
  microToRubles,
  positiveMoneyMicro
} from "../lib/rank-automation-money";
import { trackingContextDisplayName } from "../lib/tracking-contexts";
import { CustomSelect } from "./custom-select";
import styles from "./rank-automation-panel.module.css";
import { UiText, useUiLocale } from "./ui-locale";


type Cadence = "ONCE" | "DAILY" | "WEEKLY";

interface Draft {
  readonly name: string;
  readonly trackingContextId: string;
  readonly cadence: Cadence;
  readonly time: string;
  readonly runAt: string;
  readonly weekdays: readonly number[];
  readonly allowPlatformPaid: boolean;
  readonly maxPlatformChargeRubles: string;
  readonly failureThreshold: string;
  readonly enabled: boolean;
}

export function RankAutomationPanel({
  projectId
}: Readonly<{ projectId: string }>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [settings, setSettings] = useState<RankTrackingAutomationSettings>();
  const [contexts, setContexts] = useState<TrackingContextSettings>();
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<Draft>(() => newDraft());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [browserTimezone, setBrowserTimezone] = useState("");
  const [minimumRunAtValue, setMinimumRunAtValue] = useState("");
  const path = `/app/api/projects/${encodeURIComponent(projectId)}/automations`;
  const activeContexts = useMemo(
    () => contexts?.contexts.filter(({ status }) => status === "ACTIVE") ?? [],
    [contexts]
  );
  const editing = settings?.automations.find(({ id }) => id === editingId);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const options = signal ? { signal } : {};
      const [automationSettings, contextSettings] = await Promise.all([
        browserApiRequest<RankTrackingAutomationSettings>(path, options),
        browserApiRequest<TrackingContextSettings>(
          `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts`,
          options
        )
      ]);
      if (signal?.aborted) return;
      setSettings(automationSettings);
      setContexts(contextSettings);
      setDraft((current) => ({
        ...current,
        trackingContextId:
          current.trackingContextId ||
          contextSettings.contexts.find(({ status }) => status === "ACTIVE")?.id ||
          ""
      }));
      setError(undefined);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(message(caught, "Не удалось загрузить расписания."));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [path, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    setBrowserTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setMinimumRunAtValue(minimumRunAt());
    setDraft((current) =>
      current.runAt ? current : { ...current, runAt: defaultRunAt() }
    );
  }, []);

  const failureThreshold = Number(draft.failureThreshold);
  const runAtTimestamp = Date.parse(draft.runAt);
  const recurringTimeValid = /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(
    draft.time
  );
  const invalid =
    !draft.name.trim() ||
    !draft.trackingContextId ||
    (draft.cadence === "WEEKLY" && draft.weekdays.length === 0) ||
    (draft.cadence === "ONCE" &&
      (!Number.isFinite(runAtTimestamp) ||
        runAtTimestamp < Date.now() + 30_000)) ||
    (draft.cadence !== "ONCE" && !recurringTimeValid) ||
    (draft.allowPlatformPaid &&
      !positiveMoneyMicro(draft.maxPlatformChargeRubles)) ||
    !Number.isSafeInteger(failureThreshold) ||
    failureThreshold < 1 ||
    failureThreshold > 10;

  async function save(): Promise<void> {
    if (busy || invalid || !settings?.access.canManage) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const body = {
        name: draft.name.trim(),
        trackingContextId: draft.trackingContextId,
        timezone:
          browserTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        schedule: scheduleInput(draft),
        maxPlatformChargeMicro: draft.allowPlatformPaid
          ? positiveMoneyMicro(draft.maxPlatformChargeRubles)!
          : "0",
        failureThreshold: Number(draft.failureThreshold),
        enabled: settings.access.canEnable && draft.enabled
      };
      if (editing) {
        await browserApiRequest<RankTrackingAutomationSummary>(
          `${path}/${encodeURIComponent(editing.id)}`,
          { method: "PATCH", ifMatch: editing.version, body }
        );
        setNotice("Расписание обновлено.");
      } else {
        await browserApiRequest<RankTrackingAutomationSummary>(path, {
          method: "POST",
          idempotencyKey: `rank-automation:${globalThis.crypto.randomUUID()}`,
          body
        });
        setNotice(
          draft.cadence === "ONCE"
            ? "Отложенный съём запланирован."
            : "Регулярный съём создан."
        );
      }
      setEditingId(undefined);
      setDraft(newDraft(activeContexts[0]?.id, defaultRunAt()));
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось сохранить расписание."));
    } finally {
      setBusy(false);
    }
  }

  async function action(
    automation: RankTrackingAutomationSummary,
    operation: "pause" | "resume" | "runs"
  ): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await browserApiRequest(
        `${path}/${encodeURIComponent(automation.id)}/${operation}`,
        {
          method: "POST",
          body: {},
          ifMatch: automation.version,
          ...(operation === "runs"
            ? {
                idempotencyKey: `rank-automation-run:${globalThis.crypto.randomUUID()}`
              }
            : {})
        }
      );
      setNotice(
        operation === "runs"
          ? "Ручной съём создан."
          : operation === "pause"
            ? "Расписание поставлено на паузу."
            : "Расписание возобновлено."
      );
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось изменить расписание."));
    } finally {
      setBusy(false);
    }
  }

  function edit(automation: RankTrackingAutomationSummary): void {
    const schedule = automation.schedule;
    setEditingId(automation.id);
    setDraft({
      name: automation.name,
      trackingContextId: automation.trackingContextId,
      cadence: schedule.cadence,
      time:
        schedule.cadence === "ONCE"
          ? "06:00"
          : `${pad(schedule.hour)}:${pad(schedule.minute)}`,
      runAt:
        schedule.cadence === "ONCE"
          ? automation.pausedReason === undefined && Date.parse(schedule.runAt) > Date.now()
            ? isoToLocal(schedule.runAt)
            : defaultRunAt()
          : defaultRunAt(),
      weekdays: schedule.cadence === "WEEKLY" ? schedule.weekdays : [1],
      allowPlatformPaid: automation.maxPlatformChargeMicro !== "0",
      maxPlatformChargeRubles:
        automation.maxPlatformChargeMicro === "0"
          ? "100"
          : microToRubles(automation.maxPlatformChargeMicro),
      failureThreshold: String(automation.failureThreshold),
      enabled:
        automation.enabled || automation.pausedReason === "ONE_TIME_COMPLETED"
    });
    setError(undefined);
    setNotice(undefined);
  }

  return (
    <section className={`${styles.panel} panel`}>
      <header className={styles.header}>
        <div>
          <span><UiText text="Автоматизация" /></span>
          <h2><UiText text="Регулярные и отложенные съёмы" /></h2>
          <p>
            <UiText text="Выберите сохранённый контекст: один запуск выполнится в указанную дату, регулярный — ежедневно или по дням недели." /></p>
        </div>
        {settings && (
          <span
            className={styles.counter}
            title={uiText("Лимит тарифа на включённые расписания в рабочей области")}
          >
            {settings.enabledCount} <UiText text="из" before=" " after=" " />{settings.limit} <UiText text="активных расписаний" before=" " /></span>
        )}
      </header>

      {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
      {notice && <div className="inline-alert success" role="status">{<UiText text={notice ?? ""} />}</div>}

      {loading && !settings ? (
        <p><UiText text="Загружаем расписания…" /></p>
      ) : activeContexts.length === 0 ? (
        <div className="inline-alert info">
          <UiText text="Сначала создайте активный контекст съёма ниже на этой странице." /></div>
      ) : (
        <div className={styles.form}>
          <label className={styles.wide}>
            <span><UiText text="Название" /></span>
            <input
              maxLength={160}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder={uiText("Например, Еженедельный съём")}
              value={draft.name}
            />
          </label>
          <label>
            <span><UiText text="Контекст" /></span>
            <CustomSelect
              onChange={(event) =>
                setDraft({ ...draft, trackingContextId: event.target.value })
              }
              value={draft.trackingContextId}
            >
              {activeContexts.map((context) => (
                <option key={context.id} value={context.id}>{trackingContextDisplayName(context)}</option>
              ))}
            </CustomSelect>
          </label>
          <label>
            <span><UiText text="Тип запуска" /></span>
            <CustomSelect
              onChange={(event) =>
                setDraft({ ...draft, cadence: event.target.value as Cadence })
              }
              value={draft.cadence}
            >
              <option value="ONCE"><UiText text="Один раз позже" /></option>
              <option value="DAILY"><UiText text="Каждый день" /></option>
              <option value="WEEKLY"><UiText text="По дням недели" /></option>
            </CustomSelect>
          </label>
          {draft.cadence === "ONCE" ? (
            <label className={styles.wide}>
              <span><UiText text="Дата и время запуска" /></span>
              <input
                min={minimumRunAtValue || undefined}
                onChange={(event) => setDraft({ ...draft, runAt: event.target.value })}
                type="datetime-local"
                value={draft.runAt}
              />
              <small>
                <UiText text="Часовой пояс браузера:" after=" " />{browserTimezone || <UiText text="определяем…" />}
              </small>
            </label>
          ) : (
            <label>
              <span><UiText text="Время запуска" /></span>
              <input
                onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                type="time"
                value={draft.time}
              />
            </label>
          )}
          {draft.cadence === "WEEKLY" && (
            <fieldset className={styles.weekdays}>
              <legend><UiText text="Дни недели" /></legend>
              {dayNames.map((label, index) => {
                const day = index + 1;
                return (
                  <label key={day}>
                    <input
                      checked={draft.weekdays.includes(day)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          weekdays: toggleDay(draft.weekdays, day)
                        })
                      }
                      type="checkbox"
                    />
                    {label}
                  </label>
                );
              })}
            </fieldset>
          )}
          <label>
            <span><UiText text="Пауза после ошибок" /></span>
            <input
              max={10}
              min={1}
              onChange={(event) =>
                setDraft({ ...draft, failureThreshold: event.target.value })
              }
              type="number"
              value={draft.failureThreshold}
            />
          </label>
          <label className={styles.enabled}>
            <input
              checked={draft.allowPlatformPaid}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  allowPlatformPaid: event.target.checked
                })
              }
              type="checkbox"
            />
            <span>
              <strong><UiText text="Разрешить внутренние токены" /></strong>
              <small>
                <UiText text="Перед каждым запуском цена и баланс проверяются заново; выше заданного лимита съём не начнётся." /></small>
            </span>
          </label>
          {draft.allowPlatformPaid && (
            <label>
              <span><UiText text="Лимит списания за запуск, ₽" /></span>
              <input
                min="0.000001"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    maxPlatformChargeRubles: event.target.value
                  })
                }
                step="0.000001"
                type="number"
                value={draft.maxPlatformChargeRubles}
              />
            </label>
          )}
          <label className={styles.enabled}>
            <input
              checked={draft.enabled}
              disabled={!settings?.access.canEnable}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              type="checkbox"
            />
            <span>
              <strong><UiText text="Активировать сразу" /></strong>
              <small><UiText text="Запуск не пересечётся с уже активным заданием этого расписания" /></small>
            </span>
          </label>
          <div className={styles.formActions}>
            <button
              className="primary-button"
              disabled={busy || invalid || !settings?.access.canManage}
              onClick={() => void save()}
              type="button"
            >
              {busy ? <UiText text="Сохраняем…" /> : editing ? <UiText text="Сохранить" /> : <UiText text="Запланировать" />}
            </button>
            {editing && (
              <button
                className="secondary-button"
                onClick={() => {
                  setEditingId(undefined);
                  setDraft(newDraft(activeContexts[0]?.id, defaultRunAt()));
                }}
                type="button"
              >
                <UiText text="Отмена" /></button>
            )}
          </div>
        </div>
      )}

      {settings?.automations.length ? (
        <div className={styles.list}>
          {settings.automations.map((automation) => (
            <article key={automation.id}>
              <div className={styles.itemHead}>
                <div>
                  <strong>{automation.name}</strong>
                  <span>{<UiText text={scheduleLabel(automation, uiLocale) ?? ""} />}</span>
                </div>
                <span className={automation.enabled ? styles.active : styles.inactive}>
                  {automation.enabled
                    ? <UiText text="Активно" />
                    : automation.pausedReason === "ONE_TIME_COMPLETED"
                      ? <UiText text="Выполнено" />
                      : <UiText text="На паузе" />}
                </span>
              </div>
              <p>
                {automation.nextRunAt
                  ? <UiText text="Следующий запуск: {0}" values={[String(dateLabel(automation.nextRunAt, uiLocale))]} />
                  : automation.lastRunAt
                    ? <UiText text="Последний запуск: {0}" values={[String(dateLabel(automation.lastRunAt, uiLocale))]} />
                    : <UiText text="Запусков ещё не было" />}
                {automation.consecutiveErrors
                  ? <UiText text="· ошибок подряд: {0}" values={[String(automation.consecutiveErrors)]} before=" " />
                  : ""}
                {automation.maxPlatformChargeMicro === "0"
                  ? <UiText text="· только свои ключи" before=" " />
                  : <UiText text="· до {0} ₽ внутренних токенов" values={[String(microToRubles(automation.maxPlatformChargeMicro))]} before=" " />}
              </p>
              <div className={styles.itemActions}>
                <button className="text-button" disabled={busy} onClick={() => edit(automation)} type="button">
                  {automation.pausedReason === "ONE_TIME_COMPLETED" ? <UiText text="Запланировать снова" /> : <UiText text="Изменить" />}
                </button>
                <button
                  className="text-button"
                  disabled={busy || !settings.access.canEnable}
                  onClick={() => void action(automation, "runs")}
                  type="button"
                >
                  <UiText text="Запустить сейчас" /></button>
                {automation.pausedReason !== "ONE_TIME_COMPLETED" && (
                  <button
                    className="text-button"
                    disabled={busy || !settings.access.canEnable}
                    onClick={() =>
                      void action(automation, automation.enabled ? "pause" : "resume")
                    }
                    type="button"
                  >
                    {automation.enabled ? <UiText text="Пауза" /> : <UiText text="Возобновить" />}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        !loading && <p className={styles.empty}><UiText text="Расписаний пока нет." /></p>
      )}
    </section>
  );
}

const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

function newDraft(trackingContextId = "", runAt = ""): Draft {
  return {
    name: "",
    trackingContextId,
    cadence: "ONCE",
    time: "06:00",
    runAt,
    weekdays: [1],
    allowPlatformPaid: false,
    maxPlatformChargeRubles: "100",
    failureThreshold: "3",
    enabled: true
  };
}

function scheduleInput(draft: Draft) {
  if (draft.cadence === "ONCE") {
    return { cadence: "ONCE" as const, runAt: new Date(draft.runAt).toISOString() };
  }
  const [hour, minute] = draft.time.split(":").map(Number);
  return draft.cadence === "DAILY"
    ? { cadence: "DAILY" as const, hour, minute }
    : { cadence: "WEEKLY" as const, hour, minute, weekdays: draft.weekdays };
}

function scheduleLabel(automation: RankTrackingAutomationSummary, uiLocale: string = "ru-RU"): string {
  const schedule = automation.schedule;
  if (schedule.cadence === "ONCE") return `один раз · ${dateLabel(schedule.runAt, uiLocale)}`;
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)}`;
  if (schedule.cadence === "DAILY") return `ежедневно в ${time}`;
  return `${schedule.weekdays.map((day) => dayNames[day - 1]).join(", ")} в ${time}`;
}

function toggleDay(days: readonly number[], day: number): readonly number[] {
  return days.includes(day)
    ? days.filter((value) => value !== day)
    : [...days, day].sort((left, right) => left - right);
}

function defaultRunAt(): string {
  const value = new Date(Date.now() + 60 * 60 * 1_000);
  value.setSeconds(0, 0);
  return isoToLocal(value.toISOString());
}

function minimumRunAt(): string {
  return isoToLocal(new Date(Date.now() + 60_000).toISOString());
}

function isoToLocal(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dateLabel(value: string, uiLocale: string = "ru-RU"): string {
  return new Date(value).toLocaleString(uiLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function message(error: unknown, fallback: string): string {
  return error instanceof BrowserApiError ? error.message : fallback;
}
