import { BadRequestException } from "@nestjs/common";
import {
  notificationChannels,
  notificationDeliveryModes,
  notificationEventTypes,
  notificationSeverities,
  projectNotificationEventTypes,
  projectNotificationModes,
  type InternalUpdateNotificationPreferencesInput,
  type InternalUpdateProjectNotificationSubscriptionInput,
  type NotificationQuietHours,
  type NotificationRuleSetting
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-context.js";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function notificationPreferencesInput(
  value: unknown
): InternalUpdateNotificationPreferencesInput {
  const input = inputObject(value);
  return {
    userId: internalUuid(stringValue(input.userId, "userId"), "userId"),
    version: positiveInteger(input.version, "version"),
    channels: channelSettings(input.channels),
    timezone: timezoneValue(input.timezone),
    ...(input.quietHours === undefined || input.quietHours === null
      ? {}
      : { quietHours: quietHours(input.quietHours) }),
    digestTime: timeValue(input.digestTime, "digestTime"),
    rules: rulesValue(input.rules, false)
  };
}

export function projectNotificationSubscriptionInput(
  value: unknown
): InternalUpdateProjectNotificationSubscriptionInput {
  const input = inputObject(value);
  const mode = enumValue(
    input.mode,
    projectNotificationModes,
    "mode"
  );
  const pausedUntil = optionalFutureDate(input.pausedUntil, "pausedUntil");
  if (mode === "PAUSED" && !pausedUntil) {
    invalid("pausedUntil", "A future date is required in PAUSED mode");
  }
  if (mode !== "PAUSED" && pausedUntil) {
    invalid("pausedUntil", "Only PAUSED mode accepts a pause date");
  }
  return {
    userId: internalUuid(stringValue(input.userId, "userId"), "userId"),
    workspaceId: internalUuid(
      stringValue(input.workspaceId, "workspaceId"),
      "workspaceId"
    ),
    projectId: internalUuid(
      stringValue(input.projectId, "projectId"),
      "projectId"
    ),
    membershipId: internalUuid(
      stringValue(input.membershipId, "membershipId"),
      "membershipId"
    ),
    membershipVersion: positiveInteger(
      input.membershipVersion,
      "membershipVersion"
    ),
    version: positiveInteger(input.version, "version"),
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
    invalid("rules", `Must contain at most ${maximum} rules`);
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
    if (seen.has(key)) {
      invalid(`rules.${index}`, "Duplicate event type and channel");
    }
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
    invalid("$", "A JSON object is required");
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    invalid(field, "A non-empty string is required");
  }
  return value.trim();
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "A boolean is required");
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalid(field, "A positive integer is required");
  }
  return value as number;
}

function timeValue(value: unknown, field: string): string {
  const time = stringValue(value, field);
  if (!TIME_PATTERN.test(time)) {
    invalid(field, "Use HH:mm in 24-hour format");
  }
  return time;
}

function timezoneValue(value: unknown): string {
  const timezone = stringValue(value, "timezone");
  if (timezone.length > 64) invalid("timezone", "Timezone is too long");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    invalid("timezone", "Use a valid IANA timezone");
  }
  return timezone;
}

function optionalFutureDate(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = stringValue(value, field);
  const date = new Date(raw);
  const maximum = Date.now() + 366 * 24 * 60 * 60 * 1_000;
  if (
    Number.isNaN(date.getTime()) ||
    date.getTime() <= Date.now() ||
    date.getTime() > maximum
  ) {
    invalid(field, "Use a future date no more than 366 days ahead");
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
    invalid(field, `Must be one of: ${values.join(", ")}`);
  }
  return value as Value;
}

function invalid(field: string, message: string): never {
  throw new BadRequestException(`${field}: ${message}`);
}
