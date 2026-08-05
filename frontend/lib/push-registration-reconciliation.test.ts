import assert from "node:assert/strict";
import test from "node:test";
import type { WebPushSubscriptionInput } from "@seo-platform/contracts";
import {
  withCompletedPushReconciliation,
  withRequestedPushReconciliation,
  type PushInstallationRecord
} from "./push-installation.ts";
import {
  settlePushRegistrationReconciliation,
  type PushRegistrationReconciliationActions
} from "./push-registration-reconciliation.ts";

const ownerUserId = "01900000-0000-7000-8000-000000000001";
const installationId = "01900000-0000-7000-8000-000000000002";
const sentSubscription: WebPushSubscriptionInput = {
  endpoint: "https://push.example.test/subscription-a",
  expirationTime: null,
  keys: {
    p256dh: "sent-public-key",
    auth: "sent-auth-secret"
  }
};

test("re-arms a completed generation when a delayed PUT stored stale material", async () => {
  let stored: PushInstallationRecord = record({
    reconcileGeneration: 4,
    reconciledGeneration: 4
  });
  let requestCount = 0;
  let completeCount = 0;
  const actions: PushRegistrationReconciliationActions = {
    request: async (expectedOwner, expectedInstallation) => {
      requestCount += 1;
      stored = withRequestedPushReconciliation(
        stored,
        expectedOwner,
        expectedInstallation,
        () => "2026-07-29T17:00:00.000Z"
      );
      return {
        record: stored,
        generation: stored.reconcileGeneration
      };
    },
    complete: async () => {
      completeCount += 1;
      return { record: stored, cleared: true };
    }
  };

  const result = await settlePushRegistrationReconciliation(
    {
      ownerUserId,
      installationId,
      sentGeneration: 3,
      sentSubscription,
      currentSubscription: browserSubscription(
        "https://push.example.test/subscription-b"
      )
    },
    actions
  );

  assert.equal(result.status, "REARMED_AFTER_LOCAL_CHANGE");
  assert.equal(requestCount, 1);
  assert.equal(completeCount, 0);
  assert.equal(result.record.reconcileGeneration, 5);
  assert.equal(result.record.reconciledGeneration, 4);
});

test("completes only the generation whose exact subscription remains current", async () => {
  let stored = record({
    reconcileGeneration: 3,
    reconciledGeneration: 2
  });
  let requestCount = 0;
  const actions: PushRegistrationReconciliationActions = {
    request: async () => {
      requestCount += 1;
      return { record: stored, generation: stored.reconcileGeneration };
    },
    complete: async (
      expectedOwner,
      expectedInstallation,
      expectedGeneration
    ) => {
      const completion = withCompletedPushReconciliation(
        stored,
        expectedOwner,
        expectedInstallation,
        expectedGeneration,
        () => "2026-07-29T17:00:00.000Z"
      );
      stored = completion.record;
      return completion;
    }
  };

  const result = await settlePushRegistrationReconciliation(
    {
      ownerUserId,
      installationId,
      sentGeneration: 3,
      sentSubscription: {
        ...sentSubscription,
        keys: {
          p256dh: Buffer.from(publicKey()).toString("base64url"),
          auth: Buffer.alloc(16, 2).toString("base64url")
        }
      },
      currentSubscription: browserSubscription(sentSubscription.endpoint)
    },
    actions
  );

  assert.equal(result.status, "COMPLETED");
  assert.equal(requestCount, 0);
  assert.equal(result.record.reconcileGeneration, 3);
  assert.equal(result.record.reconciledGeneration, 3);
});

function record(
  overrides: Partial<PushInstallationRecord>
): PushInstallationRecord {
  return {
    schemaVersion: 2,
    installationId,
    ownerUserId,
    reconcileGeneration: 1,
    reconciledGeneration: 0,
    updatedAt: "2026-07-29T16:00:00.000Z",
    ...overrides
  };
}

function browserSubscription(endpoint: string) {
  const p256dh = publicKey();
  const auth = Buffer.alloc(16, 2);
  return {
    endpoint,
    expirationTime: null,
    getKey(name: "p256dh" | "auth") {
      const value = name === "p256dh" ? p256dh : auth;
      return Uint8Array.from(value).buffer;
    }
  };
}

function publicKey(): Buffer {
  return Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 1)]);
}
