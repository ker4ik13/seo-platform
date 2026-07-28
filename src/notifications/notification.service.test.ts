import assert from "node:assert/strict";
import test from "node:test";
import type {
  NotificationPreferencesSummary,
  NotificationRuleSetting
} from "@seo-platform/contracts";
import { resolveEffectiveProjectRules } from "./notification.service.js";

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
