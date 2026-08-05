import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import {
  ConflictException,
  HttpException,
  UnauthorizedException
} from "@nestjs/common";
import type { InternalUpsertWebPushSubscriptionInput } from "@seo-platform/contracts";
import { loadAppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { WebPushSubscription } from "../generated/prisma/client.js";
import type { WebPushCryptoService } from "./web-push-crypto.service.js";
import { WebPushService } from "./web-push.service.js";

const userId = "01900000-0000-7000-8000-000000000001";
const otherUserId = "01900000-0000-7000-8000-000000000002";
const installationId = "10000000-0000-4000-8000-000000000003";
const fingerprint = Buffer.alloc(32, 7);
const input: InternalUpsertWebPushSubscriptionInput = {
  userId,
  sessionFamilyId: "01900000-0000-7000-8000-000000000004",
  browser: "CHROME",
  platform: "MACOS",
  label: "Рабочий браузер",
  intent: "ENABLE",
  applicationServerKeyVersion: 5,
  subscription: {
    endpoint: "https://push.example.test/send/opaque",
    expirationTime: null,
    keys: {
      p256dh: "public-key",
      auth: "auth-secret"
    }
  }
};

test("creates once and returns the same aggregate for an exact PUT replay", async () => {
  let stored: WebPushSubscription | null = null;
  let createCount = 0;
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      findUnique: async () => stored,
      findFirst: async () => stored,
      count: async () => 0,
      create: async () => {
        createCount += 1;
        stored = device();
        return stored;
      },
      update: async () => {
        throw new Error("Exact replay must not update the aggregate");
      }
    }
  };
  const service = serviceWith(transaction);

  const first = await service.upsert(installationId, input);
  const replay = await service.upsert(installationId, input);

  assert.equal(createCount, 1);
  assert.deepEqual(replay, first);
  assert.equal(first.version, 1);
  assert.equal("endpoint" in first, false);
  assert.equal("materialCiphertext" in first, false);
});

test("re-encrypts an exact subscription when active key versions rotate", async () => {
  let updateData: Readonly<Record<string, unknown>> | undefined;
  const current = device({
    encryptionKeyVersion: 2,
    fingerprintKeyVersion: 6
  });
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      findUnique: async () => current,
      findFirst: async () => current,
      update: async ({
        data
      }: {
        data: Readonly<Record<string, unknown>>;
      }) => {
        updateData = data;
        return device({ version: 2 });
      }
    }
  };

  const result = await serviceWith(transaction).upsert(
    installationId,
    input
  );

  assert.equal(result.version, 2);
  assert.equal(updateData?.encryptionKeyVersion, 3);
  assert.equal(updateData?.fingerprintKeyVersion, 7);
});

test("never reparents an endpoint already active on another account", async () => {
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      findUnique: async () => null,
      findFirst: async () => device({ userId: otherUserId })
    }
  };

  await assert.rejects(
    serviceWith(transaction).upsert(installationId, input),
    (error: unknown) =>
      error instanceof ConflictException &&
      responseCode(error) === "PUSH_SUBSCRIPTION_ALREADY_BOUND"
  );
});

test("enforces the active device limit before storing material", async () => {
  let created = false;
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      findUnique: async () => null,
      findFirst: async () => null,
      count: async () => 20,
      create: async () => {
        created = true;
        return device();
      }
    }
  };

  await assert.rejects(
    serviceWith(transaction).upsert(installationId, input),
    (error: unknown) =>
      error instanceof ConflictException &&
      responseCode(error) === "PUSH_DEVICE_LIMIT_REACHED"
  );
  assert.equal(created, false);
});

test("expires due devices before checking endpoint ownership and device cap", async () => {
  let expiredBeforeLookup = false;
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      updateMany: async ({
        where
      }: {
        where: Readonly<Record<string, unknown>>;
      }) => {
        expiredBeforeLookup =
          where.status === "ACTIVE" &&
          "providerExpiresAt" in where;
        return { count: 1 };
      },
      findUnique: async () => {
        assert.equal(expiredBeforeLookup, true);
        return null;
      },
      findFirst: async () => {
        assert.equal(expiredBeforeLookup, true);
        return null;
      },
      count: async () => 19,
      create: async () => device()
    }
  };

  const result = await serviceWith(transaction).upsert(
    installationId,
    input
  );

  assert.equal(result.status, "ACTIVE");
});

