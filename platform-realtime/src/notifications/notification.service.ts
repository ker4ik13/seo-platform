import { createHash } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable
} from "@nestjs/common";
import {
  notificationChannels,
  notificationEventTypes,
  projectNotificationEventTypes,
  type EffectiveProjectNotificationRule,
  type InternalCreateProjectNotificationInput,
  type InternalCreateProjectNotificationReceipt,
  type InternalUpdateNotificationPreferencesInput,
  type InternalUpdateProjectNotificationSubscriptionInput,
  type NotificationChannel,
  type NotificationDeliveryMode,
  type NotificationEventType,
  type NotificationPreferencesSummary,
  type NotificationRuleSetting,
  type NotificationSeverity,
  type ProjectNotificationSubscriptionSummary
} from "@seo-platform/contracts";
import type { InternalProjectContext } from "../internal/internal-context.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

interface StoredRule {
  readonly eventType: NotificationEventType;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly minimumSeverity: NotificationSeverity;
  readonly deliveryMode: NotificationDeliveryMode;
}

interface StoredPreference {
  readonly id: string;
  readonly userId: string;
  readonly inAppEnabled: boolean;
  readonly emailEnabled: boolean;
  readonly webPushEnabled: boolean;
  readonly timezone: string;
  readonly quietStart: string | null;
  readonly quietEnd: string | null;
  readonly criticalBypass: boolean;
  readonly digestTime: string;
  readonly version: number;
  readonly updatedAt: Date;
}

interface StoredSubscription {
  readonly id: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly mode: "INHERIT" | "OVERRIDE" | "PAUSED";
  readonly pausedUntil: Date | null;
  readonly notifyOwnJobs: boolean;
  readonly version: number;
  readonly updatedAt: Date;
  readonly status: "ACTIVE" | "INACTIVE";
}

