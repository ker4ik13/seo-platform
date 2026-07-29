import {
  createHash,
  timingSafeEqual
} from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  InternalRenameWebPushDeviceInput,
  InternalUpsertWebPushSubscriptionInput,
  WebPushDeviceSummary,
  WebPushRevokeResult,
  WebPushSubscriptionsState
} from "@seo-platform/contracts";
import type {
  Prisma,
  WebPushSubscription
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { WebPushCryptoService } from "./web-push-crypto.service.js";
import type { EncryptedWebPushMaterial } from "./web-push-crypto.service.js";

const MAX_RETURNED_DEVICES = 100;

@Injectable()
export class WebPushService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: WebPushCryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async list(userId: string): Promise<WebPushSubscriptionsState> {
    await this.expireDueSubscriptions(userId);
    const devices = await this.prisma.webPushSubscription.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: MAX_RETURNED_DEVICES
    });
    return {
      registration: this.registrationState(),
      devices: devices.map(deviceSummary)
    };
  }

  public async upsert(
    installationId: string,
    input: InternalUpsertWebPushSubscriptionInput
  ): Promise<WebPushDeviceSummary> {
    this.assertRegistrationAvailable(
      input.applicationServerKeyVersion
    );
    const context = {
      userId: input.userId,
      installationId,
      sessionFamilyId: input.sessionFamilyId,
      applicationServerKeyVersion:
        input.applicationServerKeyVersion
    };
    const encrypted = this.crypto.encrypt(context, input.subscription);
    const storedEncrypted = encryptedForDatabase(encrypted);
    const endpointFingerprints = this.crypto.endpointFingerprints(
      input.subscription.endpoint
    );
    const endpointLock = advisoryKey(
      "web-push:endpoint",
      input.subscription.endpoint
    );

    try {
      const device = await this.prisma.$transaction(
        async (transaction) => {
          await acquireLock(
            transaction,
            advisoryKey("web-push:user", input.userId)
          );
          await acquireLock(transaction, endpointLock);

          const current =
            await transaction.webPushSubscription.findUnique({
              where: {
                userId_installationId: {
                  userId: input.userId,
                  installationId
                }
              }
            });
          const bound =
            await transaction.webPushSubscription.findFirst({
              where: {
                status: "ACTIVE",
                OR: endpointFingerprints.map((fingerprint) => ({
                  fingerprintKeyVersion: fingerprint.keyVersion,
                  endpointFingerprint: databaseBytes(
                    fingerprint.digest
                  )
                }))
              }
            });
          if (bound && bound.id !== current?.id) {
            throw subscriptionAlreadyBound();
          }

          if (current?.status === "ACTIVE") {
            if (
              sameMaterial(
                current,
                this.crypto.materialFingerprint(
                  input.subscription,
                  requiredFingerprintKeyVersion(current)
                ).digest
              ) &&
              current.registeredSessionFamilyId ===
                input.sessionFamilyId &&
              current.applicationServerKeyVersion ===
                input.applicationServerKeyVersion &&
              current.encryptionKeyVersion ===
                encrypted.encryptionKeyVersion &&
              current.fingerprintKeyVersion ===
                encrypted.fingerprintKeyVersion
            ) {
              return current;
            }
            return transaction.webPushSubscription.update({
              where: { id: current.id, version: current.version },
              data: {
                registeredSessionFamilyId: input.sessionFamilyId,
                endpointFingerprint:
                  storedEncrypted.endpointFingerprint,
                materialFingerprint:
                  storedEncrypted.materialFingerprint,
                materialCiphertext:
                  storedEncrypted.materialCiphertext,
                materialNonce: storedEncrypted.materialNonce,
                materialAuthTag: storedEncrypted.materialAuthTag,
                encryptionKeyVersion:
                  encrypted.encryptionKeyVersion,
                fingerprintKeyVersion:
                  encrypted.fingerprintKeyVersion,
                applicationServerKeyVersion:
                  input.applicationServerKeyVersion,
                providerExpiresAt: providerExpiration(
                  input.subscription.expirationTime
                ),
                lastSeenAt: new Date(),
                version: { increment: 1 }
              }
            });
          }

          if (
            current?.status === "REVOKED" &&
            input.intent === "RECONCILE"
          ) {
            throw explicitEnableRequired();
          }
          const activeCount =
            await transaction.webPushSubscription.count({
              where: { userId: input.userId, status: "ACTIVE" }
            });
          if (activeCount >= this.config.webPush.maxActiveDevices) {
            throw deviceLimitReached();
          }

          const activeData = {
            registeredSessionFamilyId: input.sessionFamilyId,
            status: "ACTIVE" as const,
            statusReason: null,
            endpointFingerprint: storedEncrypted.endpointFingerprint,
            materialFingerprint: storedEncrypted.materialFingerprint,
            materialCiphertext: storedEncrypted.materialCiphertext,
            materialNonce: storedEncrypted.materialNonce,
            materialAuthTag: storedEncrypted.materialAuthTag,
            encryptionKeyVersion: encrypted.encryptionKeyVersion,
            fingerprintKeyVersion: encrypted.fingerprintKeyVersion,
            applicationServerKeyVersion:
              input.applicationServerKeyVersion,
            label: input.label,
            browser: input.browser,
            platform: input.platform,
            providerExpiresAt: providerExpiration(
              input.subscription.expirationTime
            ),
            lastSeenAt: new Date(),
            lastDeliveryStatus: "NEVER" as const,
            lastDeliveryAt: null,
            lastDeliveryErrorCode: null,
            revokedAt: null,
            expiredAt: null
          };
          if (current) {
            return transaction.webPushSubscription.update({
              where: { id: current.id, version: current.version },
              data: {
                ...activeData,
                version: { increment: 1 }
              }
            });
          }
          return transaction.webPushSubscription.create({
            data: {
              userId: input.userId,
              installationId,
              ...activeData
            }
          });
        }
      );
      return deviceSummary(device);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw subscriptionAlreadyBound();
      }
      throw error;
    }
  }

  public async rename(
    installationId: string,
    input: InternalRenameWebPushDeviceInput
  ): Promise<WebPushDeviceSummary> {
    const device = await this.prisma.$transaction(async (transaction) => {
      await acquireLock(
        transaction,
        advisoryKey("web-push:user", input.userId)
      );
      const current =
        await transaction.webPushSubscription.findUnique({
          where: {
            userId_installationId: {
              userId: input.userId,
              installationId
            }
          }
        });
      if (!current || current.status !== "ACTIVE") throw notFound();
      if (current.version !== input.version) throw versionConflict();
      if (current.label === input.label) return current;
      return transaction.webPushSubscription.update({
        where: { id: current.id, version: current.version },
        data: {
          label: input.label,
          version: { increment: 1 }
        }
      });
    });
    return deviceSummary(device);
  }

  public async revoke(
    userId: string,
    installationId: string
  ): Promise<WebPushRevokeResult> {
    return this.prisma.$transaction(async (transaction) => {
      await acquireLock(
        transaction,
        advisoryKey("web-push:user", userId)
      );
      const current =
        await transaction.webPushSubscription.findUnique({
          where: {
            userId_installationId: { userId, installationId }
          }
        });
      if (!current) throw notFound();
      if (current.status !== "ACTIVE") {
        return {
          installationId,
          status: "REVOKED",
          revoked: false
        };
      }
      const result =
        await transaction.webPushSubscription.updateMany({
          where: {
            id: current.id,
            userId,
            status: "ACTIVE",
            version: current.version
          },
          data: {
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
            revokedAt: new Date(),
            expiredAt: null,
            version: { increment: 1 }
          }
        });
      return {
        installationId,
        status: "REVOKED",
        revoked: result.count === 1
      };
    });
  }

  private registrationState(): WebPushSubscriptionsState["registration"] {
    if (
      !this.config.webPush.registrationEnabled ||
      !this.config.webPush.applicationServerKey ||
      this.config.webPush.applicationServerKeyVersion === undefined
    ) {
      return {
        status: "DISABLED",
        reason: "SERVER_NOT_CONFIGURED",
        maxActiveDevices: this.config.webPush.maxActiveDevices,
        deliveryAvailable: false,
        testDeliveryAvailable: false
      };
    }
    return {
      status: "AVAILABLE",
      applicationServerKey:
        this.config.webPush.applicationServerKey,
      applicationServerKeyVersion:
        this.config.webPush.applicationServerKeyVersion,
      maxActiveDevices: this.config.webPush.maxActiveDevices,
      deliveryAvailable: false,
      testDeliveryAvailable: false
    };
  }

  private async expireDueSubscriptions(userId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await acquireLock(
        transaction,
        advisoryKey("web-push:user", userId)
      );
      await transaction.webPushSubscription.updateMany({
        where: {
          userId,
          status: "ACTIVE",
          providerExpiresAt: { lte: new Date() }
        },
        data: {
          status: "EXPIRED",
          statusReason: "PUSH_SERVICE_GONE",
          endpointFingerprint: null,
          materialFingerprint: null,
          materialCiphertext: null,
          materialNonce: null,
          materialAuthTag: null,
          encryptionKeyVersion: null,
          fingerprintKeyVersion: null,
          providerExpiresAt: null,
          revokedAt: null,
          expiredAt: new Date(),
          version: { increment: 1 }
        }
      });
    });
  }

  private assertRegistrationAvailable(
    applicationServerKeyVersion: number
  ): void {
    if (
      !this.config.webPush.registrationEnabled ||
      !this.config.webPush.applicationServerKey ||
      this.config.webPush.applicationServerKeyVersion === undefined
    ) {
      throw webPushUnavailable();
    }
    if (
      applicationServerKeyVersion !==
      this.config.webPush.applicationServerKeyVersion
    ) {
      throw vapidKeyVersionChanged();
    }
  }
}

