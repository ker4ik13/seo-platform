import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
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
