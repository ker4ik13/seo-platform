"use client";

import { CustomSelect } from "./custom-select";

import { useEffect, useMemo, useState } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { BrowserPushSettings } from "./browser-push-settings";
import { UiText, useUiLocale } from "./ui-locale";
import { TimezoneSelect } from "./locale-selects";


export type NotificationChannel = "IN_APP" | "EMAIL" | "WEB_PUSH";
export type NotificationEventType =
  | "ASSIGNMENT"
  | "MENTION"
  | "SEMANTIC_IMPORT"
  | "RANK_TRACKING"
  | "FREQUENCY_COLLECTION"
  | "SERP_COLLECTION"
  | "CLUSTERING"
  | "CRAWL_RADAR"
  | "SITEMAP"
  | "MAGNET"
  | "AUTOMATION"
  | "INTEGRATION"
  | "JOB"
  | "REPORT"
  | "SECURITY"
  | "BILLING"
  | "PRODUCT";
export type DeliveryMode =
  | "INSTANT"
  | "HOURLY_DIGEST"
  | "DAILY_DIGEST";

export interface NotificationRule {
  readonly eventType: NotificationEventType;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly minimumSeverity: "INFO" | "WARNING" | "CRITICAL";
  readonly deliveryMode: DeliveryMode;
}

interface NotificationPreferences {
  readonly userId: string;
  readonly channels: {
    readonly inApp: boolean;
    readonly email: boolean;
    readonly webPush: boolean;
  };
  readonly timezone: string;
  readonly quietHours?: {
    readonly start: string;
    readonly end: string;
    readonly criticalBypass: boolean;
  };
  readonly digestTime: string;
  readonly rules: readonly NotificationRule[];
  readonly version: number;
  readonly updatedAt: string;
}

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "IN_APP",
  "EMAIL",
  "WEB_PUSH"
];