function deviceSummary(
  device: WebPushSubscription
): WebPushDeviceSummary {
  return {
    installationId: device.installationId,
    label: device.label,
    status: device.status,
    ...(device.statusReason
      ? { statusReason: device.statusReason }
      : {}),
    browser: device.browser as WebPushDeviceSummary["browser"],
    platform: device.platform as WebPushDeviceSummary["platform"],
    applicationServerKeyVersion:
      device.applicationServerKeyVersion,
    ...(device.providerExpiresAt
      ? { expirationAt: device.providerExpiresAt.toISOString() }
      : {}),
    lastDeliveryStatus: device.lastDeliveryStatus,
    ...(device.lastDeliveryAt
      ? { lastDeliveryAt: device.lastDeliveryAt.toISOString() }
      : {}),
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
    ...(device.revokedAt
      ? { revokedAt: device.revokedAt.toISOString() }
      : {}),
    ...(device.expiredAt
      ? { expiredAt: device.expiredAt.toISOString() }
      : {}),
    version: device.version
  };
}

function providerExpiration(value: number | null): Date | null {
  return value === null ? null : new Date(value);
}

function encryptedForDatabase(
  encrypted: EncryptedWebPushMaterial
): {
  readonly endpointFingerprint: Uint8Array<ArrayBuffer>;
  readonly materialFingerprint: Uint8Array<ArrayBuffer>;
  readonly materialCiphertext: Uint8Array<ArrayBuffer>;
  readonly materialNonce: Uint8Array<ArrayBuffer>;
  readonly materialAuthTag: Uint8Array<ArrayBuffer>;
} {
  return {
    endpointFingerprint: databaseBytes(
      encrypted.endpointFingerprint
    ),
    materialFingerprint: databaseBytes(
      encrypted.materialFingerprint
    ),
    materialCiphertext: databaseBytes(encrypted.ciphertext),
    materialNonce: databaseBytes(encrypted.nonce),
    materialAuthTag: databaseBytes(encrypted.authTag)
  };
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function requiredFingerprintKeyVersion(
  device: WebPushSubscription
): number {
  if (device.fingerprintKeyVersion === null) {
    throw webPushUnavailable();
  }
  return device.fingerprintKeyVersion;
}

function sameMaterial(
  device: WebPushSubscription,
  candidate: Buffer
): boolean {
  if (!device.materialFingerprint) throw webPushUnavailable();
  const stored = Buffer.from(device.materialFingerprint);
  return (
    stored.length === candidate.length &&
    timingSafeEqual(stored, candidate)
  );
}

function advisoryKey(namespace: string, value: string): readonly [number, number] {
  const digest = createHash("sha256")
    .update(namespace, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

async function acquireLock(
  transaction: Prisma.TransactionClient,
  key: readonly [number, number]
): Promise<void> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${key[0]}::integer,
      ${key[1]}::integer
    )
  `;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

function subscriptionAlreadyBound(): ConflictException {
  return conflict(
    "PUSH_SUBSCRIPTION_ALREADY_BOUND",
    "This browser subscription must be recreated"
  );
}

function deviceLimitReached(): ConflictException {
  return conflict(
    "PUSH_DEVICE_LIMIT_REACHED",
    "The active browser device limit has been reached"
  );
}

function explicitEnableRequired(): ConflictException {
  return conflict(
    "EXPLICIT_ENABLE_REQUIRED",
    "An explicitly revoked device requires user confirmation"
  );
}

function versionConflict(): ConflictException {
  return conflict(
    "VERSION_CONFLICT",
    "The browser device changed in another session"
  );
}

function vapidKeyVersionChanged(): ConflictException {
  return conflict(
    "VAPID_KEY_VERSION_CHANGED",
    "The browser subscription must use the active application key"
  );
}

function notFound(): NotFoundException {
  return new NotFoundException({
    code: "NOT_FOUND",
    message: "Browser device was not found"
  });
}

function webPushUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: "WEB_PUSH_UNAVAILABLE",
    message: "Web Push registration is unavailable"
  });
}
