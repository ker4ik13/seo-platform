import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateAutomationInput,
  internalDeleteAutomationInput,
  internalRunAutomationInput
} from "./automation-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const automationId = "01900000-0000-7000-8000-000000000004";
const contextId = "01900000-0000-7000-8000-000000000005";

const trusted = {
  workspaceId,
  projectId,
  actorId,
  project: {
    id: projectId,
    workspaceId,
    domain: "example.com",
    status: "ACTIVE",
    version: 2
  },
  access: {
    workspaceStatus: "ACTIVE",
    membershipId: "01900000-0000-7000-8000-000000000006",
    membershipVersion: 3,
    canRunRanking: true,
    entitlementStatus: "ALLOWED"
  },
  billingCurrency: "RUB",
  jobCapacity: {
    planCode: "TRIAL",
    planVersion: 1,
    concurrentJobs: 1
  }
} as const;

test("accepts Core's exact paid schedule envelope and normalizes weekdays", () => {
  const value = {
    ...trusted,
    name: "Ночной съём",
    trackingContextId: contextId,
    timezone: "Europe/Moscow",
    schedule: {
      cadence: "WEEKLY",
      hour: 3,
      minute: 15,
      weekdays: [5, 1]
    },
    maxPlatformChargeMicro: "12500000",
    failureThreshold: 3,
    enabled: true,
    idempotencyKey: "rank-automation:create:one",
    entitlement: {
      planCode: "TRIAL",
      planVersion: 1,
      scheduledAutomations: 1
    }
  };

  assert.deepEqual(internalCreateAutomationInput(value), {
    ...value,
    schedule: {
      cadence: "WEEKLY",
      hour: 3,
      minute: 15,
      weekdays: [1, 5]
    }
  });
});

test("rejects unsafe schedule, entitlement and unknown fields", () => {
  const base = {
    ...trusted,
    name: "Съём",
    trackingContextId: contextId,
    timezone: "UTC",
    schedule: { cadence: "DAILY", hour: 2, minute: 0 },
    maxPlatformChargeMicro: "0",
    failureThreshold: 3,
    enabled: true,
    idempotencyKey: "rank-automation:create:two",
    entitlement: {
      planCode: "TRIAL",
      planVersion: 1,
      scheduledAutomations: 1
    }
  };
  for (const value of [
    { ...base, timezone: "Invalid/Timezone" },
    { ...base, schedule: { cadence: "DAILY", hour: 24, minute: 0 } },
    { ...base, maxItems: 100 },
    { ...base, maxPlatformChargeMicro: "01" },
    {
      ...base,
      entitlement: { ...base.entitlement, scheduledAutomations: 0 }
    },
    { ...base, credentialSecret: "must-never-cross-boundary" }
  ]) {
    assert.throws(
      () => internalCreateAutomationInput(value),
      BadRequestException
    );
  }
});

test("parses an idempotent manual run command", () => {
  const value = {
    ...trusted,
    automationId,
    expectedVersion: 4,
    idempotencyKey: "rank-automation-run:manual-one"
  };
  assert.deepEqual(internalRunAutomationInput(value), value);
  assert.throws(
    () =>
      internalRunAutomationInput({
        ...value,
        idempotencyKey: "short"
      }),
    BadRequestException
  );
});

test("deletion accepts only tenant identity and the expected version", () => {
  const value = {
    workspaceId,
    projectId,
    actorId,
    automationId,
    expectedVersion: 4
  };
  assert.deepEqual(internalDeleteAutomationInput(value), value);
  assert.throws(
    () => internalDeleteAutomationInput({ ...value, billingCurrency: "RUB" }),
    BadRequestException
  );
});