test("rejects delayed registration after the session-family event tombstone", async () => {
  const calls: string[] = [];
  const transaction = {
    $queryRaw: async () => {
      calls.push("user-lock");
      return [];
    },
    revokedSessionFamilyTombstone: {
      findUnique: async () => {
        calls.push("tombstone");
        return { userId };
      }
    },
    webPushSubscription: {
      updateMany: async () => {
        calls.push("device-update");
        return { count: 0 };
      },
      findUnique: async () => {
        calls.push("device-read");
        return null;
      },
      create: async () => {
        calls.push("device-create");
        return device();
      }
    }
  };

  await assert.rejects(
    serviceWith(transaction).upsert(installationId, input),
    (error: unknown) =>
      error instanceof UnauthorizedException &&
      responseCode(error) === "UNAUTHENTICATED"
  );
  assert.deepEqual(calls, ["user-lock", "tombstone"]);
});

test("lists every active device before bounded tombstone history", async () => {
  const active = device({
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  });
  const tombstones = Array.from({ length: 101 }, (_, index) =>
    device({
      installationId: `tombstone-${index}`,
      status: "REVOKED",
      statusReason: "USER_REVOKED",
      endpointFingerprint: null,
      materialFingerprint: null,
      materialCiphertext: null,
      materialNonce: null,
      materialAuthTag: null,
      encryptionKeyVersion: null,
      fingerprintKeyVersion: null,
      revokedAt: new Date("2026-07-29T11:00:00.000Z"),
      updatedAt: new Date("2026-07-29T11:00:00.000Z")
    })
  );
  const findManyCalls: Array<Readonly<Record<string, unknown>>> = [];
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      updateMany: async () => ({ count: 0 }),
      findMany: async ({
        where,
        take
      }: {
        where: Readonly<Record<string, unknown>>;
        take: number;
      }) => {
        findManyCalls.push({ where, take });
        return where.status === "ACTIVE"
          ? [active]
          : tombstones.slice(0, take);
      }
    }
  };

  const result = await serviceWith(transaction).list(userId);

  assert.equal(result.devices.length, 100);
  assert.equal(result.devices[0]?.installationId, installationId);
  assert.equal(findManyCalls.length, 2);
  assert.deepEqual(findManyCalls[0]?.where, {
    userId,
    status: "ACTIVE"
  });
  assert.deepEqual(findManyCalls[1]?.where, {
    userId,
    status: { in: ["REVOKED", "EXPIRED"] }
  });
  assert.equal(findManyCalls[1]?.take, 99);
});

test("clears every credential field before confirming revoke", async () => {
  let updateData: Readonly<Record<string, unknown>> | undefined;
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      findUnique: async () => device(),
      updateMany: async ({
        data
      }: {
        data: Readonly<Record<string, unknown>>;
      }) => {
        updateData = data;
        return { count: 1 };
      }
    }
  };

  assert.deepEqual(
    await serviceWith(transaction).revoke(userId, installationId),
    {
      installationId,
      status: "REVOKED",
      revoked: true
    }
  );
  for (const field of [
    "endpointFingerprint",
    "materialFingerprint",
    "materialCiphertext",
    "materialNonce",
    "materialAuthTag",
    "encryptionKeyVersion",
    "fingerprintKeyVersion"
  ]) {
    assert.equal(updateData?.[field], null);
  }
});

test("converts an expired tombstone to revoked when the user removes it", async () => {
  let updateWhere: Readonly<Record<string, unknown>> | undefined;
  let updateData: Readonly<Record<string, unknown>> | undefined;
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      findUnique: async () =>
        device({
          status: "EXPIRED",
          statusReason: "PUSH_SERVICE_GONE",
          endpointFingerprint: null,
          materialFingerprint: null,
          materialCiphertext: null,
          materialNonce: null,
          materialAuthTag: null,
          encryptionKeyVersion: null,
          fingerprintKeyVersion: null,
          expiredAt: new Date("2026-07-29T11:00:00.000Z")
        }),
      updateMany: async ({
        where,
        data
      }: {
        where: Readonly<Record<string, unknown>>;
        data: Readonly<Record<string, unknown>>;
      }) => {
        updateWhere = where;
        updateData = data;
        return { count: 1 };
      }
    }
  };

  const result = await serviceWith(transaction).revoke(
    userId,
    installationId
  );

  assert.deepEqual(result, {
    installationId,
    status: "REVOKED",
    revoked: true
  });
  assert.equal(updateWhere?.status, "EXPIRED");
  assert.equal(updateData?.status, "REVOKED");
  assert.equal(updateData?.statusReason, "USER_REVOKED");
  assert.equal(updateData?.expiredAt, null);
});

test("fails closed when revoke loses its compare-and-swap", async () => {
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      findUnique: async () => device(),
      updateMany: async () => ({ count: 0 })
    }
  };

  await assert.rejects(
    serviceWith(transaction).revoke(userId, installationId),
    (error: unknown) =>
      error instanceof ConflictException &&
      responseCode(error) === "VERSION_CONFLICT"
  );
});

