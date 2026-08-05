import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  updateNotificationPreferencesInput,
  updateProjectNotificationSubscriptionInput
} from "./notification-input.js";

test("parses profile notification settings", () => {
  const result = updateNotificationPreferencesInput({
    channels: { inApp: true, email: true, webPush: false },
    timezone: "Europe/Moscow",
    quietHours: {
      start: "23:00",
      end: "08:00",
      criticalBypass: true
    },
    digestTime: "09:00",
    rules: []
  });
  assert.equal(result.quietHours?.start, "23:00");
});

test("rejects project pause without a future date", () => {
  assert.throws(
    () =>
      updateProjectNotificationSubscriptionInput({
        mode: "PAUSED",
        notifyOwnJobs: true,
        rules: []
      }),
    DomainError
  );
});