@Injectable()
export class NotificationService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async getPreferences(
    userId: string
  ): Promise<NotificationPreferencesSummary> {
    const preference = await this.ensurePreference(userId);
    const rules = await this.profileRules(preference.id);
    return preferenceSummary(preference, rules);
  }

  public async createProjectNotification(
    context: InternalProjectContext,
    input: InternalCreateProjectNotificationInput
  ): Promise<InternalCreateProjectNotificationReceipt> {
    const preference = await this.ensurePreference(input.userId);
    const subscription = await this.ensureProjectSubscription(
      preference.id,
      context
    );
    const existing = await this.prisma.notification.findUnique({
      where: {
        userId_dedupeKey: {
          userId: input.userId,
          dedupeKey: input.dedupeKey
        }
      },
      select: { id: true }
    });
    if (existing) {
      return { outcome: "EXISTING", notificationId: existing.id };
    }
    if (input.ownJob && !subscription.notifyOwnJobs) {
      return { outcome: "SKIPPED", reason: "OWN_JOB_DISABLED" };
    }
    const [profileRules, projectRules] = await Promise.all([
      this.profileRules(preference.id),
      this.projectRules(subscription.id)
    ]);
    const effectiveRules = resolveEffectiveProjectRules(
      preferenceSummary(preference, profileRules),
      subscription,
      projectRules
    );
    const inAppRule = effectiveRules.find(
      (rule) =>
        rule.eventType === input.eventType &&
        rule.channel === "IN_APP"
    );
    const webPushRule = effectiveRules.find(
      (rule) =>
        rule.eventType === input.eventType &&
        rule.channel === "WEB_PUSH"
    );
    const inAppEnabled = ruleAllows(inAppRule, input.severity);
    const webPushEnabled = ruleAllows(webPushRule, input.severity);
    if (!inAppEnabled && !webPushEnabled) {
      return { outcome: "SKIPPED", reason: "POLICY_DISABLED" };
    }
    try {
      const notification = await this.prisma.$transaction(
        async (transaction) => {
          const created = await transaction.notification.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              userId: input.userId,
              eventType: input.eventType,
              severity: input.severity,
              title: input.title,
              ...(input.body ? { body: input.body } : {}),
              ...(input.actorId ? { actorId: input.actorId } : {}),
              resourceType: input.resource.type,
              resourceId: input.resource.id,
              deepLink: input.deepLink,
              dedupeKey: input.dedupeKey,
              inAppVisible: inAppEnabled
            },
            select: { id: true }
          });
          if (webPushEnabled && webPushRule) {
            const now = new Date();
            const devices = await transaction.webPushSubscription.findMany({
              where: {
                userId: input.userId,
                status: "ACTIVE",
                OR: [
                  { providerExpiresAt: null },
                  { providerExpiresAt: { gt: now } }
                ]
              },
              select: { id: true, version: true }
            });
            if (devices.length > 0) {
              const policySnapshot = {
                version: 1,
                channel: "WEB_PUSH",
                eventType: input.eventType,
                severity: input.severity,
                source: webPushRule.source,
                minimumSeverity: webPushRule.minimumSeverity,
                deliveryMode: webPushRule.deliveryMode,
                timezone: preference.timezone,
                quietHours:
                  preference.quietStart && preference.quietEnd
                    ? {
                        start: preference.quietStart,
                        end: preference.quietEnd,
                        criticalBypass: preference.criticalBypass
                      }
                    : null,
                preferenceVersion: preference.version,
                projectSubscriptionVersion: subscription.version,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                membershipId: subscription.membershipId,
                membershipVersion: subscription.membershipVersion,
                permission: deliveryPermission(input.eventType),
                evaluatedAt: now.toISOString()
              } satisfies Prisma.InputJsonObject;
              const payloadSnapshot = pushPayload(input);
              const availableAt = deliveryAvailableAt(
                now,
                preference,
                webPushRule.deliveryMode,
                input.severity
              );
              await transaction.webPushDeliveryAttempt.createMany({
                data: devices.map((device) => ({
                  notificationId: created.id,
                  subscriptionId: device.id,
                  userId: input.userId,
                  subscriptionVersion: device.version,
                  deliveryMode: webPushRule.deliveryMode,
                  policySnapshot,
                  payloadSnapshot,
                  maxAttempts: this.config.webPush.deliveryMaxAttempts,
                  availableAt
                })),
                skipDuplicates: true
              });
            }
          }
          return created;
        }
      );
      return { outcome: "CREATED", notificationId: notification.id };
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const replay = await this.prisma.notification.findUniqueOrThrow({
        where: {
          userId_dedupeKey: {
            userId: input.userId,
            dedupeKey: input.dedupeKey
          }
        },
        select: { id: true }
      });
      return { outcome: "EXISTING", notificationId: replay.id };
    }
  }

  public async updatePreferences(
    input: InternalUpdateNotificationPreferencesInput
  ): Promise<NotificationPreferencesSummary> {
    const existing = await this.ensurePreference(input.userId);
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.notificationPreference.updateMany({
        where: {
          id: existing.id,
          userId: input.userId,
          version: input.version
        },
        data: {
          inAppEnabled: input.channels.inApp,
          emailEnabled: input.channels.email,
          webPushEnabled: input.channels.webPush,
          timezone: input.timezone,
          quietStart: input.quietHours?.start ?? null,
          quietEnd: input.quietHours?.end ?? null,
          criticalBypass: input.quietHours?.criticalBypass ?? true,
          digestTime: input.digestTime,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw versionConflict();

      await transaction.notificationRule.deleteMany({
        where: {
          preferenceId: existing.id,
          subscriptionId: null
        }
      });
      if (input.rules.length > 0) {
        await transaction.notificationRule.createMany({
          data: input.rules.map((rule) => ({
            preferenceId: existing.id,
            subscriptionId: null,
            scopeKey: existing.id,
            userId: input.userId,
            projectId: null,
            ...rule
          }))
        });
      }
      return transaction.notificationPreference.findUniqueOrThrow({
        where: { id: existing.id }
      });
    });
    const rules = await this.profileRules(updated.id);
    return preferenceSummary(updated, rules);
  }

  public async getProjectSubscription(
    context: InternalProjectContext
  ): Promise<ProjectNotificationSubscriptionSummary> {
    const preference = await this.ensurePreference(context.actorId);
    const subscription = await this.ensureProjectSubscription(
      preference.id,
      context
    );
    const [profileRules, projectRules] = await Promise.all([
      this.profileRules(preference.id),
      this.projectRules(subscription.id)
    ]);
    return projectSubscriptionSummary(
      preference,
      subscription,
      profileRules,
      projectRules
    );
  }

  public async updateProjectSubscription(
    input: InternalUpdateProjectNotificationSubscriptionInput
  ): Promise<ProjectNotificationSubscriptionSummary> {
    const context: InternalProjectContext = {
      actorId: input.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      membershipId: input.membershipId,
      membershipVersion: input.membershipVersion
    };
    const preference = await this.ensurePreference(input.userId);
    const existing = await this.ensureProjectSubscription(
      preference.id,
      context
    );
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result =
        await transaction.projectNotificationSubscription.updateMany({
          where: {
            id: existing.id,
            status: "ACTIVE",
            version: input.version
          },
          data: {
            mode: input.mode,
            pausedUntil: input.pausedUntil
              ? new Date(input.pausedUntil)
              : null,
            notifyOwnJobs: input.notifyOwnJobs,
            version: { increment: 1 }
          }
        });
      if (result.count !== 1) throw versionConflict();

      await transaction.notificationRule.deleteMany({
        where: { subscriptionId: existing.id }
      });
      if (input.rules.length > 0) {
        await transaction.notificationRule.createMany({
          data: input.rules.map((rule) => ({
            preferenceId: preference.id,
            subscriptionId: existing.id,
            scopeKey: existing.id,
            userId: input.userId,
            projectId: input.projectId,
            ...rule
          }))
        });
      }
      return transaction.projectNotificationSubscription.findUniqueOrThrow({
        where: { id: existing.id }
      });
    });
    const [profileRules, projectRules] = await Promise.all([
      this.profileRules(preference.id),
      this.projectRules(updated.id)
    ]);
    return projectSubscriptionSummary(
      preference,
      updated,
      profileRules,
      projectRules
    );
  }

  private ensurePreference(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: {},
      create: { userId }
    });
  }

  private async ensureProjectSubscription(
    preferenceId: string,
    context: InternalProjectContext
  ) {
    const compound = {
      userId: context.actorId,
      projectId: context.projectId,
      membershipId: context.membershipId,
      membershipVersion: context.membershipVersion
    };
    const subscription = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.projectNotificationSubscription.updateMany({
          where: {
            userId: context.actorId,
            projectId: context.projectId,
            status: "ACTIVE",
            NOT: {
              membershipId: context.membershipId,
              membershipVersion: context.membershipVersion
            }
          },
          data: {
            status: "INACTIVE",
            deactivatedAt: new Date()
          }
        });
        return transaction.projectNotificationSubscription.upsert({
          where: {
            userId_projectId_membershipId_membershipVersion: compound
          },
          update: {
            preferenceId,
            workspaceId: context.workspaceId
          },
          create: {
            ...compound,
            preferenceId,
            workspaceId: context.workspaceId
          }
        });
      }
    );
    if (subscription.status !== "ACTIVE") {
      throw new ConflictException(
        "Project notification subscription belongs to inactive access"
      );
    }
    return subscription;
  }

  private profileRules(preferenceId: string): Promise<StoredRule[]> {
    return this.prisma.notificationRule.findMany({
      where: { preferenceId, subscriptionId: null },
      orderBy: [{ eventType: "asc" }, { channel: "asc" }],
      select: {
        eventType: true,
        channel: true,
        enabled: true,
        minimumSeverity: true,
        deliveryMode: true
      }
    });
  }

  private projectRules(subscriptionId: string): Promise<StoredRule[]> {
    return this.prisma.notificationRule.findMany({
      where: { subscriptionId },
      orderBy: [{ eventType: "asc" }, { channel: "asc" }],
      select: {
        eventType: true,
        channel: true,
        enabled: true,
        minimumSeverity: true,
        deliveryMode: true
      }
    });
  }
}

