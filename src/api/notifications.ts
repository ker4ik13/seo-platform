export const notificationChannels = [
  "IN_APP",
  "EMAIL",
  "WEB_PUSH"
] as const;

export type NotificationChannel = (typeof notificationChannels)[number];

export const notificationEventTypes = [
  "ASSIGNMENT",
  "MENTION",
  "SEMANTIC_IMPORT",
  "RANK_TRACKING",
  "FREQUENCY_COLLECTION",
  "SERP_COLLECTION",
  "CLUSTERING",
  "CRAWL_RADAR",
  "SITEMAP",
  "MAGNET",
  "AUTOMATION",
  "INTEGRATION",
  "JOB",
  "REPORT",
  "SECURITY",
  "BILLING",
  "PRODUCT"
] as const;

export type NotificationEventType =
  (typeof notificationEventTypes)[number];

export const projectNotificationEventTypes = [
  "SEMANTIC_IMPORT",
  "RANK_TRACKING",
  "FREQUENCY_COLLECTION",
  "SERP_COLLECTION",
  "CLUSTERING",
  "CRAWL_RADAR",
  "SITEMAP",
  "MAGNET",
  "AUTOMATION",
  "INTEGRATION",
  "JOB",
  "REPORT"
] as const satisfies readonly NotificationEventType[];

export type ProjectNotificationEventType =
  (typeof projectNotificationEventTypes)[number];

export const notificationSeverities = [
  "INFO",
  "WARNING",
  "CRITICAL"
] as const;

export type NotificationSeverity =
  (typeof notificationSeverities)[number];

export const notificationDeliveryModes = [
  "INSTANT",
  "HOURLY_DIGEST",
  "DAILY_DIGEST"
] as const;

export type NotificationDeliveryMode =
  (typeof notificationDeliveryModes)[number];

export const projectNotificationModes = [
  "INHERIT",
  "OVERRIDE",
  "PAUSED"
] as const;

export type ProjectNotificationMode =
  (typeof projectNotificationModes)[number];

export interface NotificationChannelSettings {
  readonly inApp: boolean;
  readonly email: boolean;
  readonly webPush: boolean;
}

export interface NotificationQuietHours {
  readonly start: string;
  readonly end: string;
  readonly criticalBypass: boolean;
}

export interface NotificationRuleSetting {
  readonly eventType: NotificationEventType;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly minimumSeverity: NotificationSeverity;
  readonly deliveryMode: NotificationDeliveryMode;
}

export interface NotificationPreferencesSummary {
  readonly userId: string;
  readonly channels: NotificationChannelSettings;
  readonly timezone: string;
  readonly quietHours?: NotificationQuietHours;
  readonly digestTime: string;
  readonly rules: readonly NotificationRuleSetting[];
  readonly version: number;
  readonly updatedAt: string;
}

export interface UpdateNotificationPreferencesInput {
  readonly channels: NotificationChannelSettings;
  readonly timezone: string;
  readonly quietHours?: NotificationQuietHours;
  readonly digestTime: string;
  readonly rules: readonly NotificationRuleSetting[];
}

export interface InternalUpdateNotificationPreferencesInput
  extends UpdateNotificationPreferencesInput {
  readonly userId: string;
  readonly version: number;
}

export interface EffectiveProjectNotificationRule
  extends NotificationRuleSetting {
  readonly eventType: ProjectNotificationEventType;
  readonly source: "PROFILE" | "PROJECT" | "PAUSE";
  readonly blockedByProfile: boolean;
}

export interface ProjectNotificationSubscriptionSummary {
  readonly userId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly mode: ProjectNotificationMode;
  readonly pausedUntil?: string;
  readonly notifyOwnJobs: boolean;
  readonly rules: readonly NotificationRuleSetting[];
  readonly effectiveRules: readonly EffectiveProjectNotificationRule[];
  readonly version: number;
  readonly updatedAt: string;
}

export interface UpdateProjectNotificationSubscriptionInput {
  readonly mode: ProjectNotificationMode;
  readonly pausedUntil?: string;
  readonly notifyOwnJobs: boolean;
  readonly rules: readonly NotificationRuleSetting[];
}

export interface InternalUpdateProjectNotificationSubscriptionInput
  extends UpdateProjectNotificationSubscriptionInput {
  readonly userId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly version: number;
}
