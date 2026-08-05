"use client";

import { useEffect, useMemo, useState } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  channelLabel,
  eventLabel,
  NOTIFICATION_CHANNELS,
  RuleSelectors,
  type NotificationChannel,
  type NotificationEventType,
  type NotificationRule
} from "./notification-settings";

interface EffectiveNotificationRule extends NotificationRule {
  readonly source: "PROFILE" | "PROJECT" | "PAUSE";
  readonly blockedByProfile: boolean;
}

interface ProjectNotificationSubscription {
  readonly userId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly mode: "INHERIT" | "OVERRIDE" | "PAUSED";
  readonly pausedUntil?: string;
  readonly notifyOwnJobs: boolean;
  readonly rules: readonly NotificationRule[];
  readonly effectiveRules: readonly EffectiveNotificationRule[];
  readonly version: number;
  readonly updatedAt: string;
}

export function ProjectNotificationSettings({
  projectId,
  projectName
}: Readonly<{ projectId: string; projectName: string }>) {
  const [settings, setSettings] =
    useState<ProjectNotificationSubscription>();
  const [draft, setDraft] =
    useState<ProjectNotificationSubscription>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void browserApiRequest<ProjectNotificationSubscription>(
      `/app/api/projects/${encodeURIComponent(projectId)}/notification-subscription`,
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
  }, [projectId, retryVersion]);

  const dirty = useMemo(
    () =>
      Boolean(
        settings &&
          draft &&
          JSON.stringify(settings) !== JSON.stringify(draft)
      ),
    [draft, settings]
  );
  const previewRules = useMemo(
    () => (draft ? effectivePreview(draft) : []),
    [draft]
  );

  function changeMode(
    mode: ProjectNotificationSubscription["mode"]
  ): void {
    if (!draft) return;
    setSaved(false);
    const rules =
      mode === "OVERRIDE" && draft.rules.length === 0
        ? draft.effectiveRules.map(stripEffectiveRule)
        : mode === "INHERIT"
          ? []
          : draft.rules;
    const next = {
      ...draft,
      mode,
      rules
    };
    if (mode === "PAUSED") {
      setDraft({
        ...next,
        pausedUntil:
          draft.pausedUntil ?? defaultPauseDate().toISOString()
      });
      return;
    }
    const { pausedUntil: _pausedUntil, ...withoutPause } = next;
    setDraft(withoutPause);
  }

  function updateRule(
    eventType: NotificationEventType,
    channel: NotificationChannel,
    change: Partial<NotificationRule>
  ): void {
    if (!draft) return;
    setSaved(false);
    const sourceRules =
      draft.rules.length > 0
        ? draft.rules
        : draft.effectiveRules.map(stripEffectiveRule);
    setDraft({
      ...draft,
      rules: sourceRules.map((rule) =>
        rule.eventType === eventType && rule.channel === channel
          ? { ...rule, ...change }
          : rule
      )
    });
  }

  async function save(): Promise<void> {
    if (!draft || saving) return;
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      const result =
        await browserApiRequest<ProjectNotificationSubscription>(
          `/app/api/projects/${encodeURIComponent(projectId)}/notification-subscription`,
          {
            method: "PATCH",
            ifMatch: draft.version,
            body: {
              mode: draft.mode,
              ...(draft.mode === "PAUSED" && draft.pausedUntil
                ? { pausedUntil: draft.pausedUntil }
                : {}),
              notifyOwnJobs: draft.notifyOwnJobs,
              rules: draft.mode === "INHERIT" ? [] : draft.rules
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
        <p>Загружаем подписку проекта…</p>
      </section>
    );
  }
  if (!draft) {
    return (
      <section className="panel panel-empty compact">
        <strong>Подписка проекта недоступна</strong>
        <p>{error ?? "Проверьте доступ к проекту и повторите."}</p>
        <button
          className="secondary-button"
          onClick={() => setRetryVersion((value) => value + 1)}
          type="button"
        >
          Повторить
        </button>
      </section>
    );
  }

  const events = uniqueEvents(previewRules);
  const enabledCount = previewRules.filter(
    ({ enabled }) => enabled
  ).length;
  return (
    <div className="notification-settings-stack">
      {error && (
        <div className="inline-alert danger" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="inline-alert success" role="status">
          Подписка проекта сохранена
        </div>
      )}

      <section className="panel notification-card">
        <header className="security-card-header">
          <div>
            <h2>Режим подписки</h2>
            <p>
              Настройка относится только к вам и проекту «{projectName}».
            </p>
          </div>
          <span className="security-status on">
            Доступ v{draft.membershipVersion}
          </span>
        </header>
        <div className="project-notification-mode">
          <label>
            <input
              checked={draft.mode === "INHERIT"}
              name="notification-mode"
              onChange={() => changeMode("INHERIT")}
              type="radio"
            />
            <span>
              <strong>Наследовать профиль</strong>
              <small>Использовать глобальные каналы и категории.</small>
            </span>
          </label>
          <label>
            <input
              checked={draft.mode === "OVERRIDE"}
              name="notification-mode"
              onChange={() => changeMode("OVERRIDE")}
              type="radio"
            />
            <span>
              <strong>Переопределить</strong>
              <small>Настроить работы этого проекта отдельно.</small>
            </span>
          </label>
          <label>
            <input
              checked={draft.mode === "PAUSED"}
              name="notification-mode"
              onChange={() => changeMode("PAUSED")}
              type="radio"
            />
            <span>
              <strong>Пауза</strong>
              <small>Временно остановить проектные доставки.</small>
            </span>
          </label>
        </div>
        {draft.mode === "PAUSED" && (
          <label className="form-field project-pause-field">
            <span>Приостановить до</span>
            <input
              max={localDateTime(
                new Date(Date.now() + 366 * 24 * 60 * 60 * 1_000)
              )}
              min={localDateTime(new Date(Date.now() + 60_000))}
              onChange={(event) => {
                const date = new Date(event.target.value);
                if (!Number.isNaN(date.getTime())) {
                  setSaved(false);
                  setDraft({
                    ...draft,
                    pausedUntil: date.toISOString()
                  });
                }
              }}
              type="datetime-local"
              value={
                draft.pausedUntil
                  ? localDateTime(new Date(draft.pausedUntil))
                  : ""
              }
            />
          </label>
        )}
        <label className="notification-toggle-row">
          <span>
            <strong>Мои фоновые задания</strong>
            <small>
              Сообщать о завершении, частичном результате, отмене и ошибке
              созданных вами работ.
            </small>
          </span>
          <input
            checked={draft.notifyOwnJobs}
            onChange={(event) => {
              setSaved(false);
              setDraft({
                ...draft,
                notifyOwnJobs: event.target.checked
              });
            }}
            type="checkbox"
          />
        </label>
      </section>

      <section className="panel notification-card">
        <header className="security-card-header">
          <div>
            <h2>Работы проекта</h2>
            <p>
              Заблокированные профильным master-switch каналы нельзя включить
              здесь.
            </p>
          </div>
          <span className="security-status">
            {enabledCount} эффективных правил
          </span>
        </header>
        <div className="notification-matrix-wrap" tabIndex={0}>
          <table className="notification-matrix">
            <thead>
              <tr>
                <th>Тип работы</th>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <th key={channel}>{channelLabel(channel)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((eventType) => (
                <tr key={eventType}>
                  <th>{eventLabel(eventType)}</th>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const effective = findEffective(
                      previewRules,
                      eventType,
                      channel
                    );
                    const editable = findEditable(
                      draft,
                      eventType,
                      channel
                    );
                    const canEdit = draft.mode === "OVERRIDE";
                    return (
                      <td key={channel}>
                        <label className="matrix-rule">
                          <input
                            checked={
                              canEdit ? editable.enabled : effective.enabled
                            }
                            disabled={
                              !canEdit || effective.blockedByProfile
                            }
                            onChange={(event) =>
                              updateRule(eventType, channel, {
                                enabled: event.target.checked
                              })
                            }
                            type="checkbox"
                          />
                          <span>
                            {effective.blockedByProfile
                              ? "Выключено в профиле"
                              : effective.source === "PROJECT"
                                ? "Проект"
                                : effective.source === "PAUSE"
                                  ? "Пауза"
                                  : "Профиль"}
                          </span>
                        </label>
                        <RuleSelectors
                          channel={channel}
                          disabled={
                            !canEdit ||
                            effective.blockedByProfile ||
                            !editable.enabled
                          }
                          eventType={eventType}
                          onChange={(change) =>
                            updateRule(eventType, channel, change)
                          }
                          rule={editable}
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
            ? "Есть несохранённые изменения"
            : `Сохранено · версия ${draft.version}`}
        </span>
        <button
          className="secondary-button"
          disabled={draft.mode === "INHERIT" && draft.rules.length === 0}
          onClick={() => changeMode("INHERIT")}
          type="button"
        >
          Сбросить к профилю
        </button>
        <button
          className="primary-button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

function findEffective(
  rules: readonly EffectiveNotificationRule[],
  eventType: NotificationEventType,
  channel: NotificationChannel
): EffectiveNotificationRule {
  const rule = rules.find(
    (candidate) =>
      candidate.eventType === eventType && candidate.channel === channel
  );
  if (!rule) throw new Error("Effective notification matrix is incomplete");
  return rule;
}

function findEditable(
  subscription: ProjectNotificationSubscription,
  eventType: NotificationEventType,
  channel: NotificationChannel
): NotificationRule {
  return (
    subscription.rules.find(
      (candidate) =>
        candidate.eventType === eventType &&
        candidate.channel === channel
    ) ??
    stripEffectiveRule(
      findEffective(subscription.effectiveRules, eventType, channel)
    )
  );
}

function stripEffectiveRule(
  rule: EffectiveNotificationRule
): NotificationRule {
  return {
    eventType: rule.eventType,
    channel: rule.channel,
    enabled: rule.enabled,
    minimumSeverity: rule.minimumSeverity,
    deliveryMode: rule.deliveryMode
  };
}

function effectivePreview(
  subscription: ProjectNotificationSubscription
): readonly EffectiveNotificationRule[] {
  return subscription.effectiveRules.map((inherited) => {
    const editable = findEditable(
      subscription,
      inherited.eventType,
      inherited.channel
    );
    if (subscription.mode === "PAUSED") {
      return {
        ...editable,
        enabled: false,
        source: "PAUSE",
        blockedByProfile: inherited.blockedByProfile
      };
    }
    if (subscription.mode === "OVERRIDE") {
      return {
        ...editable,
        enabled: !inherited.blockedByProfile && editable.enabled,
        source: "PROJECT",
        blockedByProfile: inherited.blockedByProfile
      };
    }
    return {
      ...inherited,
      enabled: !inherited.blockedByProfile,
      source: "PROFILE"
    };
  });
}

function uniqueEvents(
  rules: readonly EffectiveNotificationRule[]
): readonly NotificationEventType[] {
  return [...new Set(rules.map(({ eventType }) => eventType))];
}

function defaultPauseDate(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1_000);
}

function localDateTime(value: Date): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function notificationErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "Подписка изменилась в другой вкладке. Перезагрузите настройки.";
    }
    if (error.code === "NOT_FOUND") {
      return "Проект не найден или доступ к нему отозван.";
    }
    return error.message;
  }
  return "Не удалось сохранить подписку проекта.";
}