function deliveryPermission(
  eventType: NotificationEventType
): "project.view" | "page.view" {
  return eventType === "CRAWL_RADAR" ? "page.view" : "project.view";
}

function preferenceSummary(
  preference: StoredPreference,
  storedRules: readonly StoredRule[]
): NotificationPreferencesSummary {
  return {
    userId: preference.userId,
    channels: {
      inApp: preference.inAppEnabled,
      email: preference.emailEnabled,
      webPush: preference.webPushEnabled
    },
    timezone: preference.timezone,
    ...(preference.quietStart && preference.quietEnd
      ? {
          quietHours: {
            start: preference.quietStart,
            end: preference.quietEnd,
            criticalBypass: preference.criticalBypass
          }
        }
      : {}),
    digestTime: preference.digestTime,
    rules: materializeProfileRules(storedRules),
    version: preference.version,
    updatedAt: preference.updatedAt.toISOString()
  };
}

function projectSubscriptionSummary(
  preference: StoredPreference,
  subscription: StoredSubscription,
  profileRules: readonly StoredRule[],
  projectRules: readonly StoredRule[]
): ProjectNotificationSubscriptionSummary {
  return {
    userId: subscription.userId,
    workspaceId: subscription.workspaceId,
    projectId: subscription.projectId,
    membershipId: subscription.membershipId,
    membershipVersion: subscription.membershipVersion,
    mode: subscription.mode,
    ...(subscription.pausedUntil
      ? { pausedUntil: subscription.pausedUntil.toISOString() }
      : {}),
    notifyOwnJobs: subscription.notifyOwnJobs,
    rules: projectRules,
    effectiveRules: resolveEffectiveProjectRules(
      preferenceSummary(preference, profileRules),
      subscription,
      projectRules
    ),
    version: subscription.version,
    updatedAt: subscription.updatedAt.toISOString()
  };
}

