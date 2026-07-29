import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import {
  InvalidSessionFamilyRevokedEventError,
  SessionFamilyRevocationInvariantError,
  SessionFamilyRevocationService
} from "./session-family-revocation.service.js";

const USER_ID = "01900000-0000-7000-8000-000000000001";
const OTHER_USER_ID = "01900000-0000-7000-8000-000000000002";
const FAMILY_ID = "01900000-0000-7000-8000-000000000010";
const OTHER_FAMILY_ID = "01900000-0000-7000-8000-000000000020";
const EVENT_ID = "01900000-0000-7000-8000-000000000100";
const OTHER_EVENT_ID = "01900000-0000-7000-8000-000000000101";
const REVOKED_AT = "2026-07-29T12:00:00.000Z";

test("registration then event terminal-revokes only the matching active family", async () => {
  const store = new FakeRevocationStore([
    activeDevice("matching", USER_ID, FAMILY_ID),
    activeDevice("other-family", USER_ID, OTHER_FAMILY_ID),
    activeDevice("other-user", OTHER_USER_ID, FAMILY_ID),
    revokedDevice("already-terminal", USER_ID, FAMILY_ID)
  ]);
  const service = serviceWith(store);

  const result = await service.handle(event());

  assert.deepEqual(result, {
    status: "PROCESSED",
    revokedDeviceCount: 1
  });
  const matching = store.devices.find(({ id }) => id === "matching");
  assert.ok(matching);
  assert.equal(matching.status, "REVOKED");
  assert.equal(matching.statusReason, "SESSION_REVOKED");
  assert.equal(matching.revokedAt?.toISOString(), REVOKED_AT);
  assert.equal(matching.version, 2);
  assertSecretMaterialDestroyed(matching);
  assert.equal(matching.lastDeliveryStatus, "FAILED");
  assert.equal(
    matching.lastDeliveryAt?.toISOString(),
    "2026-07-29T11:55:00.000Z"
  );
  assert.equal(matching.lastDeliveryErrorCode, "TEMPORARY");
  assert.equal(
    store.devices.find(({ id }) => id === "other-family")?.status,
    "ACTIVE"
  );
  assert.equal(
    store.devices.find(({ id }) => id === "other-user")?.status,
    "ACTIVE"
  );
  assert.equal(
    store.devices.find(({ id }) => id === "already-terminal")?.statusReason,
    "USER_REVOKED"
  );
  assert.equal(store.inbox.size, 1);
  assert.equal(store.tombstones.size, 1);
});

test("checks the inbox before side effects for an exact duplicate delivery", async () => {
  const store = new FakeRevocationStore([
    activeDevice("matching", USER_ID, FAMILY_ID)
  ]);
  const service = serviceWith(store);

  await service.handle(event());
  const attemptsAfterFirst = store.deviceUpdateAttempts;
  const duplicate = await service.handle(event());

  assert.deepEqual(duplicate, {
    status: "DUPLICATE",
    revokedDeviceCount: 0
  });
  assert.equal(store.deviceUpdateAttempts, attemptsAfterFirst);
  assert.equal(store.inbox.size, 1);
  assert.equal(store.tombstones.size, 1);
});

test("accepts a second event ID for an already tombstoned family", async () => {
  const store = new FakeRevocationStore([
    activeDevice("matching", USER_ID, FAMILY_ID)
  ]);
  const service = serviceWith(store);

  await service.handle(event());
  const second = await service.handle(event({ eventId: OTHER_EVENT_ID }));

  assert.deepEqual(second, {
    status: "PROCESSED",
    revokedDeviceCount: 0
  });
  assert.equal(store.inbox.size, 2);
  assert.equal(store.tombstones.size, 1);
  assert.equal(
    store.tombstones.get(scope(USER_ID, FAMILY_ID))?.sourceEventId,
    EVENT_ID
  );
});

test("rejects a second event ID with a different revocation time", async () => {
  const store = new FakeRevocationStore([
    activeDevice("matching", USER_ID, FAMILY_ID)
  ]);
  const service = serviceWith(store);

  await service.handle(event());

  await assert.rejects(
    service.handle(
      event({
        eventId: OTHER_EVENT_ID,
        revokedAt: "2026-07-29T12:00:02.000Z"
      })
    ),
    SessionFamilyRevocationInvariantError
  );
  assert.equal(store.inbox.size, 1);
  assert.equal(store.tombstones.size, 1);
});

test("never applies one event ID to another user or family", async () => {
  const store = new FakeRevocationStore([
    activeDevice("first", USER_ID, FAMILY_ID),
    activeDevice("second", OTHER_USER_ID, OTHER_FAMILY_ID)
  ]);
  const service = serviceWith(store);

  await service.handle(event());
  const attemptsAfterFirst = store.deviceUpdateAttempts;

  await assert.rejects(
    service.handle(
      event({
        userId: OTHER_USER_ID,
        sessionFamilyId: OTHER_FAMILY_ID
      })
    ),
    SessionFamilyRevocationInvariantError
  );
  assert.equal(store.deviceUpdateAttempts, attemptsAfterFirst);
  assert.equal(
    store.devices.find(({ id }) => id === "second")?.status,
    "ACTIVE"
  );
  assert.equal(store.tombstones.size, 1);
});

