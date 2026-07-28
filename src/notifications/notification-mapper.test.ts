import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  notificationCollectionResponse,
  notificationPreferencesSummary,
  notificationReadAllResult,
  projectNotificationSubscriptionSummary
} from "./notification-mapper.js";

const userId = "01900000-0000-7000-8000-000000000001";
const workspaceId = "01900000-0000-7000-8000-000000000002";
const projectId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";
const rule = {
  eventType: "JOB",
  channel: "IN_APP",
  enabled: true,
  minimumSeverity: "INFO",
  deliveryMode: "INSTANT"
};

test("maps strict profile and project notification responses", () => {
  const profile = notificationPreferencesSummary({
    userId,
    channels: { inApp: true, email: false, webPush: false },
    timezone: "UTC",
    digestTime: "09:00",
    rules: [rule],
    version: 1,
    updatedAt: "2026-07-28T00:00:00.000Z"
  });
  assert.equal(profile.rules[0]?.eventType, "JOB");

  const project = projectNotificationSubscriptionSummary({
    userId,
    workspaceId,
    projectId,
    membershipId,
    membershipVersion: 2,
    mode: "INHERIT",
    notifyOwnJobs: true,
    rules: [],
    effectiveRules: [
      { ...rule, source: "PROFILE", blockedByProfile: false }
    ],
    version: 1,
    updatedAt: "2026-07-28T00:00:00.000Z"
  });
  assert.equal(project.membershipVersion, 2);
});

test("rejects malformed effective notification rules", () => {
  assert.throws(
    () =>
      projectNotificationSubscriptionSummary({
        userId,
        workspaceId,
        projectId,
        membershipId,
        membershipVersion: 1,
        mode: "INHERIT",
        notifyOwnJobs: true,
        rules: [],
        effectiveRules: [
          { ...rule, source: "UNKNOWN", blockedByProfile: false }
        ],
        version: 1,
        updatedAt: "2026-07-28T00:00:00.000Z"
      }),
    DomainError
  );
});

test("maps a strict notification collection and read-all result", () => {
  const response = notificationCollectionResponse({
    data: [
      {
        id: "01900000-0000-7000-8000-000000000010",
        workspaceId,
        projectId,
        eventType: "JOB",
        severity: "WARNING",
        title: "Задание завершено частично",
        body: "Проверьте строки с ошибками",
        deepLink: "/app/jobs/01900000-0000-7000-8000-000000000010",
        createdAt: "2026-07-29T00:00:00.000Z"
      }
    ],
    page: { hasNext: false, unreadCount: 1 },
    meta: { requestId: "request-1" }
  });
  assert.equal(response.data[0]?.severity, "WARNING");
  assert.equal(
    notificationReadAllResult({
      updated: 1,
      readAt: "2026-07-29T00:01:00.000Z"
    }).updated,
    1
  );
});

test("rejects an external notification deep link", () => {
  assert.throws(
    () =>
      notificationCollectionResponse({
        data: [
          {
            id: "01900000-0000-7000-8000-000000000010",
            workspaceId,
            eventType: "JOB",
            severity: "INFO",
            title: "Задание завершено",
            deepLink: "https://evil.example",
            createdAt: "2026-07-29T00:00:00.000Z"
          }
        ],
        page: { hasNext: false, unreadCount: 1 },
        meta: { requestId: "request-1" }
      }),
    DomainError
  );
});
