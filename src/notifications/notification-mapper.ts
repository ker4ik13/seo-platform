import {
  notificationChannels,
  notificationDeliveryModes,
  notificationEventTypes,
  notificationSeverities,
  projectNotificationEventTypes,
  projectNotificationModes,
  type EffectiveProjectNotificationRule,
  type NotificationPreferencesSummary,
  type NotificationRuleSetting,
  type ProjectNotificationSubscriptionSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

export function notificationPreferencesSummary(
  value: unknown
): NotificationPreferencesSummary {
  const item = objectValue(value);
  const channels = objectValue(item?.channels);
  const quiet = objectValue(item?.quietHours);
  const rules = item?.rules;
  if (
    !item ||
    !uuid(item.userId) ||
    !channels ||
    typeof channels.inApp !== "boolean" ||
    typeof channels.email !== "boolean" ||
    typeof channels.webPush !== "boolean" ||
    !nonEmptyString(item.timezone) ||
    !time(item.digestTime) ||
    !Array.isArray(rules) ||
    !positiveInteger(item.version) ||
    !dateString(item.updatedAt) ||
    (item.quietHours !== undefined &&
      (!quiet ||
        !time(quiet.start) ||
        !time(quiet.end) ||
        typeof quiet.criticalBypass !== "boolean"))
  ) {
    throw invalidResponse();
  }
  return {
    userId: item.userId,
    channels: {
      inApp: channels.inApp,
      email: channels.email,
      webPush: channels.webPush
    },
    timezone: item.timezone,
    ...(quiet
      ? {
          quietHours: {
            start: quiet.start as string,
            end: quiet.end as string,
            criticalBypass: quiet.criticalBypass as boolean
          }
        }
      : {}),
    digestTime: item.digestTime,
    rules: rules.map(notificationRule),
    version: item.version,
    updatedAt: item.updatedAt
  };
}

export function projectNotificationSubscriptionSummary(
  value: unknown
): ProjectNotificationSubscriptionSummary {
  const item = objectValue(value);
  if (
    !item ||
    !uuid(item.userId) ||
    !uuid(item.workspaceId) ||
    !uuid(item.projectId) ||
    !uuid(item.membershipId) ||
    !positiveInteger(item.membershipVersion) ||
    typeof item.mode !== "string" ||
    !projectNotificationModes.some((mode) => mode === item.mode) ||
    (item.pausedUntil !== undefined && !dateString(item.pausedUntil)) ||
    typeof item.notifyOwnJobs !== "boolean" ||
    !Array.isArray(item.rules) ||
    !Array.isArray(item.effectiveRules) ||
    !positiveInteger(item.version) ||
    !dateString(item.updatedAt)
  ) {
    throw invalidResponse();
  }
  return {
    userId: item.userId,
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    membershipId: item.membershipId,
    membershipVersion: item.membershipVersion,
    mode: item.mode as ProjectNotificationSubscriptionSummary["mode"],
    ...(typeof item.pausedUntil === "string"
      ? { pausedUntil: item.pausedUntil }
      : {}),
    notifyOwnJobs: item.notifyOwnJobs,
    rules: item.rules.map(notificationRule),
    effectiveRules: item.effectiveRules.map(effectiveRule),
    version: item.version,
    updatedAt: item.updatedAt
  };
}

function effectiveRule(value: unknown): EffectiveProjectNotificationRule {
  const item = objectValue(value);
  const rule = notificationRule(value);
  if (
    !item ||
    !projectNotificationEventTypes.some(
      (eventType) => eventType === rule.eventType
    ) ||
    !["PROFILE", "PROJECT", "PAUSE"].some(
      (source) => source === item.source
    ) ||
    typeof item.blockedByProfile !== "boolean"
  ) {
    throw invalidResponse();
  }
  return {
    ...rule,
    eventType:
      rule.eventType as EffectiveProjectNotificationRule["eventType"],
    source: item.source as EffectiveProjectNotificationRule["source"],
    blockedByProfile: item.blockedByProfile
  };
}

function notificationRule(value: unknown): NotificationRuleSetting {
  const item = objectValue(value);
  if (
    !item ||
    typeof item.eventType !== "string" ||
    !notificationEventTypes.some(
      (eventType) => eventType === item.eventType
    ) ||
    typeof item.channel !== "string" ||
    !notificationChannels.some((channel) => channel === item.channel) ||
    typeof item.enabled !== "boolean" ||
    typeof item.minimumSeverity !== "string" ||
    !notificationSeverities.some(
      (severity) => severity === item.minimumSeverity
    ) ||
    typeof item.deliveryMode !== "string" ||
    !notificationDeliveryModes.some(
      (mode) => mode === item.deliveryMode
    )
  ) {
    throw invalidResponse();
  }
  return {
    eventType: item.eventType as NotificationRuleSetting["eventType"],
    channel: item.channel as NotificationRuleSetting["channel"],
    enabled: item.enabled,
    minimumSeverity:
      item.minimumSeverity as NotificationRuleSetting["minimumSeverity"],
    deliveryMode:
      item.deliveryMode as NotificationRuleSetting["deliveryMode"]
  };
}

function objectValue(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function time(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function dateString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function invalidResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Realtime service returned invalid notification settings",
    retryable: true
  });
}