test("rejects malformed or tenant-scoped envelopes before opening a transaction", async () => {
  const invalidEvents = [
    { ...event(), workspaceId: USER_ID },
    {
      ...event(),
      aggregate: {
        type: "session-family",
        id: OTHER_FAMILY_ID,
        version: 1
      }
    },
    {
      ...event(),
      data: {
        ...event().data,
        email: "must-not-enter-the-event@example.test"
      }
    },
    {
      ...event(),
      producer: "untrusted-service"
    }
  ];

  for (const invalidEvent of invalidEvents) {
    const store = new FakeRevocationStore([]);
    await assert.rejects(
      serviceWith(store).handle(invalidEvent),
      InvalidSessionFamilyRevokedEventError
    );
    assert.equal(store.transactionAttempts, 0);
  }
});

test("rolls back inbox, tombstone and device changes when terminal update fails", async () => {
  const store = new FakeRevocationStore([
    activeDevice("matching", USER_ID, FAMILY_ID)
  ]);
  store.failAfterDeviceUpdate = true;

  await assert.rejects(
    serviceWith(store).handle(event()),
    /simulated terminal update failure/u
  );

  assert.equal(store.inbox.size, 0);
  assert.equal(store.tombstones.size, 0);
  assert.equal(store.devices[0]?.status, "ACTIVE");
  assert.equal(store.devices[0]?.version, 1);
  assert.notEqual(store.devices[0]?.materialCiphertext, null);
});

interface MutableDevice {
  readonly id: string;
  readonly userId: string;
  readonly registeredSessionFamilyId: string;
  status: "ACTIVE" | "REVOKED";
  statusReason: "USER_REVOKED" | "SESSION_REVOKED" | null;
  endpointFingerprint: Uint8Array | null;
  materialFingerprint: Uint8Array | null;
  materialCiphertext: Uint8Array | null;
  materialNonce: Uint8Array | null;
  materialAuthTag: Uint8Array | null;
  encryptionKeyVersion: number | null;
  fingerprintKeyVersion: number | null;
  providerExpiresAt: Date | null;
  lastDeliveryStatus: "NEVER" | "DELIVERED" | "FAILED";
  lastDeliveryAt: Date | null;
  lastDeliveryErrorCode: string | null;
  revokedAt: Date | null;
  expiredAt: Date | null;
  version: number;
}

interface InboxReceipt {
  readonly eventType: string;
  readonly consumer: string;
  readonly scopeKey: string | null;
}

interface Tombstone {
  readonly userId: string;
  readonly sessionFamilyId: string;
  readonly sourceEventId: string;
  readonly revokedAt: Date;
}

class FakeRevocationStore {
  public inbox = new Map<string, InboxReceipt>();
  public tombstones = new Map<string, Tombstone>();
  public devices: MutableDevice[];
  public transactionAttempts = 0;
  public deviceUpdateAttempts = 0;
  public failAfterDeviceUpdate = false;

  public constructor(devices: readonly MutableDevice[]) {
    this.devices = devices.map((device) => structuredClone(device));
  }

  public readonly prisma = {
    $transaction: async <Result>(
      callback: (
        transaction: Readonly<Record<string, unknown>>
      ) => Promise<Result>
    ): Promise<Result> => {
      this.transactionAttempts += 1;
      const inbox = structuredClone(this.inbox);
      const tombstones = structuredClone(this.tombstones);
      const devices = structuredClone(this.devices);
      const transaction = this.transaction(
        inbox,
        tombstones,
        devices
      );
      const result = await callback(transaction);
      this.inbox = inbox;
      this.tombstones = tombstones;
      this.devices = devices;
      return result;
    }
  } as unknown as PrismaService;

