import { randomInt, randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown
} from "@nestjs/common";
import webPush from "web-push";
import {
  projectNotificationEventTypes,
  type InternalAuthorizeProjectNotificationDeliveryInput,
  type ProjectNotificationEventType
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { WebPushCryptoService } from "./web-push-crypto.service.js";
import {
  WEB_PUSH_TRANSPORT,
  type WebPushTransport
} from "./web-push-transport.js";
import {
  PROJECT_DELIVERY_AUTHORIZER,
  type ProjectDeliveryAuthorizer
} from "./project-delivery-authorizer.js";

const MAX_DISPATCHES_PER_TICK = 25;
const PAYLOAD_KEYS = new Set([
  "version",
  "title",
  "body",
  "tag",
  "deepLink"
]);
const FORBIDDEN_PREVIEW_CHARACTERS =
  /[\p{Cc}\p{Cf}\u202a-\u202e\u2066-\u2069]/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface ClaimedAttempt {
  readonly id: string;
  readonly subscriptionId: string;
  readonly subscriptionVersion: number;
  readonly userId: string;
  readonly leaseToken: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly payloadSnapshot: Prisma.JsonValue;
  readonly policySnapshot: Prisma.JsonValue;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly eventType: ProjectNotificationEventType;
  readonly severity: "INFO" | "WARNING" | "CRITICAL";
}

interface AuthorizedDelivery extends ClaimedAttempt {
  readonly installationId: string;
  readonly sessionFamilyId: string;
  readonly applicationServerKeyVersion: number;
  readonly encrypted: {
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly authTag: Uint8Array;
    readonly encryptionKeyVersion: number;
    readonly endpointFingerprint: Uint8Array;
    readonly fingerprintKeyVersion: number;
  };
}

interface DeliveryFailure {
  readonly code: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly subscriptionGone: boolean;
  readonly retryAfterMs?: number;
}

@Injectable()
export class WebPushDeliveryWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WebPushDeliveryWorker.name);
  private deliveryTimer?: NodeJS.Timeout;
  private expiryTimer?: NodeJS.Timeout;
  private dispatching = false;
  private sweeping = false;
  private stopping = false;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: WebPushCryptoService,
    @Inject(PROJECT_DELIVERY_AUTHORIZER)
    private readonly projectAuthorizer: ProjectDeliveryAuthorizer,
    @Inject(WEB_PUSH_TRANSPORT)
    private readonly transport: WebPushTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public onApplicationBootstrap(): void {
    if (this.config.webPush.deliveryEnabled) {
      this.deliveryTimer = setInterval(() => {
        void this.drainOnce();
      }, this.config.webPush.deliveryPollIntervalMs);
      void this.drainOnce();
    }
    if (this.config.webPush.deliveryEnabled) {
      this.expiryTimer = setInterval(() => {
        void this.sweepExpiredOnce();
      }, this.config.webPush.expirySweepIntervalMs);
      void this.sweepExpiredOnce();
    }
  }

  public onApplicationShutdown(): void {
    this.stopping = true;
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  public async drainOnce(): Promise<number> {
    if (
      !this.config.webPush.deliveryEnabled ||
      this.dispatching ||
      this.stopping
    ) {
      return 0;
    }
    this.dispatching = true;
    let processed = 0;
    try {
      for (
        let index = 0;
        index < MAX_DISPATCHES_PER_TICK && !this.stopping;
        index += 1
      ) {
        const claimed = await this.claimNext();
        if (!claimed) break;
        processed += 1;
        await this.deliver(claimed);
      }
    } catch {
      this.logger.error("Web Push delivery tick failed");
    } finally {
      this.dispatching = false;
    }
    return processed;
  }

  public async sweepExpiredOnce(): Promise<number> {
    if (
      !this.config.webPush.deliveryEnabled ||
      this.sweeping ||
      this.stopping
    ) {
      return 0;
    }
    this.sweeping = true;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const due = await transaction.webPushSubscription.findMany({
          where: {
            status: "ACTIVE",
            providerExpiresAt: { lte: new Date() }
          },
          orderBy: [{ providerExpiresAt: "asc" }, { id: "asc" }],
          take: this.config.webPush.expirySweepBatchSize,
          select: { id: true }
        });
        if (due.length === 0) return 0;
        const ids = due.map(({ id }) => id);
        const expiredAt = new Date();
        const result = await transaction.webPushSubscription.updateMany({
          where: { id: { in: ids }, status: "ACTIVE" },
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
            expiredAt,
            version: { increment: 1 }
          }
        });
        await transaction.webPushDeliveryAttempt.updateMany({
          where: {
            subscriptionId: { in: ids },
            status: {
              in: ["PENDING", "RETRY_SCHEDULED", "CLAIMED"]
            }
          },
          data: {
            status: "CANCELLED",
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: "SUBSCRIPTION_EXPIRED",
            terminalAt: expiredAt
          }
        });
        return result.count;
      });
    } catch {
      this.logger.error("Web Push provider-expiry sweep failed");
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  private async claimNext(): Promise<ClaimedAttempt | undefined> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(
      Date.now() + this.config.webPush.deliveryLeaseMs
    );
    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<
        readonly {
          readonly id: string;
          readonly status: "PENDING" | "RETRY_SCHEDULED" | "CLAIMED";
          readonly attemptCount: number;
          readonly maxAttempts: number;
        }[]
      >`
        SELECT
          "id",
          "status",
          "attempt_count" AS "attemptCount",
          "max_attempts" AS "maxAttempts"
        FROM "web_push_delivery_attempts"
        WHERE (
          (
            "status" IN (
              'PENDING'::"WebPushDeliveryAttemptStatus",
              'RETRY_SCHEDULED'::"WebPushDeliveryAttemptStatus"
            )
            AND "attempt_count" < "max_attempts"
            AND "available_at" <= CURRENT_TIMESTAMP
          )
          OR (
            "status" = 'CLAIMED'::"WebPushDeliveryAttemptStatus"
            AND "lease_expires_at" <= CURRENT_TIMESTAMP
            AND "attempt_count" <= "max_attempts"
          )
        )
        ORDER BY "available_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const candidate = candidates[0];
      if (!candidate) return undefined;
      const attempt = await transaction.webPushDeliveryAttempt.update({
        where: { id: candidate.id },
        data: {
          status: "CLAIMED",
          attemptCount:
            candidate.status === "CLAIMED"
              ? candidate.attemptCount
              : { increment: 1 },
          leaseToken,
          leaseExpiresAt,
          lastHttpStatus: null,
          lastErrorCode: null
        },
        select: {
          id: true,
          subscriptionId: true,
          subscriptionVersion: true,
          userId: true,
          attemptCount: true,
          maxAttempts: true,
          payloadSnapshot: true,
          policySnapshot: true,
          notification: {
            select: {
              workspaceId: true,
              projectId: true,
              eventType: true,
              severity: true
            }
          }
        }
      });
      return {
        id: attempt.id,
        subscriptionId: attempt.subscriptionId,
        subscriptionVersion: attempt.subscriptionVersion,
        userId: attempt.userId,
        leaseToken,
        attemptCount: attempt.attemptCount,
        maxAttempts: attempt.maxAttempts,
        payloadSnapshot: attempt.payloadSnapshot,
        policySnapshot: attempt.policySnapshot,
        workspaceId: attempt.notification.workspaceId,
        projectId: attempt.notification.projectId,
        eventType:
          attempt.notification.eventType as ProjectNotificationEventType,
        severity: attempt.notification.severity
      };
    });
  }

  private async deliver(claimed: ClaimedAttempt): Promise<void> {
    const authorized = await this.authorize(claimed);
    if (!authorized) {
      await this.cancel(claimed, "SUBSCRIPTION_CHANGED");
      return;
    }
    let deliveryScope: InternalAuthorizeProjectNotificationDeliveryInput;
    try {
      deliveryScope = authorizationScope(authorized);
    } catch {
      await this.failFinal(authorized, {
        code: "INVALID_POLICY_SNAPSHOT",
        retryable: false,
        subscriptionGone: false
      }, false);
      return;
    }
    try {
      const decision = await this.projectAuthorizer.authorize(deliveryScope);
      if (!decision.authorized) {
        await this.cancel(authorized, `PROJECT_${decision.reason}`);
        return;
      }
    } catch {
      const failure = {
        code: "DELIVERY_AUTHORIZATION_UNAVAILABLE",
        retryable: true,
        subscriptionGone: false
      } as const;
      if (authorized.attemptCount < authorized.maxAttempts) {
        await this.retry(authorized, failure, false);
      } else {
        await this.failFinal(authorized, failure, false);
      }
      return;
    }
    let payload: string;
    try {
      payload = JSON.stringify(pushPayload(authorized.payloadSnapshot));
      if (Buffer.byteLength(payload, "utf8") > 4_096) {
        throw new Error("payload too large");
      }
    } catch {
      await this.failFinal(claimed, {
        code: "INVALID_PAYLOAD_SNAPSHOT",
        retryable: false,
        subscriptionGone: false
      });
      return;
    }
    let material;
    try {
      material = this.crypto.decrypt(
        {
          userId: authorized.userId,
          installationId: authorized.installationId,
          sessionFamilyId: authorized.sessionFamilyId,
          applicationServerKeyVersion:
            authorized.applicationServerKeyVersion
        },
        authorized.encrypted
      );
    } catch {
      await this.failFinal(claimed, {
        code: "SUBSCRIPTION_MATERIAL_UNAVAILABLE",
        retryable: false,
        subscriptionGone: false
      });
      return;
    }
    const sender = this.senderConfig();
    try {
      const response = await this.transport.send({
        subscription: {
          endpoint: material.endpoint,
          expirationTime: material.expirationTime,
          keys: material.keys
        },
        payload,
        options: {
          vapidDetails: {
            subject: sender.subject,
            publicKey: sender.publicKey,
            privateKey: sender.privateKey
          },
          timeout: this.config.webPush.deliverySendTimeoutMs,
          TTL: this.config.webPush.deliveryTtlSeconds,
          contentEncoding: "aes128gcm",
          urgency:
            authorized.severity === "CRITICAL"
              ? "high"
              : authorized.severity === "WARNING"
                ? "normal"
                : "low",
          topic: pushPayload(authorized.payloadSnapshot).tag.slice(0, 32)
        }
      });
      await this.complete(authorized, response.statusCode);
    } catch (error) {
      const failure = deliveryFailure(error);
      if (failure.subscriptionGone) {
        await this.expireSubscription(authorized, failure);
      } else if (
        failure.retryable &&
        authorized.attemptCount < authorized.maxAttempts
      ) {
        await this.retry(authorized, failure);
      } else {
        await this.failFinal(authorized, failure);
      }
    }
  }

  private async authorize(
    claimed: ClaimedAttempt
  ): Promise<AuthorizedDelivery | undefined> {
    const attempt = await this.prisma.webPushDeliveryAttempt.findFirst({
      where: {
        id: claimed.id,
        status: "CLAIMED",
        leaseToken: claimed.leaseToken,
        leaseExpiresAt: { gt: new Date() }
      },
      select: {
        subscription: {
          select: {
            id: true,
            userId: true,
            installationId: true,
            registeredSessionFamilyId: true,
            status: true,
            providerExpiresAt: true,
            version: true,
            applicationServerKeyVersion: true,
            materialCiphertext: true,
            materialNonce: true,
            materialAuthTag: true,
            encryptionKeyVersion: true,
            endpointFingerprint: true,
            fingerprintKeyVersion: true
          }
        }
      }
    });
    const device = attempt?.subscription;
    if (
      !device ||
      device.id !== claimed.subscriptionId ||
      device.userId !== claimed.userId ||
      device.status !== "ACTIVE" ||
      device.version !== claimed.subscriptionVersion ||
      (device.providerExpiresAt !== null &&
        device.providerExpiresAt <= new Date()) ||
      !device.materialCiphertext ||
      !device.materialNonce ||
      !device.materialAuthTag ||
      device.encryptionKeyVersion === null ||
      !device.endpointFingerprint ||
      device.fingerprintKeyVersion === null
    ) {
      return undefined;
    }
    return {
      ...claimed,
      installationId: device.installationId,
      sessionFamilyId: device.registeredSessionFamilyId,
      applicationServerKeyVersion:
        device.applicationServerKeyVersion,
      encrypted: {
        ciphertext: device.materialCiphertext,
        nonce: device.materialNonce,
        authTag: device.materialAuthTag,
        encryptionKeyVersion: device.encryptionKeyVersion,
        endpointFingerprint: device.endpointFingerprint,
        fingerprintKeyVersion: device.fingerprintKeyVersion
      }
    };
  }

  private async complete(
    claimed: AuthorizedDelivery,
    statusCode: number
  ): Promise<void> {
    const deliveredAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.webPushDeliveryAttempt.updateMany({
        where: {
          id: claimed.id,
          status: "CLAIMED",
          leaseToken: claimed.leaseToken
        },
        data: {
          status: "DELIVERED",
          leaseToken: null,
          leaseExpiresAt: null,
          lastHttpStatus: statusCode,
          lastErrorCode: null,
          deliveredAt,
          terminalAt: deliveredAt
        }
      });
      if (result.count !== 1) return;
      await transaction.webPushSubscription.updateMany({
        where: {
          id: claimed.subscriptionId,
          userId: claimed.userId,
          status: "ACTIVE",
          version: claimed.subscriptionVersion
        },
        data: {
          lastDeliveryStatus: "DELIVERED",
          lastDeliveryAt: deliveredAt,
          lastDeliveryErrorCode: null
        }
      });
    });
  }

  private async retry(
    claimed: ClaimedAttempt,
    failure: DeliveryFailure,
    updateDevice = true
  ): Promise<void> {
    const attemptedAt = new Date();
    const delay = Math.max(
      failure.retryAfterMs ?? 0,
      retryDelayMs(claimed.attemptCount, this.config.webPush)
    );
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.webPushDeliveryAttempt.updateMany({
        where: {
          id: claimed.id,
          status: "CLAIMED",
          leaseToken: claimed.leaseToken
        },
        data: {
          status: "RETRY_SCHEDULED",
          leaseToken: null,
          leaseExpiresAt: null,
          availableAt: new Date(attemptedAt.getTime() + delay),
          lastHttpStatus: failure.statusCode ?? null,
          lastErrorCode: failure.code
        }
      });
      if (result.count !== 1 || !updateDevice) return;
      await transaction.webPushSubscription.updateMany({
        where: {
          id: claimed.subscriptionId,
          userId: claimed.userId,
          status: "ACTIVE",
          version: claimed.subscriptionVersion
        },
        data: {
          lastDeliveryStatus: "FAILED",
          lastDeliveryAt: attemptedAt,
          lastDeliveryErrorCode: failure.code
        }
      });
    });
  }

  private failFinal(
    claimed: ClaimedAttempt,
    failure: DeliveryFailure,
    updateDevice = true
  ): Promise<void> {
    return this.finishFailedAttempt(
      claimed,
      failure,
      "FAILED_FINAL",
      updateDevice
    );
  }

  private cancel(
    claimed: ClaimedAttempt,
    errorCode: string
  ): Promise<void> {
    return this.finishFailedAttempt(
      claimed,
      {
        code: errorCode,
        retryable: false,
        subscriptionGone: false
      },
      "CANCELLED",
      false
    );
  }

  private async finishFailedAttempt(
    claimed: ClaimedAttempt,
    failure: DeliveryFailure,
    status: "FAILED_FINAL" | "CANCELLED",
    updateDevice: boolean
  ): Promise<void> {
    const terminalAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.webPushDeliveryAttempt.updateMany({
        where: {
          id: claimed.id,
          status: "CLAIMED",
          leaseToken: claimed.leaseToken
        },
        data: {
          status,
          leaseToken: null,
          leaseExpiresAt: null,
          lastHttpStatus: failure.statusCode ?? null,
          lastErrorCode: failure.code,
          terminalAt
        }
      });
      if (result.count !== 1 || !updateDevice) return;
      await transaction.webPushSubscription.updateMany({
        where: {
          id: claimed.subscriptionId,
          userId: claimed.userId,
          status: "ACTIVE",
          version: claimed.subscriptionVersion
        },
        data: {
          lastDeliveryStatus: "FAILED",
          lastDeliveryAt: terminalAt,
          lastDeliveryErrorCode: failure.code
        }
      });
    });
  }

  private async expireSubscription(
    claimed: AuthorizedDelivery,
    failure: DeliveryFailure
  ): Promise<void> {
    const expiredAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const attempt = await transaction.webPushDeliveryAttempt.updateMany({
        where: {
          id: claimed.id,
          status: "CLAIMED",
          leaseToken: claimed.leaseToken
        },
        data: {
          status: "FAILED_FINAL",
          leaseToken: null,
          leaseExpiresAt: null,
          lastHttpStatus: failure.statusCode ?? null,
          lastErrorCode: failure.code,
          terminalAt: expiredAt
        }
      });
      if (attempt.count !== 1) return;
      const device = await transaction.webPushSubscription.updateMany({
        where: {
          id: claimed.subscriptionId,
          userId: claimed.userId,
          status: "ACTIVE",
          version: claimed.subscriptionVersion
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
          lastDeliveryStatus: "FAILED",
          lastDeliveryAt: expiredAt,
          lastDeliveryErrorCode: failure.code,
          revokedAt: null,
          expiredAt,
          version: { increment: 1 }
        }
      });
      if (device.count !== 1) return;
      await transaction.webPushDeliveryAttempt.updateMany({
        where: {
          subscriptionId: claimed.subscriptionId,
          id: { not: claimed.id },
          status: {
            in: ["PENDING", "RETRY_SCHEDULED", "CLAIMED"]
          }
        },
        data: {
          status: "CANCELLED",
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: "SUBSCRIPTION_EXPIRED",
          terminalAt: expiredAt
        }
      });
    });
  }

  private senderConfig(): {
    readonly subject: string;
    readonly publicKey: string;
    readonly privateKey: string;
  } {
    const subject = this.config.webPush.vapidSubject;
    const publicKey = this.config.webPush.applicationServerKey;
    const privateKey = this.config.webPush.vapidPrivateKey;
    if (!subject || !publicKey || !privateKey) {
      throw new Error("Web Push sender configuration is incomplete");
    }
    return { subject, publicKey, privateKey };
  }
}

function authorizationScope(
  attempt: ClaimedAttempt
): InternalAuthorizeProjectNotificationDeliveryInput {
  const value = attempt.policySnapshot;
  const expectedPermission =
    attempt.eventType === "CRAWL_RADAR" ? "page.view" : "project.view";
  if (
    !attempt.projectId ||
    !projectNotificationEventTypes.includes(attempt.eventType) ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value.version !== 1 ||
    value.workspaceId !== attempt.workspaceId ||
    value.projectId !== attempt.projectId ||
    value.eventType !== attempt.eventType ||
    typeof value.membershipId !== "string" ||
    !UUID_PATTERN.test(value.membershipId) ||
    !Number.isSafeInteger(value.membershipVersion) ||
    Number(value.membershipVersion) < 1 ||
    value.permission !== expectedPermission
  ) {
    throw new Error("Invalid Web Push policy snapshot");
  }
  return {
    userId: attempt.userId,
    workspaceId: attempt.workspaceId,
    projectId: attempt.projectId,
    membershipId: value.membershipId,
    membershipVersion: Number(value.membershipVersion),
    eventType: attempt.eventType,
    permission: expectedPermission
  };
}

function pushPayload(value: Prisma.JsonValue): {
  readonly version: 1;
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly deepLink: string;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !PAYLOAD_KEYS.has(key)) ||
    value.version !== 1 ||
    !preview(value.title, 80) ||
    !preview(value.body, 220) ||
    !preview(value.tag, 128) ||
    typeof value.deepLink !== "string" ||
    value.deepLink.length === 0 ||
    value.deepLink.length > 1_024 ||
    !value.deepLink.startsWith("/app") ||
    value.deepLink.startsWith("//") ||
    FORBIDDEN_PREVIEW_CHARACTERS.test(value.deepLink)
  ) {
    throw new Error("Invalid Web Push payload snapshot");
  }
  return {
    version: 1,
    title: value.title,
    body: value.body,
    tag: value.tag,
    deepLink: value.deepLink
  };
}

function preview(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    [...value].length <= maximum &&
    !FORBIDDEN_PREVIEW_CHARACTERS.test(value)
  );
}

function deliveryFailure(error: unknown): DeliveryFailure {
  const statusCode =
    error instanceof webPush.WebPushError
      ? error.statusCode
      : numericStatusCode(error);
  if (statusCode === 404 || statusCode === 410) {
    return {
      code: "PUSH_SERVICE_GONE",
      statusCode,
      retryable: false,
      subscriptionGone: true
    };
  }
  const retryable =
    statusCode === undefined ||
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500;
  return {
    code: statusCode
      ? retryable
        ? "PUSH_SERVICE_TEMPORARY_FAILURE"
        : "PUSH_SERVICE_REJECTED"
      : "PUSH_TRANSPORT_FAILURE",
    ...(statusCode ? { statusCode } : {}),
    retryable,
    subscriptionGone: false,
    ...(error instanceof webPush.WebPushError
      ? retryAfter(error.headers["retry-after"])
      : {})
  };
}

function numericStatusCode(error: unknown): number | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("statusCode" in error) ||
    typeof error.statusCode !== "number" ||
    !Number.isInteger(error.statusCode) ||
    error.statusCode < 100 ||
    error.statusCode > 599
  ) {
    return undefined;
  }
  return error.statusCode;
}

function retryAfter(value: string | undefined): {
  readonly retryAfterMs?: number;
} {
  if (!value) return {};
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return { retryAfterMs: Math.min(seconds * 1_000, 3_600_000) };
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return {
      retryAfterMs: Math.max(
        0,
        Math.min(date.getTime() - Date.now(), 3_600_000)
      )
    };
  }
  return {};
}

function retryDelayMs(
  attemptCount: number,
  config: AppConfig["webPush"]
): number {
  const exponential = Math.min(
    config.deliveryRetryMaxMs,
    config.deliveryRetryBaseMs * 2 ** Math.max(0, attemptCount - 1)
  );
  const jitter = randomInt(Math.max(1, Math.floor(exponential / 4)));
  return Math.min(config.deliveryRetryMaxMs, exponential + jitter);
}