test("rejects a stale rename without changing the device", async () => {
  let updated = false;
  const transaction = {
    $queryRaw: async () => [],
    webPushSubscription: {
      findUnique: async () => device({ version: 3 }),
      update: async () => {
        updated = true;
        return device();
      }
    }
  };

  await assert.rejects(
    serviceWith(transaction).rename(installationId, {
      userId,
      version: 2,
      label: "Новое имя"
    }),
    (error: unknown) =>
      error instanceof ConflictException &&
      responseCode(error) === "VERSION_CONFLICT"
  );
  assert.equal(updated, false);
});

function serviceWith(
  transaction: Readonly<Record<string, unknown>>
): WebPushService {
  const subscriptionModel =
    typeof transaction.webPushSubscription === "object" &&
    transaction.webPushSubscription !== null
      ? transaction.webPushSubscription
      : {};
  const preparedTransaction = {
    ...transaction,
    revokedSessionFamilyTombstone: {
      findUnique: async () => null,
      ...(typeof transaction.revokedSessionFamilyTombstone ===
        "object" &&
      transaction.revokedSessionFamilyTombstone !== null
        ? transaction.revokedSessionFamilyTombstone
        : {})
    },
    webPushSubscription: {
      updateMany: async () => ({ count: 0 }),
      ...subscriptionModel
    }
  };
  const prisma = {
    $transaction: async (
      callback: (
        value: Readonly<Record<string, unknown>>
      ) => Promise<unknown>
    ) => callback(preparedTransaction)
  } as unknown as PrismaService;
  const crypto = {
    encrypt: () => ({
      ciphertext: Buffer.from("ciphertext"),
      nonce: Buffer.alloc(12, 1),
      authTag: Buffer.alloc(16, 2),
      encryptionKeyVersion: 3,
      endpointFingerprint: fingerprint,
      materialFingerprint: fingerprint,
      fingerprintKeyVersion: 7
    }),
    endpointFingerprints: () => [
      { digest: fingerprint, keyVersion: 7 }
    ],
    materialFingerprint: () => ({
      digest: fingerprint,
      keyVersion: 7
    })
  } as unknown as WebPushCryptoService;
  return new WebPushService(prisma, crypto, config());
}

function config() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "p".repeat(32),
    WEB_PUSH_REGISTRATION_ENABLED: "true",
    WEB_PUSH_VAPID_PUBLIC_KEY:
      ecdh.getPublicKey().toString("base64url"),
    WEB_PUSH_VAPID_KEY_VERSION: "5",
    WEB_PUSH_ENDPOINT_ORIGINS: "https://push.example.test",
    WEB_PUSH_SUBSCRIPTION_KEYS:
      `3:${Buffer.alloc(32, 3).toString("base64url")}`,
    WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION: "3",
    WEB_PUSH_FINGERPRINT_KEYS:
      `7:${Buffer.alloc(32, 7).toString("base64url")}`,
    WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION: "7",
    WEB_PUSH_MAX_ACTIVE_DEVICES: "20"
  });
}

function device(
  overrides: Partial<WebPushSubscription> = {}
): WebPushSubscription {
  return {
    id: "01900000-0000-7000-8000-000000000010",
    userId,
    installationId,
    registeredSessionFamilyId: input.sessionFamilyId,
    status: "ACTIVE",
    statusReason: null,
    endpointFingerprint: Uint8Array.from(fingerprint),
    materialFingerprint: Uint8Array.from(fingerprint),
    materialCiphertext: Uint8Array.from(Buffer.from("ciphertext")),
    materialNonce: Uint8Array.from(Buffer.alloc(12, 1)),
    materialAuthTag: Uint8Array.from(Buffer.alloc(16, 2)),
    encryptionKeyVersion: 3,
    fingerprintKeyVersion: 7,
    applicationServerKeyVersion: 5,
    label: input.label,
    browser: "CHROME",
    platform: "MACOS",
    providerExpiresAt: null,
    lastSeenAt: new Date("2026-07-29T10:00:00.000Z"),
    lastDeliveryStatus: "NEVER",
    lastDeliveryAt: null,
    lastDeliveryErrorCode: null,
    revokedAt: null,
    expiredAt: null,
    version: 1,
    createdAt: new Date("2026-07-29T10:00:00.000Z"),
    updatedAt: new Date("2026-07-29T10:00:00.000Z"),
    ...overrides
  };
}

function responseCode(error: HttpException): unknown {
  const response = error.getResponse();
  return typeof response === "object" &&
    response !== null &&
    "code" in response
    ? response.code
    : undefined;
}
