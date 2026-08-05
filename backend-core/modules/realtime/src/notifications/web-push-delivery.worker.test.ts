import assert from "node:assert/strict";
import test from "node:test";
import webPush from "web-push";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { WebPushCryptoService } from "./web-push-crypto.service.js";
import { WebPushDeliveryWorker } from "./web-push-delivery.worker.js";

const attemptId = "01900000-0000-7000-8000-000000000001";
const subscriptionId = "01900000-0000-7000-8000-000000000002";
const userId = "01900000-0000-7000-8000-000000000003";
const installationId = "01900000-0000-7000-8000-000000000004";
const sessionFamilyId = "01900000-0000-7000-8000-000000000005";
const workspaceId = "01900000-0000-7000-8000-000000000006";
const projectId = "01900000-0000-7000-8000-000000000007";
const membershipId = "01900000-0000-7000-8000-000000000008";

test("claims, decrypts and completes one durable Web Push attempt", async () => {
  const observed: Array<Readonly<Record<string, unknown>>> = [];
  let sends = 0;
  const worker = new WebPushDeliveryWorker(
    prisma(observed),
    crypto(),
    authorizer(),
    {
      send: async ({ subscription, payload, options }) => {
        sends += 1;
        assert.equal(subscription.endpoint, "https://push.example.test/send/opaque");
        assert.equal(JSON.parse(payload).deepLink, "/app/notifications");
        assert.equal(options.contentEncoding, "aes128gcm");
        return { statusCode: 201, body: "", headers: {} };
      }
    },
    config
  );

  assert.equal(await worker.drainOnce(), 1);
  assert.equal(sends, 1);
  assert.ok(
    observed.some(
      (data) =>
        data.status === "DELIVERED" && data.lastHttpStatus === 201
    )
  );
  assert.ok(
    observed.some((data) => data.lastDeliveryStatus === "DELIVERED")
  );
});

test("410 expires the exact device and cancels its remaining attempts", async () => {
  const observed: Array<Readonly<Record<string, unknown>>> = [];
  const worker = new WebPushDeliveryWorker(
    prisma(observed),
    crypto(),
    authorizer(),
    {
      send: async ({ subscription }) => {
        throw new webPush.WebPushError(
          "gone",
          410,
          {},
          "",
          subscription.endpoint
        );
      }
    },
    config
  );

  assert.equal(await worker.drainOnce(), 1);
  assert.ok(
    observed.some(
      (data) =>
        data.status === "EXPIRED" &&
        data.statusReason === "PUSH_SERVICE_GONE" &&
        data.materialCiphertext === null
    )
  );
  assert.ok(
    observed.some(
      (data) =>
        data.status === "CANCELLED" &&
        data.lastErrorCode === "SUBSCRIPTION_EXPIRED"
    )
  );
});

test("cancels without decrypting or sending when project access was revoked", async () => {
  const observed: Array<Readonly<Record<string, unknown>>> = [];
  let decrypted = false;
  let sends = 0;
  const worker = new WebPushDeliveryWorker(
    prisma(observed),
    {
      decrypt: () => {
        decrypted = true;
        throw new Error("must not decrypt");
      }
    } as unknown as WebPushCryptoService,
    {
      authorize: async () => ({
        authorized: false,
        reason: "ACCESS_REVOKED" as const
      })
    },
    {
      send: async () => {
        sends += 1;
        return { statusCode: 201, body: "", headers: {} };
      }
    },
    config
  );

  assert.equal(await worker.drainOnce(), 1);
  assert.equal(decrypted, false);
  assert.equal(sends, 0);
  assert.ok(
    observed.some(
      (data) =>
        data.status === "CANCELLED" &&
        data.lastErrorCode === "PROJECT_ACCESS_REVOKED"
    )
  );
});

function prisma(
  observed: Array<Readonly<Record<string, unknown>>>
): PrismaService {
  let claims = 0;
  const transaction = {
    $queryRaw: async () => {
      claims += 1;
      return claims === 1 ? [{ id: attemptId }] : [];
    },
    webPushDeliveryAttempt: {
      update: async () => ({
        id: attemptId,
        subscriptionId,
        subscriptionVersion: 4,
        userId,
        attemptCount: 1,
        maxAttempts: 8,
        payloadSnapshot: payload,
        policySnapshot: policy,
        notification: {
          workspaceId,
          projectId,
          eventType: "CRAWL_RADAR" as const,
          severity: "INFO" as const
        }
      }),
      updateMany: async ({ data }: { data: Readonly<Record<string, unknown>> }) => {
        observed.push(data);
        return { count: 1 };
      }
    },
    webPushSubscription: {
      updateMany: async ({ data }: { data: Readonly<Record<string, unknown>> }) => {
        observed.push(data);
        return { count: 1 };
      }
    }
  };
  return {
    $transaction: async (
      callback: (value: typeof transaction) => Promise<unknown>
    ) => callback(transaction),
    webPushDeliveryAttempt: {
      findFirst: async () => ({
        subscription: {
          id: subscriptionId,
          userId,
          installationId,
          registeredSessionFamilyId: sessionFamilyId,
          status: "ACTIVE",
          providerExpiresAt: null,
          version: 4,
          applicationServerKeyVersion: 2,
          materialCiphertext: Uint8Array.from([1]),
          materialNonce: Uint8Array.from({ length: 12 }, () => 2),
          materialAuthTag: Uint8Array.from({ length: 16 }, () => 3),
          encryptionKeyVersion: 5,
          endpointFingerprint: Uint8Array.from({ length: 32 }, () => 4),
          fingerprintKeyVersion: 6
        }
      })
    }
  } as unknown as PrismaService;
}

function authorizer() {
  return {
    authorize: async () => ({
      authorized: true,
      reason: "AUTHORIZED" as const
    })
  };
}

function crypto(): WebPushCryptoService {
  return {
    decrypt: () => ({
      endpoint: "https://push.example.test/send/opaque",
      expirationTime: null,
      keys: {
        p256dh: "p256dh",
        auth: "auth"
      }
    })
  } as unknown as WebPushCryptoService;
}

const payload = {
  version: 1,
  title: "Новое уведомление",
  body: "Откройте приложение, чтобы посмотреть обновление.",
  tag: "notification-test",
  deepLink: "/app/notifications"
};

const policy = {
  version: 1,
  workspaceId,
  projectId,
  eventType: "CRAWL_RADAR",
  membershipId,
  membershipVersion: 3,
  permission: "page.view"
};

const config = {
  webPush: {
    registrationEnabled: true,
    deliveryEnabled: true,
    deliveryAuthorizationTimeoutMs: 5_000,
    applicationServerKey: "public-key",
    vapidPrivateKey: "private-key",
    vapidSubject: "mailto:security@example.test",
    deliveryMaxAttempts: 8,
    deliveryPollIntervalMs: 1_000,
    deliveryLeaseMs: 30_000,
    deliveryRetryBaseMs: 1_000,
    deliveryRetryMaxMs: 300_000,
    deliverySendTimeoutMs: 10_000,
    deliveryTtlSeconds: 3_600,
    expirySweepIntervalMs: 60_000,
    expirySweepBatchSize: 100
  }
} as AppConfig;
