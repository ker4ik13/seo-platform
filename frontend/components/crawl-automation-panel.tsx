"use client";

import { CustomDateInput } from "./custom-date-input";
import { CustomSelect } from "./custom-select";

import type {
  CrawlAutomationSettings,
  CrawlAutomationSummary
} from "@seo-platform/contracts";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { UiText, useUiLocale } from "./ui-locale";


export function CrawlAutomationPanel({
  projectId,
  defaultStartUrl
}: Readonly<{ projectId: string; defaultStartUrl: string }>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [settings, setSettings] = useState<CrawlAutomationSettings>();
  const [name, setName] = useState("Регулярный технический аудит");
  const [startUrl, setStartUrl] = useState(defaultStartUrl);
  const [cadence, setCadence] = useState<"DAILY" | "WEEKLY">("WEEKLY");
  const [weekdays, setWeekdays] = useState<readonly number[]>([1]);
  const [time, setTime] = useState("06:00");
  const [windowStart, setWindowStart] = useState("06:00");
  const [windowEnd, setWindowEnd] = useState("23:00");
  const [maxUrls, setMaxUrls] = useState("100");
  const [maxDepth, setMaxDepth] = useState("3");
  const [maxRuntimeMinutes, setMaxRuntimeMinutes] = useState("60");
  const [rpm, setRpm] = useState("30");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setSettings(
        await browserApiRequest<CrawlAutomationSettings>(
          automationPath(projectId),
          signal ? { signal } : {}
        )
      );
      setError(undefined);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(message(caught, "Не удалось загрузить расписания."));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!settings?.access.canManage || busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const [hour, minute] = clockParts(time);
      await browserApiRequest<CrawlAutomationSummary>(
        automationPath(projectId),
        {
          method: "POST",
          idempotencyKey: `crawl-automation:${globalThis.crypto.randomUUID()}`,
          body: {
            name,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            schedule:
              cadence === "DAILY"
                ? { cadence: "DAILY", hour, minute }
                : { cadence: "WEEKLY", hour, minute, weekdays },
            allowedWindow: {
              startMinute: clockMinute(windowStart),
              endMinute: clockMinute(windowEnd, true)
            },
            config: {
              startUrls: [startUrl.trim()],
              sitemapUrls: [],
              includePatterns: [],
              excludePatterns: [],
              queryPolicy: "DROP_TRACKING",
              maxUrls: Number(maxUrls),
              maxDepth: Number(maxDepth),
              maxRuntimeSeconds: Number(maxRuntimeMinutes) * 60,
              requestsPerMinute: Number(rpm),
              obeyRobots: true
            },
            failureThreshold: 3,
            enabled: settings.access.canEnable
          }
        }
      );
      setNotice("Расписание создано.");
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось создать расписание."));
    } finally {
      setBusy(false);
    }
  }

  async function action(
    automation: CrawlAutomationSummary,
    operation: "pause" | "resume" | "runs"
  ): Promise<void> {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await browserApiRequest(
        `${automationPath(projectId)}/${encodeURIComponent(
          automation.id
        )}/${operation}`,
        {
          method: "POST",
          body: {},
          ifMatch: automation.version,
          ...(operation === "runs"
            ? {
                idempotencyKey: `crawl-automation-run:${globalThis.crypto.randomUUID()}`
              }
            : {})
        }
      );
      setNotice(
        operation === "runs"
          ? "Ручной запуск создан."
          : operation === "pause"
            ? "Расписание приостановлено."
            : "Расписание возобновлено."
      );
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось изменить расписание."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="crawl-radar-panel">
      <summary>
        <span className="crawl-radar-icon" aria-hidden="true">R</span>
        <span>
          <strong><UiText text="Автоматический Radar" /></strong>
          <small>{settings?.automations.length ? <UiText text="{0} активных из {1}" values={[String(settings.automations.filter(({ enabled }) => enabled).length), String(settings.automations.length)]} /> : <UiText text="Регулярные проверки по расписанию" />}</small>
        </span>
        <span className="crawl-radar-action"><UiText text="Настроить" /></span>
      </summary>
      <div className="crawl-radar-body">
        <p className="muted-copy">
          <UiText text="Запуски не пересекаются и автоматически ставятся на паузу после трёх ошибок." /></p>
      {error && <div className="inline-error" role="alert">{<UiText text={error ?? ""} />}</div>}
      {notice && <div className="inline-success" role="status">{<UiText text={notice ?? ""} />}</div>}
      {loading && !settings ? (
        <p className="muted-copy"><UiText text="Загружаем расписания…" /></p>
      ) : (
        <form className="crawl-audit-form" onSubmit={create}>
          <label className="form-field crawl-audit-url">
            <span><UiText text="Название" /></span>
            <input
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label className="form-field crawl-audit-url">
            <span><UiText text="Стартовый URL" /></span>
            <input
              onChange={(event) => setStartUrl(event.target.value)}
              required
              type="url"
              value={startUrl}
            />
          </label>
          <label className="form-field">
            <span><UiText text="Периодичность" /></span>
            <CustomSelect
              onChange={(event) =>
                setCadence(event.target.value as "DAILY" | "WEEKLY")
              }
              value={cadence}
            >
              <option value="DAILY"><UiText text="Ежедневно" /></option>
              <option value="WEEKLY"><UiText text="По дням недели" /></option>
            </CustomSelect>
          </label>
          <label className="form-field">
            <span><UiText text="Время запуска" /></span>
            <CustomDateInput
              onChange={(event) => setTime(event.target.value)}
              required
              type="time"
              value={time}
            />
          </label>
          <label className="form-field">
            <span><UiText text="Окно с" /></span>
            <CustomDateInput
              onChange={(event) => setWindowStart(event.target.value)}
              required
              type="time"
              value={windowStart}
            />
          </label>
          <label className="form-field">
            <span><UiText text="Окно до" /></span>
            <CustomDateInput
              onChange={(event) => setWindowEnd(event.target.value)}
              required
              type="time"
              value={windowEnd}
            />
          </label>
          {cadence === "WEEKLY" && (
            <fieldset className="form-field crawl-audit-scope">
              <legend><UiText text="Дни недели" /></legend>
              <div className="crawl-weekdays">
                {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(
                  (label, index) => {
                    const day = index + 1;
                    return (
                      <label key={day}>
                        <input
                          checked={weekdays.includes(day)}
                          onChange={() =>
                            setWeekdays((current) =>
                              current.includes(day)
                                ? current.filter((value) => value !== day)
                                : [...current, day].sort()
                            )
                          }
                          type="checkbox"
                        />
                        {label}
                      </label>
                    );
                  }
                )}
              </div>
            </fieldset>
          )}
          <NumberField label={uiText("Лимит URL")} max={5000} min={1} set={setMaxUrls} value={maxUrls} />
          <NumberField label={uiText("Глубина")} max={10} min={0} set={setMaxDepth} value={maxDepth} />
          <NumberField label={uiText("Макс. время, мин")} max={360} min={1} set={setMaxRuntimeMinutes} value={maxRuntimeMinutes} />
          <NumberField label={uiText("Запросов/мин")} max={60} min={1} set={setRpm} value={rpm} />
          <button
            className="primary-button"
            disabled={
              busy ||
              settings?.access.canManage !== true ||
              (cadence === "WEEKLY" && weekdays.length === 0)
            }
            type="submit"
          >
            {busy ? <UiText text="Подождите…" /> : <UiText text="Создать расписание" />}
          </button>
        </form>
      )}
      {settings?.automations.length ? (
        <div className="crawl-run-list">
          {settings.automations.map((automation) => (
            <article className="crawl-run" key={automation.id}>
              <div>
                <strong>{automation.name}</strong>
                <span>
                  {automation.enabled ? <UiText text="Активно" /> : <UiText text="На паузе" />} ·{" "}
                  {<UiText text={scheduleLabel(automation) ?? ""} />}
                </span>
              </div>
              <p>
                <UiText text="Следующий запуск:" />{" "}
                {automation.nextRunAt
                  ? new Date(automation.nextRunAt).toLocaleString(uiLocale)
                  : <UiText text="не запланирован" />}
                {automation.consecutiveErrors > 0
                  ? <UiText text="· ошибок подряд: {0}" values={[String(automation.consecutiveErrors)]} before=" " />
                  : ""}
              </p>
              <div>
                <button
                  className="text-button"
                  disabled={busy || !settings.access.canEnable}
                  onClick={() => void action(automation, "runs")}
                  type="button"
                >
                  <UiText text="Запустить сейчас" /></button>
                <button
                  className="text-button"
                  disabled={busy || !settings.access.canEnable}
                  onClick={() =>
                    void action(
                      automation,
                      automation.enabled ? "pause" : "resume"
                    )
                  }
                  type="button"
                >
                  {automation.enabled ? <UiText text="Пауза" /> : <UiText text="Возобновить" />}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        !loading && <p className="muted-copy"><UiText text="Расписания ещё не созданы." /></p>
      )}
      </div>
    </details>
  );
}

function NumberField({
  label,
  min,
  max,
  value,
  set
}: Readonly<{
  label: string;
  min: number;
  max: number;
  value: string;
  set: (value: string) => void;
}>) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => set(event.target.value)}
        required
        type="number"
        value={value}
      />
    </label>
  );
}

function automationPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(
    projectId
  )}/crawl-automations`;
}

function clockParts(value: string): readonly [number, number] {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) throw new Error("Invalid clock value");
  return [Number(match[1]), Number(match[2])];
}

function clockMinute(value: string, allowMidnight = false): number {
  const [hour, minute] = clockParts(value);
  if (allowMidnight && hour === 0 && minute === 0) return 1_440;
  return hour * 60 + minute;
}

function scheduleLabel(automation: CrawlAutomationSummary): string {
  const time = `${String(automation.schedule.hour).padStart(2, "0")}:${String(
    automation.schedule.minute
  ).padStart(2, "0")}`;
  if (automation.schedule.cadence === "DAILY") {
    return `ежедневно в ${time}`;
  }
  const names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  return `${automation.schedule.weekdays
    .map((day) => names[day - 1])
    .join(", ")} в ${time}`;
}

function message(error: unknown, fallback: string): string {
  return error instanceof BrowserApiError ? error.message : fallback;
}
