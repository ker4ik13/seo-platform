import {
  notificationChannels,
  notificationDeliveryModes,
  notificationEventTypes,
  notificationSeverities,
  projectNotificationEventTypes,
  projectNotificationModes,
  type NotificationQuietHours,
  type NotificationRuleSetting,
  type UpdateNotificationPreferencesInput,
  type UpdateProjectNotificationSubscriptionInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function updateNotificationPreferencesInput(
  value: unknown
): UpdateNotificationPreferencesInput {
  const input = inputObject(value);
  return {
    channels: channelSettings(input.channels),
    timezone: timezoneValue(input.timezone),
    ...(input.quietHours === undefined || input.quietHours === null
      ? {}
      : { quietHours: quietHours(input.quietHours) }),
    digestTime: timeValue(input.digestTime, "digestTime"),
    rules: rulesValue(input.rules, false)
  };
}

export function updateProjectNotificationSubscriptionInput(
  value: unknown
): UpdateProjectNotificationSubscriptionInput {
  const input = inputObject(value);
  const mode = enumValue(
    input.mode,
    projectNotificationModes,
    "mode"
  );
  const pausedUntil = optionalFutureDate(input.pausedUntil, "pausedUntil");
  if (mode === "PAUSED" && !pausedUntil) {
    invalid("pausedUntil", "FUTURE_DATE_REQUIRED");
  }
  if (mode !== "PAUSED" && pausedUntil) {
    invalid("pausedUntil", "PAUSE_MODE_REQUIRED");
  }
  return {
    mode,
    ...(pausedUntil ? { pausedUntil } : {}),
    notifyOwnJobs: booleanValue(input.notifyOwnJobs, "notifyOwnJobs"),
    rules: rulesValue(input.rules, true)
  };
}

function channelSettings(value: unknown) {
  const channels = inputObject(value);
  return {
    inApp: booleanValue(channels.inApp, "channels.inApp"),
    email: booleanValue(channels.email, "channels.email"),
    webPush: booleanValue(channels.webPush, "channels.webPush")
  };
}

function quietHours(value: unknown): NotificationQuietHours {
  const quiet = inputObject(value);
  return {
    start: timeValue(quiet.start, "quietHours.start"),
    end: timeValue(quiet.end, "quietHours.end"),
    criticalBypass: booleanValue(
      quiet.criticalBypass,
      "quietHours.criticalBypass"
    )
  };
}

function rulesValue(
  value: unknown,
  projectOnly: boolean
): readonly NotificationRuleSetting[] {
  const maximum = projectOnly
    ? projectNotificationEventTypes.length * notificationChannels.length
    : notificationEventTypes.length * notificationChannels.length;
  if (!Array.isArray(value) || value.length > maximum) {
    invalid("rules", "INVALID_RULE_COUNT");
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const rule = inputObject(entry);
    const eventType = projectOnly
      ? enumValue(
          rule.eventType,
          projectNotificationEventTypes,
          `rules.${index}.eventType`
        )
      : enumValue(
          rule.eventType,
          notificationEventTypes,
          `rules.${index}.eventType`
        );
    const channel = enumValue(
      rule.channel,
      notificationChannels,
      `rules.${index}.channel`
    );
    const key = `${eventType}:${channel}`;
    if (seen.has(key)) invalid(`rules.${index}`, "DUPLICATE_RULE");
    seen.add(key);
    return {
      eventType,
      channel,
      enabled: booleanValue(rule.enabled, `rules.${index}.enabled`),
      minimumSeverity: enumValue(
        rule.minimumSeverity,
        notificationSeverities,
        `rules.${index}.minimumSeverity`
      ),
      deliveryMode: enumValue(
        rule.deliveryMode,
        notificationDeliveryModes,
        `rules.${index}.deliveryMode`
      )
    };
  });
}

function inputObject(
  value: unknown
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$", "OBJECT_REQUIRED");
  }
  return value as Readonly<Record<string, unknown>>;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "BOOLEAN_REQUIRED");
  return value;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    invalid(field, "STRING_REQUIRED");
  }
  return value.trim();
}

function timeValue(value: unknown, field: string): string {
  const time = stringValue(value, field);
  if (!TIME_PATTERN.test(time)) invalid(field, "INVALID_TIME");
  return time;
}

function timezoneValue(value: unknown): string {
  const timezone = stringValue(value, "timezone");
  if (timezone.length > 64) invalid("timezone", "TOO_LONG");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    invalid("timezone", "INVALID_TIMEZONE");
  }
  return timezone;
}

function optionalFutureDate(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = new Date(stringValue(value, field));
  if (
    Number.isNaN(date.getTime()) ||
    date.getTime() <= Date.now() ||
    date.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1_000
  ) {
    invalid(field, "INVALID_PAUSE_DATE");
  }
  return date.toISOString();
}

function enumValue<Value extends string>(
  value: unknown,
  values: readonly Value[],
  field: string
): Value {
  if (
    typeof value !== "string" ||
    !values.some((candidate) => candidate === value)
  ) {
    invalid(field, "INVALID_ENUM_VALUE");
  }
  return value as Value;
}

function invalid(path: string, code: string): never {
  throw validationError(path, code, "Notification settings are invalid");
}
