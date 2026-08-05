import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  createProjectNotificationInput,
  notificationPreferencesInput,
  projectNotificationSubscriptionInput
} from "./notification-input.js";

const userId = "01900000-0000-7000-8000-000000000001";
const workspaceId = "01900000-0000-7000-8000-000000000002";
const projectId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";

test("parses profile notification preferences", () => {
  const result = notificationPreferencesInput({
    userId,
    version: 2,
    channels: { inApp: true, email: true, webPush: false },
    timezone: "Europe/Moscow",
    quietHours: {
      start: "23:00",
      end: "08:00",
      criticalBypass: true
    },
    digestTime: "09:30",
    rules: [
      {
        eventType: "JOB",
        channel: "EMAIL",
        enabled: true,
        minimumSeverity: "WARNING",
        deliveryMode: "DAILY_DIGEST"
      }
    ]
  });

  assert.equal(result.timezone, "Europe/Moscow");
  assert.equal(result.rules[0]?.eventType, "JOB");
});

test("rejects duplicate rules and invalid timezone", () => {
  const rule = {
    eventType: "JOB",
    channel: "EMAIL",
    enabled: true,
    minimumSeverity: "INFO",
    deliveryMode: "INSTANT"
  };
  assert.throws(
    () =>
      notificationPreferencesInput({
        userId,
        version: 1,
        channels: { inApp: true, email: false, webPush: false },
        timezone: "Invalid/Timezone",
        digestTime: "09:00",
        rules: [rule, rule]
      }),
    BadRequestException
  );
});

test("requires a bounded future date when a project is paused", () => {
  assert.throws(
    () =>
      projectNotificationSubscriptionInput({
        userId,
        workspaceId,
        projectId,
        membershipId,
        membershipVersion: 1,
        version: 1,
        mode: "PAUSED",
        notifyOwnJobs: true,
        rules: []
      }),
    BadRequestException
  );
});

test("accepts an exact crawl notification and rejects injected fields", () => {
  const crawlId = "01900000-0000-7000-8000-000000000005";
  const input = {
    userId,
    workspaceId,
    projectId,
    membershipId,
    membershipVersion: 2,
    eventType: "CRAWL_RADAR",
    severity: "WARNING",
    title: "Аудит сайта завершён с замечаниями",
    body: "Обработано страниц: 3, найдено проблем: 2.",
    actorId: userId,
    resource: {
      type: "technical_crawl",
      id: crawlId
    },
    deepLink: `/app/tasks/crawl/${crawlId}`,
    dedupeKey: `crawl:${crawlId}:COMPLETED`,
    ownJob: true
  };
  assert.equal(
    createProjectNotificationInput(input).resource.type,
    "technical_crawl"
  );
  assert.throws(
    () => createProjectNotificationInput({ ...input, secret: "no" }),
    BadRequestException
  );
  assert.equal(
    createProjectNotificationInput({
      ...input,
      deepLink: `/app/projects/${projectId}/pages`
    }).deepLink,
    `/app/projects/${projectId}/pages`
  );
  assert.throws(
    () =>
      createProjectNotificationInput({
        ...input,
        deepLink: "/app/tasks/crawl/01900000-0000-7000-8000-000000000006"
      }),
    BadRequestException
  );
});

test("accepts an exact terminal Job notification", () => {
  const jobId = "01900000-0000-7000-8000-000000000006";
  const parsed = createProjectNotificationInput({
    userId,
    workspaceId,
    projectId,
    membershipId,
    membershipVersion: 2,
    eventType: "JOB",
    severity: "INFO",
    title: "Проверка позиций завершена",
    resource: { type: "job", id: jobId },
    deepLink: `/app/tasks/rank/${jobId}`,
    dedupeKey: `job-notification:${jobId}:COMPLETED`,
    ownJob: true
  });

  assert.equal(parsed.resource.type, "job");
  assert.equal(parsed.resource.id, jobId);
});

test("binds Job links and deduplication keys to the resource id", () => {
  const jobId = "01900000-0000-7000-8000-000000000006";
  const otherJobId = "01900000-0000-7000-8000-000000000007";
  const input = {
    userId,
    workspaceId,
    projectId,
    membershipId,
    membershipVersion: 2,
    eventType: "JOB",
    severity: "ERROR",
    title: "Операция завершилась с ошибкой",
    resource: { type: "job", id: jobId },
    deepLink: `/app/tasks/frequency/${jobId}`,
    dedupeKey: `job-notification:${jobId}:FAILED_FINAL`,
    ownJob: true
  };

  assert.throws(
    () =>
      createProjectNotificationInput({
        ...input,
        deepLink: `/app/tasks/frequency/${otherJobId}`
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      createProjectNotificationInput({
        ...input,
        dedupeKey: `job-notification:${otherJobId}:FAILED_FINAL`
      }),
    BadRequestException
  );
});

test("normalizes only allowlisted historical Job notification titles", () => {
  const migration = readFileSync(
    new URL(
      "../../prisma/migrations/20260805172000_normalize_job_notification_titles/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /WHERE "resource_type" = 'job'/u);
  assert.match(migration, /Проверка позиций: завершено частично/u);
  assert.match(migration, /Сбор частотности: требуется внимание/u);
  assert.doesNotMatch(migration, /LIKE|regexp_replace/iu);
});