function materializeProfileRules(
  storedRules: readonly StoredRule[]
): readonly NotificationRuleSetting[] {
  const stored = ruleMap(storedRules);
  return notificationEventTypes.flatMap((eventType) =>
    notificationChannels.map((channel) => {
      const rule =
        stored.get(ruleKey(eventType, channel)) ??
        defaultRule(eventType, channel);
      if (
        channel === "IN_APP" &&
        ["SECURITY", "BILLING"].includes(eventType)
      ) {
        return { ...rule, enabled: true };
      }
      return rule;
    })
  );
}

export function resolveEffectiveProjectRules(
  preference: NotificationPreferencesSummary,
  subscription: Pick<
    StoredSubscription,
    "mode" | "pausedUntil"
  >,
  projectRules: readonly NotificationRuleSetting[]
): readonly EffectiveProjectNotificationRule[] {
  const profile = ruleMap(preference.rules);
  const project = ruleMap(projectRules);
  const paused =
    subscription.mode === "PAUSED" &&
    Boolean(
      subscription.pausedUntil &&
        subscription.pausedUntil.getTime() > Date.now()
    );

  return projectNotificationEventTypes.flatMap((eventType) =>
    notificationChannels.map((channel) => {
      const inherited =
        profile.get(ruleKey(eventType, channel)) ??
        defaultRule(eventType, channel);
      const override =
        subscription.mode === "OVERRIDE"
          ? project.get(ruleKey(eventType, channel))
          : undefined;
      const selected = override ?? inherited;
      const blockedByProfile =
        !channelEnabled(preference, channel) || !inherited.enabled;
      return {
        ...selected,
        eventType,
        enabled: !paused && !blockedByProfile && selected.enabled,
        source: paused
          ? "PAUSE"
          : override
            ? "PROJECT"
            : "PROFILE",
        blockedByProfile
      };
    })
  );
}

function defaultRule(
  eventType: NotificationEventType,
  channel: NotificationChannel
): NotificationRuleSetting {
  return {
    eventType,
    channel,
    enabled: channel === "IN_APP",
    minimumSeverity: "INFO",
    deliveryMode: "INSTANT"
  };
}

function channelEnabled(
  preference: NotificationPreferencesSummary,
  channel: NotificationChannel
): boolean {
  if (channel === "IN_APP") return preference.channels.inApp;
  if (channel === "EMAIL") return preference.channels.email;
  return preference.channels.webPush;
}

function ruleMap(
  rules: readonly NotificationRuleSetting[]
): Map<string, NotificationRuleSetting> {
  return new Map(
    rules.map((rule) => [
      ruleKey(rule.eventType, rule.channel),
      rule
    ])
  );
}

function ruleKey(
  eventType: NotificationEventType,
  channel: NotificationChannel
): string {
  return `${eventType}:${channel}`;
}

function versionConflict(): ConflictException {
  return new ConflictException(
    "Notification settings were changed in another session"
  );
}

