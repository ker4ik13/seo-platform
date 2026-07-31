import assert from "node:assert/strict";
import test from "node:test";
import type {
  InternalCreateProjectNotificationInput,
  NotificationPreferencesSummary,
  NotificationRuleSetting
} from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import {
  NotificationService,
  resolveEffectiveProjectRules
} from "./notification.service.js";

const profile: NotificationPreferencesSummary = {
  userId: "01900000-0000-7000-8000-000000000001",
  channels: { inApp: true, email: false, webPush: true },
  timezone: "UTC",
  digestTime: "09:00",
  rules: [
    rule("JOB", "IN_APP", true),
    rule("JOB", "EMAIL", true),
    rule("JOB", "WEB_PUSH", true)
  ],
  version: 1,
  updatedAt: "2026-07-28T00:00:00.000Z"
};

test("project overrides cannot enable a globally disabled channel", () => {
  const effective = resolveEffectiveProjectRules(
    profile,
    { mode: "OVERRIDE", pausedUntil: null },
    [rule("JOB", "EMAIL", true)]
  );
  const email = effective.find(
    ({ eventType, channel }) =>
      eventType === "JOB" && channel === "EMAIL"
  );
  assert.equal(email?.enabled, false);
  assert.equal(email?.blockedByProfile, true);
  assert.equal(email?.source, "PROJECT");
});

test("an active pause disables project delivery without losing rules", () => {
  const effective = resolveEffectiveProjectRules(
    profile,
    {
      mode: "PAUSED",
      pausedUntil: new Date(Date.now() + 60_000)
    },
    [rule("JOB", "WEB_PUSH", true)]
  );
  assert.equal(
    effective.find(
      ({ eventType, channel }) =>
        eventType === "JOB" && channel === "WEB_PUSH"
    )?.source,
    "PAUSE"
  );
  assert.equal(effective.some(({ enabled }) => enabled), false);
});

test("creates a crawl notification once under the effective in-app policy", async () => {
  let created = 0;
  const service = new NotificationService(
    notificationPrisma({
      notifyOwnJobs: true,
      create: async () => {
        created += 1;
        return { id: "01900000-0000-7000-8000-000000000009" };
      }
    })
  );
  const result = await service.createProjectNotification(
    projectContext,
    crawlNotification
  );
  assert.deepEqual(result, {
    outcome: "CREATED",
    notificationId: "01900000-0000-7000-8000-000000000009"
  });
  assert.equal(created, 1);
});

test("honors the project own-job notification preference", async () => {
  let created = 0;
  const service = new NotificationService(
    notificationPrisma({
      notifyOwnJobs: false,
      create: async () => {
        created += 1;
        return { id: "01900000-0000-7000-8000-000000000009" };
      }
    })
  );
  assert.deepEqual(
    await service.createProjectNotification(
      projectContext,
      crawlNotification
    ),
    { outcome: "SKIPPED", reason: "OWN_JOB_DISABLED" }
  );
  assert.equal(created, 0);
});

function rule(
  eventType: NotificationRuleSetting["eventType"],
  channel: NotificationRuleSetting["channel"],
  enabled: boolean
): NotificationRuleSetting {
  return {
    eventType,
    channel,
    enabled,
    minimumSeverity: "INFO",
    deliveryMode: "INSTANT"
  };
}

const projectContext = {
  actorId: "01900000-0000-7000-8000-000000000001",
  workspaceId: "01900000-0000-7000-8000-000000000002",
  projectId: "01900000-0000-7000-8000-000000000003",
  membershipId: "01900000-0000-7000-8000-000000000004",
  membershipVersion: 1
};

const crawlNotification: InternalCreateProjectNotificationInput = {
  userId: projectContext.actorId,
  workspaceId: projectContext.workspaceId,
  projectId: projectContext.projectId,
  membershipId: projectContext.membershipId,
  membershipVersion: projectContext.membershipVersion,
  eventType: "CRAWL_RADAR",
  severity: "INFO",
  title: "Аудит сайта завершён",
  resource: {
    type: "technical_crawl",
    id: "01900000-0000-7000-8000-000000000005"
  },
  deepLink: `/app/projects/${projectContext.projectId}/pages`,
  dedupeKey:
    "crawl:01900000-0000-7000-8000-000000000005:COMPLETED",
  ownJob: true
};

function notificationPrisma(options: {
  readonly notifyOwnJobs: boolean;
  readonly create: () => Promise<{ readonly id: string }>;
}): PrismaService {
  const preference = {
    id: "01900000-0000-7000-8000-000000000006",
    userId: projectContext.actorId,
    inAppEnabled: true,
    emailEnabled: false,
    webPushEnabled: false,
    timezone: "UTC",
    quietStart: null,
    quietEnd: null,
    criticalBypass: true,
    digestTime: "09:00",
    version: 1,
    updatedAt: new Date("2026-07-31T00:00:00.000Z")
  };
  const subscription = {
    id: "01900000-0000-7000-8000-000000000007",
    preferenceId: preference.id,
    userId: projectContext.actorId,
    workspaceId: projectContext.workspaceId,
    projectId: projectContext.projectId,
    membershipId: projectContext.membershipId,
    membershipVersion: projectContext.membershipVersion,
    mode: "INHERIT",
    pausedUntil: null,
    notifyOwnJobs: options.notifyOwnJobs,
    version: 1,
    updatedAt: new Date("2026-07-31T00:00:00.000Z"),
    status: "ACTIVE"
  };
  const transaction = {
    projectNotificationSubscription: {
      updateMany: async () => ({ count: 0 }),
      upsert: async () => subscription
    }
  };
  return {
    $transaction: async (
      callback: (value: typeof transaction) => Promise<unknown>
    ) => callback(transaction),
    notificationPreference: {
      upsert: async () => preference
    },
    notificationRule: {
      findMany: async () => []
    },
    notification: {
      findUnique: async () => null,
      create: options.create
    }
  } as unknown as PrismaService;
}
