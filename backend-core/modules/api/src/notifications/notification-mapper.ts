import {
  notificationChannels,
  notificationDeliveryModes,
  notificationEventTypes,
  notificationSeverities,
  projectNotificationEventTypes,
  projectNotificationModes,
  type EffectiveProjectNotificationRule,
  type NotificationCollectionResponse,
  type NotificationListItem,
  type NotificationPreferencesSummary,
  type NotificationReadAllResult,
  type NotificationRuleSetting,
  type ProjectNotificationSubscriptionSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,1000}$/u;

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

export function notificationCollectionResponse(
  value: unknown
): NotificationCollectionResponse {
  const response = objectValue(value);
  const page = objectValue(response?.page);
  const meta = objectValue(response?.meta);
  if (
    !response ||
    !Array.isArray(response.data) ||
    !page ||
    typeof page.hasNext !== "boolean" ||
    !nonNegativeInteger(page.unreadCount) ||
    (page.nextCursor !== undefined &&
      (typeof page.nextCursor !== "string" ||
        !CURSOR_PATTERN.test(page.nextCursor))) ||
    !meta ||
    !nonEmptyString(meta.requestId)
  ) {
    throw invalidResponse();
  }
  return {
    data: response.data.map(notificationListItem),
    page: {
      hasNext: page.hasNext,
      unreadCount: page.unreadCount,
      ...(typeof page.nextCursor === "string"
        ? { nextCursor: page.nextCursor }
        : {})
    },
    meta: { requestId: meta.requestId }
  };
}

export function notificationListItem(value: unknown): NotificationListItem {
  const item = objectValue(value);
  const resource = objectValue(item?.resource);
  if (
    !item ||
    !uuid(item.id) ||
    !uuid(item.workspaceId) ||
    (item.projectId !== undefined && !uuid(item.projectId)) ||
    typeof item.eventType !== "string" ||
    !notificationEventTypes.some(
      (eventType) => eventType === item.eventType
    ) ||
    typeof item.severity !== "string" ||
    !notificationSeverities.some(
      (severity) => severity === item.severity
    ) ||
    !boundedString(item.title, 255) ||
    (item.body !== undefined && typeof item.body !== "string") ||
    (item.actorId !== undefined && !uuid(item.actorId)) ||
    (item.resource !== undefined &&
      (!resource ||
        !boundedString(resource.type, 64) ||
        !uuid(resource.id))) ||
    (item.deepLink !== undefined && !safeAppPath(item.deepLink)) ||
    (item.readAt !== undefined && !dateString(item.readAt)) ||
    !dateString(item.createdAt)
  ) {
    throw invalidResponse();
  }
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    ...(typeof item.projectId === "string"
      ? { projectId: item.projectId }
      : {}),
    eventType: item.eventType as NotificationListItem["eventType"],
    severity: item.severity as NotificationListItem["severity"],
    title: item.title,
    ...(typeof item.body === "string" ? { body: item.body } : {}),
    ...(typeof item.actorId === "string"
      ? { actorId: item.actorId }
      : {}),
    ...(resource
      ? {
          resource: {
            type: resource.type as string,
            id: resource.id as string
          }
        }
      : {}),
    ...(typeof item.deepLink === "string"
      ? { deepLink: item.deepLink }
      : {}),
    ...(typeof item.readAt === "string" ? { readAt: item.readAt } : {}),
    createdAt: item.createdAt
  };
}

export function notificationReadAllResult(
  value: unknown
): NotificationReadAllResult {
  const result = objectValue(value);
  if (
    !result ||
    !nonNegativeInteger(result.updated) ||
    !dateString(result.readAt)
  ) {
    throw invalidResponse();
  }
  return {
    updated: result.updated,
    readAt: result.readAt
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

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
  );
}

function safeAppPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === "/app" || value.startsWith("/app/")) &&
    // oxlint-disable-next-line no-control-regex -- Private deep links reject C0 and DEL characters.
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function time(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
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
