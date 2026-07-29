import {
  ConflictException,
  Injectable
} from "@nestjs/common";
import {
  notificationChannels,
  notificationEventTypes,
  projectNotificationEventTypes,
  type EffectiveProjectNotificationRule,
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
  public constructor(private readonly prisma: PrismaService) {}

  public async getPreferences(
    userId: string
  ): Promise<NotificationPreferencesSummary> {
    const preference = await this.ensurePreference(userId);
    const rules = await this.profileRules(preference.id);
    return preferenceSummary(preference, rules);
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