export function NotificationSettings({
  email,
  emailVerified,
  projectId
}: Readonly<{
  email: string;
  emailVerified: boolean;
  projectId?: string;
}>) {
  const { t: uiText } = useUiLocale();
  const [settings, setSettings] = useState<NotificationPreferences>();
  const [draft, setDraft] = useState<NotificationPreferences>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void browserApiRequest<NotificationPreferences>(
      "/app/api/me/notification-preferences",
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setSettings(result);
        setDraft(result);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(notificationErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retryVersion]);

  const dirty = useMemo(
    () =>
      Boolean(
        settings &&
          draft &&
          JSON.stringify(settings) !== JSON.stringify(draft)
      ),
    [draft, settings]
  );

  function updateChannel(
    channel: keyof NotificationPreferences["channels"],
    enabled: boolean
  ): void {
    setSaved(false);
    setDraft((current) =>
      current
        ? {
            ...current,
            channels: { ...current.channels, [channel]: enabled }
          }
        : current
    );
  }

  function updateRule(
    eventType: NotificationEventType,
    channel: NotificationChannel,
    change: Partial<NotificationRule>
  ): void {
    setSaved(false);
    setDraft((current) =>
      current
        ? {
            ...current,
            rules: current.rules.map((rule) =>
              rule.eventType === eventType && rule.channel === channel
                ? { ...rule, ...change }
                : rule
            )
          }
        : current
    );
  }

  function toggleQuietHours(enabled: boolean): void {
    setSaved(false);
    setDraft((current) => {
      if (!current) return current;
      if (enabled) {
        return {
          ...current,
          quietHours: {
            start: "23:00",
            end: "08:00",
            criticalBypass: true
          }
        };
      }
      const { quietHours: _quietHours, ...withoutQuietHours } = current;
      return withoutQuietHours;
    });
  }

  async function save(): Promise<void> {
    if (!draft || saving) return;
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      const result = await browserApiRequest<NotificationPreferences>(
        "/app/api/me/notification-preferences",
        {
          method: "PATCH",
          ifMatch: draft.version,
          body: {
            channels: draft.channels,
            timezone: draft.timezone,
            ...(draft.quietHours
              ? { quietHours: draft.quietHours }
              : {}),
            digestTime: draft.digestTime,
            rules: draft.rules
          }
        }
      );
      setSettings(result);
      setDraft(result);
      setSaved(true);
    } catch (requestError) {
      setError(notificationErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="panel notification-settings-loading" aria-busy="true">
        <span className="spinner" />
        <p><UiText text="Загружаем настройки уведомлений…" /></p>
      </section>
    );
  }
  if (!draft) {
    return (
      <section className="panel panel-empty compact">
        <strong><UiText text="Настройки уведомлений недоступны" /></strong>
        <p>{error ?? <UiText text="Попробуйте загрузить их ещё раз." />}</p>
        <button
          className="secondary-button"
          onClick={() => setRetryVersion((value) => value + 1)}
          type="button"
        >
          <UiText text="Повторить" /></button>
      </section>
    );
  }

  const events = uniqueEvents(draft.rules);
  return (
    <div className="notification-settings-stack">
      {error && (
        <div className="inline-alert danger" role="alert">
          {<UiText text={error ?? ""} />}
        </div>
      )}
      {saved && (
        <div className="inline-alert success" role="status">
          <UiText text="Настройки сохранены" /></div>
      )}

      <section className="panel notification-card">
        <header className="security-card-header">
          <div>
            <h2><UiText text="Каналы" /></h2>
            <p>
              <UiText text="Глобальный запрет нельзя обойти настройкой отдельного проекта." /></p>
          </div>
        </header>
        <div className="notification-channel-grid">
          <ChannelSwitch
            checked={draft.channels.inApp}
            description={uiText("Центр уведомлений внутри приложения")}
            label={uiText("В приложении")}
            onChange={(checked) => updateChannel("inApp", checked)}
          />
          <ChannelSwitch
            checked={draft.channels.email}
            description={uiText("Мгновенные письма или дайджест")}
            label="Email"
            onChange={(checked) => updateChannel("email", checked)}
          />
          <ChannelSwitch
            checked={draft.channels.webPush}
            description={uiText("Глобальный доступ для всех зарегистрированных браузеров")}
            label="Browser Push"
            onChange={(checked) => updateChannel("webPush", checked)}
          />
        </div>
        <div
          className={`notification-email-status ${emailVerified ? "verified" : "unverified"}`}
        >
          <span>
            <strong>{email}</strong>
            <small>
              {emailVerified
                ? <UiText text="Email подтверждён и может получать разрешённые доставки." />
                : <UiText text="Email не подтверждён — письма отправляться не будут." />}
            </small>
          </span>
          {!emailVerified && (
            <a
              className="text-button"
              href={`/app/verify-email?email=${encodeURIComponent(email)}`}
            >
              <UiText text="Подтвердить" /></a>
          )}
        </div>
        <p className="notification-hint">
          <UiText text="Master-переключатель относится ко всему профилю и не зависит от разрешения текущего браузера. Проектные правила не могут обойти этот глобальный запрет." /></p>
        <BrowserPushSettings
          userId={draft.userId}
          webPushEnabled={draft.channels.webPush}
        />
      </section>

      <section className="panel notification-card">
        <header className="security-card-header">
          <div>
            <h2><UiText text="Время доставки" /></h2>
            <p><UiText text="Timezone применяется к quiet hours и ежедневному дайджесту." /></p>
          </div>
        </header>
        <div className="notification-time-grid">
          <label className="form-field">
            <span>Timezone</span>
            <TimezoneSelect
              onChange={(event) => {
                setSaved(false);
                setDraft({ ...draft, timezone: event.target.value });
              }}
              value={draft.timezone}
            />
          </label>
          <label className="form-field">
            <span><UiText text="Время дневного дайджеста" /></span>
            <input
              onChange={(event) => {
                setSaved(false);
                setDraft({ ...draft, digestTime: event.target.value });
              }}
              type="time"
              value={draft.digestTime}
            />
          </label>
        </div>
        <label className="notification-toggle-row">
          <span>
            <strong><UiText text="Тихие часы" /></strong>
            <small><UiText text="Обычные instant-события будут отложены, а не потеряны." /></small>
          </span>
          <input
            checked={Boolean(draft.quietHours)}
            onChange={(event) => toggleQuietHours(event.target.checked)}
            type="checkbox"
          />
        </label>
        {draft.quietHours && (
          <div className="notification-time-grid">
            <label className="form-field">
              <span><UiText text="Начало" /></span>
              <input
                onChange={(event) => {
                  setSaved(false);
                  setDraft({
                    ...draft,
                    quietHours: {
                      ...draft.quietHours!,
                      start: event.target.value
                    }
                  });
                }}
                type="time"
                value={draft.quietHours.start}
              />
            </label>
            <label className="form-field">
              <span><UiText text="Окончание" /></span>
              <input
                onChange={(event) => {
                  setSaved(false);
                  setDraft({
                    ...draft,
                    quietHours: {
                      ...draft.quietHours!,
                      end: event.target.value
                    }
                  });
                }}
                type="time"
                value={draft.quietHours.end}
              />
            </label>
            <label className="checkbox-field notification-critical">
              <input
                checked={draft.quietHours.criticalBypass}
                onChange={(event) => {
                  setSaved(false);
                  setDraft({
                    ...draft,
                    quietHours: {
                      ...draft.quietHours!,
                      criticalBypass: event.target.checked
                    }
                  });
                }}
                type="checkbox"
              />
              <UiText text="Критические события доставлять сразу" /></label>
          </div>
        )}
      </section>

      <section className="panel notification-card">
        <header className="security-card-header">
          <div>
            <h2><UiText text="Категории и режимы" /></h2>
            <p>
              <UiText text="Эти правила становятся значениями по умолчанию для всех проектов." /></p>
          </div>
        </header>
        <div className="notification-matrix-wrap" tabIndex={0}>
          <table className="notification-matrix">
            <thead>
              <tr>
                <th><UiText text="Категория" /></th>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <th key={channel}>{<UiText text={channelLabel(channel) ?? ""} />}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((eventType) => (
                <tr key={eventType}>
                  <th>{<UiText text={eventLabel(eventType) ?? ""} />}</th>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const rule = findRule(draft.rules, eventType, channel);
                    return (
                      <td key={channel}>
                        <label className="matrix-rule">
                          <input
                            checked={rule.enabled}
                            disabled={
                              channel === "IN_APP" &&
                              ["SECURITY", "BILLING"].includes(eventType)
                            }
                            onChange={(event) =>
                              updateRule(eventType, channel, {
                                enabled: event.target.checked
                              })
                            }
                            type="checkbox"
                          />
                          <span><UiText text="Включено" /></span>
                        </label>
                        <RuleSelectors
                          disabled={!rule.enabled}
                          eventType={eventType}
                          onChange={(change) =>
                            updateRule(eventType, channel, change)
                          }
                          rule={rule}
                          channel={channel}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="notification-savebar">
        <span>
          {dirty
            ? <UiText text="Есть несохранённые изменения" />
            : <UiText text="Сохранено · версия {0}" values={[String(draft.version)]} />}
        </span>
        {projectId && (
          <a
            className="secondary-button notification-project-link"
            href={`/app/projects/${encodeURIComponent(projectId)}/settings/notifications`}
          >
            <UiText text="Настроить текущий проект" /></a>
        )}
        <button
          className="primary-button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          type="button"
        >
          {saving ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}
        </button>
      </div>
    </div>
  );
}

export function RuleSelectors({
  channel,
  disabled,
  eventType,
  onChange,
  rule
}: Readonly<{
  channel: NotificationChannel;
  disabled: boolean;
  eventType: NotificationEventType;
  onChange: (change: Partial<NotificationRule>) => void;
  rule: NotificationRule;
}>) {
  const { t: uiText } = useUiLocale();
  const label = eventLabel(eventType);
  const channelName = channelLabel(channel);
  return (
    <div className="matrix-selects">
      <label>
        <small><UiText text="Важность" /></small>
        <CustomSelect
          aria-label={uiText("{0}: важность {1}", [String(label), String(channelName)])}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              minimumSeverity:
                event.target.value as NotificationRule["minimumSeverity"]
            })
          }
          value={rule.minimumSeverity}
        >
          <option value="INFO"><UiText text="Любая" /></option>
          <option value="WARNING"><UiText text="Предупреждение" /></option>
          <option value="CRITICAL"><UiText text="Критическая" /></option>
        </CustomSelect>
      </label>
      <label>
        <small><UiText text="Доставка" /></small>
        <CustomSelect
          aria-label={uiText("{0}: режим {1}", [String(label), String(channelName)])}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              deliveryMode: event.target.value as DeliveryMode
            })
          }
          value={rule.deliveryMode}
        >
          <option value="INSTANT"><UiText text="Сразу" /></option>
          <option value="HOURLY_DIGEST"><UiText text="Раз в час" /></option>
          <option value="DAILY_DIGEST"><UiText text="Раз в день" /></option>
        </CustomSelect>
      </label>
    </div>
  );
}