  private transaction(
    inbox: Map<string, InboxReceipt>,
    tombstones: Map<string, Tombstone>,
    devices: MutableDevice[]
  ): Readonly<Record<string, unknown>> {
    return {
      $queryRaw: async () => [],
      inboxEvent: {
        findUnique: async ({
          where
        }: {
          where: { eventId: string };
        }) => inbox.get(where.eventId) ?? null,
        create: async ({
          data
        }: {
          data: {
            eventId: string;
            eventType: string;
            consumer: string;
            scopeKey: string;
          };
        }) => {
          if (inbox.has(data.eventId)) {
            throw new Error("duplicate inbox event");
          }
          inbox.set(data.eventId, {
            eventType: data.eventType,
            consumer: data.consumer,
            scopeKey: data.scopeKey
          });
          return data;
        }
      },
      revokedSessionFamilyTombstone: {
        findUnique: async ({
          where
        }: {
          where: {
            userId_sessionFamilyId: {
              userId: string;
              sessionFamilyId: string;
            };
          };
        }) => {
          const key = where.userId_sessionFamilyId;
          return (
            tombstones.get(scope(key.userId, key.sessionFamilyId)) ??
            null
          );
        },
        create: async ({
          data
        }: {
          data: Tombstone;
        }) => {
          tombstones.set(
            scope(data.userId, data.sessionFamilyId),
            structuredClone(data)
          );
          return data;
        }
      },
      webPushSubscription: {
        updateMany: async ({
          where,
          data
        }: {
          where: {
            userId: string;
            registeredSessionFamilyId: string;
            status: "ACTIVE";
          };
          data: Readonly<Record<string, unknown>>;
        }) => {
          this.deviceUpdateAttempts += 1;
          let count = 0;
          for (const device of devices) {
            if (
              device.userId !== where.userId ||
              device.registeredSessionFamilyId !==
                where.registeredSessionFamilyId ||
              device.status !== where.status
            ) {
              continue;
            }
            count += 1;
            applyDeviceMutation(device, data);
          }
          if (this.failAfterDeviceUpdate) {
            throw new Error("simulated terminal update failure");
          }
          return { count };
        }
      }
    };
  }
}

function serviceWith(
  store: FakeRevocationStore
): SessionFamilyRevocationService {
  return new SessionFamilyRevocationService(store.prisma);
}

function event(
  overrides: {
    readonly eventId?: string;
    readonly userId?: string;
    readonly sessionFamilyId?: string;
    readonly revokedAt?: string;
  } = {}
) {
  const sessionFamilyId =
    overrides.sessionFamilyId ?? FAMILY_ID;
  return {
    eventId: overrides.eventId ?? EVENT_ID,
    eventType: "identity.session-family.revoked.v1",
    occurredAt: "2026-07-29T12:00:01.000Z",
    producer: "platform-api",
    traceId: "trace-session-family-revocation",
    aggregate: {
      type: "session-family",
      id: sessionFamilyId,
      version: 1
    },
    data: {
      userId: overrides.userId ?? USER_ID,
      sessionFamilyId,
      revokedAt: overrides.revokedAt ?? REVOKED_AT
    },
    metadata: {}
  };
}

function activeDevice(
  id: string,
  userId: string,
  sessionFamilyId: string
): MutableDevice {
  return {
    id,
    userId,
    registeredSessionFamilyId: sessionFamilyId,
    status: "ACTIVE",
    statusReason: null,
    endpointFingerprint: Uint8Array.from([1]),
    materialFingerprint: Uint8Array.from([2]),
    materialCiphertext: Uint8Array.from([3]),
    materialNonce: Uint8Array.from([4]),
    materialAuthTag: Uint8Array.from([5]),
    encryptionKeyVersion: 3,
    fingerprintKeyVersion: 7,
    providerExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
    lastDeliveryStatus: "FAILED",
    lastDeliveryAt: new Date("2026-07-29T11:55:00.000Z"),
    lastDeliveryErrorCode: "TEMPORARY",
    revokedAt: null,
    expiredAt: null,
    version: 1
  };
}

function revokedDevice(
  id: string,
  userId: string,
  sessionFamilyId: string
): MutableDevice {
  return {
    ...activeDevice(id, userId, sessionFamilyId),
    status: "REVOKED",
    statusReason: "USER_REVOKED",
    endpointFingerprint: null,
    materialFingerprint: null,
    materialCiphertext: null,
    materialNonce: null,
    materialAuthTag: null,
    encryptionKeyVersion: null,
    fingerprintKeyVersion: null,
    providerExpiresAt: null,
    revokedAt: new Date("2026-07-29T11:00:00.000Z")
  };
}

function applyDeviceMutation(
  device: MutableDevice,
  data: Readonly<Record<string, unknown>>
): void {
  for (const [key, value] of Object.entries(data)) {
    if (key === "version") {
      const increment =
        typeof value === "object" &&
        value !== null &&
        "increment" in value
          ? Number(value.increment)
          : 0;
      device.version += increment;
      continue;
    }
    Reflect.set(device, key, value);
  }
}

function assertSecretMaterialDestroyed(device: MutableDevice): void {
  for (const field of [
    "endpointFingerprint",
    "materialFingerprint",
    "materialCiphertext",
    "materialNonce",
    "materialAuthTag",
    "encryptionKeyVersion",
    "fingerprintKeyVersion",
    "providerExpiresAt"
  ] as const) {
    assert.equal(device[field], null, `${field} must be destroyed`);
  }
}

function scope(userId: string, sessionFamilyId: string): string {
  return `${userId}:${sessionFamilyId}`;
}
