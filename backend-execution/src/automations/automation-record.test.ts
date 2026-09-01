import assert from "node:assert/strict";
import test from "node:test";
import { storedAutomationDefinition } from "./automation-record.js";

test("drops legacy keyword caps while preserving the per-run charge cap", () => {
  const legacy = definition("rank-tracking-schedule@1");
  const normalized = storedAutomationDefinition(legacy);
  assert.equal(normalized.schemaVersion, "rank-tracking-schedule@3");
  assert.equal(normalized.maxPlatformChargeMicro, "0");
  assert.equal(Object.hasOwn(normalized, "maxItems"), false);

  const previous = storedAutomationDefinition({
    ...definition("rank-tracking-schedule@2"),
    maxPlatformChargeMicro: "12500000"
  });
  assert.equal(previous.maxPlatformChargeMicro, "12500000");
  assert.equal(Object.hasOwn(previous, "maxItems"), false);

  const current = storedAutomationDefinition(currentDefinition());
  assert.equal(current.maxPlatformChargeMicro, "25000000");
});

function definition(schemaVersion: string) {
  return {
    schemaVersion,
    trackingContextId: "01900000-0000-7000-8000-000000000001",
    schedule: { cadence: "DAILY", hour: 2, minute: 0 },
    maxItems: 500,
    failureThreshold: 3,
    execution: {
      actorId: "01900000-0000-7000-8000-000000000002",
      project: {
        id: "01900000-0000-7000-8000-000000000003",
        workspaceId: "01900000-0000-7000-8000-000000000004",
        domain: "example.com",
        status: "ACTIVE",
        version: 4
      },
      access: {
        workspaceStatus: "ACTIVE",
        membershipId: "01900000-0000-7000-8000-000000000005",
        membershipVersion: 3,
        canRunRanking: true,
        entitlementStatus: "ALLOWED"
      },
      billingCurrency: "RUB",
      jobCapacity: {
        planCode: "PRO",
        planVersion: 2,
        concurrentJobs: 4
      }
    }
  };
}

function currentDefinition() {
  const { maxItems: _retiredMaxItems, ...previous } = definition(
    "rank-tracking-schedule@2"
  );
  return {
    ...previous,
    schemaVersion: "rank-tracking-schedule@3",
    maxPlatformChargeMicro: "25000000"
  };
}