function severityRank(severity: NotificationSeverity): number {
  if (severity === "CRITICAL") return 3;
  if (severity === "WARNING") return 2;
  return 1;
}

function ruleAllows(
  rule: EffectiveProjectNotificationRule | undefined,
  severity: NotificationSeverity
): boolean {
  return Boolean(
    rule?.enabled &&
      severityRank(severity) >= severityRank(rule.minimumSeverity)
  );
}

function pushPayload(
  input: InternalCreateProjectNotificationInput
): Prisma.InputJsonObject {
  return {
    version: 1,
    title: boundedPreview(input.title, 80, "Новое уведомление"),
    body: boundedPreview(
      input.body ?? "Откройте приложение, чтобы посмотреть обновление.",
      220,
      "Откройте приложение, чтобы посмотреть обновление."
    ),
    tag: createHash("sha256")
      .update("seo-platform:web-push:tag:v1", "utf8")
      .update("\0", "utf8")
      .update(input.dedupeKey, "utf8")
      .digest("base64url"),
    deepLink: input.deepLink
  };
}

function boundedPreview(
  value: string,
  maximum: number,
  fallback: string
): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return fallback;
  return [...normalized].slice(0, maximum).join("");
}

function deliveryAvailableAt(
  now: Date,
  preference: StoredPreference,
  mode: NotificationDeliveryMode,
  severity: NotificationSeverity
): Date {
  let availableAt = now;
  if (mode === "HOURLY_DIGEST") {
    availableAt = nextLocalHour(now, preference.timezone);
  } else if (mode === "DAILY_DIGEST") {
    availableAt = nextLocalTime(
      now,
      preference.timezone,
      preference.digestTime
    );
  }
  if (
    preference.quietStart &&
    preference.quietEnd &&
    !(severity === "CRITICAL" && preference.criticalBypass)
  ) {
    const quietEnd = endOfActiveQuietHours(
      availableAt,
      preference.timezone,
      preference.quietStart,
      preference.quietEnd
    );
    if (quietEnd && quietEnd > availableAt) availableAt = quietEnd;
  }
  return availableAt;
}

interface LocalDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function localParts(date: Date, timezone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute")
  };
}

function localDateTimeToUtc(
  parts: LocalDateTimeParts,
  timezone: string
): Date {
  const expected = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
  let candidate = new Date(expected);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = localParts(candidate, timezone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute
    );
    candidate = new Date(candidate.getTime() + expected - observedAsUtc);
  }
  return candidate;
}

function normalizeLocalParts(
  parts: LocalDateTimeParts,
  hour: number,
  minute: number,
  dayOffset = 0
): LocalDateTimeParts {
  const normalized = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, hour, minute)
  );
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
    hour: normalized.getUTCHours(),
    minute: normalized.getUTCMinutes()
  };
}

function nextLocalHour(now: Date, timezone: string): Date {
  const parts = localParts(now, timezone);
  return localDateTimeToUtc(
    normalizeLocalParts(parts, parts.hour + 1, 0),
    timezone
  );
}

function nextLocalTime(
  now: Date,
  timezone: string,
  time: string
): Date {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const parts = localParts(now, timezone);
  let candidate = localDateTimeToUtc(
    normalizeLocalParts(parts, hour, minute),
    timezone
  );
  if (candidate <= now) {
    candidate = localDateTimeToUtc(
      normalizeLocalParts(parts, hour, minute, 1),
      timezone
    );
  }
  return candidate;
}

function endOfActiveQuietHours(
  now: Date,
  timezone: string,
  start: string,
  end: string
): Date | undefined {
  const [startHour = 0, startMinute = 0] = start.split(":").map(Number);
  const [endHour = 0, endMinute = 0] = end.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  const parts = localParts(now, timezone);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const overnight = startMinutes >= endMinutes;
  const active = overnight
    ? currentMinutes >= startMinutes || currentMinutes < endMinutes
    : currentMinutes >= startMinutes && currentMinutes < endMinutes;
  if (!active) return undefined;
  const tomorrow = overnight && currentMinutes >= startMinutes;
  return localDateTimeToUtc(
    normalizeLocalParts(parts, endHour, endMinute, tomorrow ? 1 : 0),
    timezone
  );
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002";
}