function ChannelSwitch({
  checked,
  description,
  disabled,
  label,
  onChange
}: Readonly<{
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <label className="notification-channel">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function uniqueEvents(
  rules: readonly NotificationRule[]
): readonly NotificationEventType[] {
  return [...new Set(rules.map(({ eventType }) => eventType))];
}

function findRule(
  rules: readonly NotificationRule[],
  eventType: NotificationEventType,
  channel: NotificationChannel
): NotificationRule {
  const rule = rules.find(
    (candidate) =>
      candidate.eventType === eventType && candidate.channel === channel
  );
  if (!rule) throw new Error("Notification rule matrix is incomplete");
  return rule;
}

function notificationErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "Настройки изменились в другой вкладке. Обновите страницу.";
    }
    return error.message;
  }
  return "Не удалось сохранить настройки уведомлений.";
}

export function channelLabel(channel: NotificationChannel): string {
  if (channel === "IN_APP") return "В приложении";
  if (channel === "EMAIL") return "Email";
  return "Browser Push";
}

export function eventLabel(eventType: NotificationEventType): string {
  const labels: Readonly<Record<NotificationEventType, string>> = {
    ASSIGNMENT: "Назначения",
    MENTION: "Упоминания",
    SEMANTIC_IMPORT: "Импорт семантики",
    RANK_TRACKING: "Съём позиций",
    FREQUENCY_COLLECTION: "Сбор частотности",
    SERP_COLLECTION: "Сбор SERP",
    CLUSTERING: "Кластеризация",
    CRAWL_RADAR: "Radar и crawl",
    SITEMAP: "Sitemap",
    MAGNET: "Magnet",
    AUTOMATION: "Автоматизации",
    INTEGRATION: "Интеграции",
    JOB: "Фоновые задания",
    REPORT: "Отчёты",
    SECURITY: "Безопасность",
    BILLING: "Оплата и баланс",
    PRODUCT: "Новости продукта"
  };
  return labels[eventType];
}
