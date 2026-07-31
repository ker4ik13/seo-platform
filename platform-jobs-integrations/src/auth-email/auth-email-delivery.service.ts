import {
  createHash,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  createTransactionalEmailDeadLetterEnvelopeV1,
  transactionalEmailEventSubjectV1,
  transactionalEmailEventTypesV1,
  type TransactionalEmailEventEnvelopeV1,
  type TransactionalEmailEventTypeV1
} from "@seo-platform/contracts";
import type {
  AuthEmailDeliveryAttempt,
  AuthEmailDeliveryStatus,
  Prisma
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  EMAIL,
  EmailDeliveryError,
  type EmailPort
} from "../email/email.port.js";
import {
  AuthEmailMaterialClient,
  AuthEmailMaterialClientError
} from "./auth-email-material.client.js";
import { AuthEmailNatsService } from "./auth-email-nats.service.js";
import { renderAuthEmail } from "./auth-email-templates.js";

const DISPATCH_BATCH_SIZE = 50;
const TERMINAL_STATUSES: ReadonlySet<AuthEmailDeliveryStatus> = new Set([
  "COMPLETED",
  "CANCELLED",
  "FAILED_FINAL"
]);
const PERMANENT_FAILURE_CODES: ReadonlySet<string> = new Set([
  "MATERIAL_INVALID",
  "PLATFORM_AUTH_FAILED",
  "PLATFORM_INVALID_RESPONSE",
  "PLATFORM_REJECTED",
  "SMTP_AUTHENTICATION_FAILED",
  "SMTP_CONFIGURATION_INVALID",
  "SMTP_RECIPIENT_REJECTED"
]);

export interface AuthEmailDeliveryProcessResult {
  readonly disposition: "ACK" | "BUSY";
  readonly status: AuthEmailDeliveryStatus;
  readonly retryDelayMs?: number;
}

export class AuthEmailDeliveryInvariantError extends Error {
  public readonly code = "AUTH_EMAIL_SOURCE_EVENT_CONFLICT";

  public constructor() {
    super("Auth email source event conflicts with its durable attempt");
    this.name = "AuthEmailDeliveryInvariantError";
  }
}

export class AuthEmailDeliveryDeadLetterPendingError extends Error {
  public readonly code = "AUTH_EMAIL_DELIVERY_DLQ_PENDING";

  public constructor() {
    super(
      "Auth email delivery remains durable and pending terminal side effects"
    );
    this.name = "AuthEmailDeliveryDeadLetterPendingError";
  }
}

export class AuthEmailDeliveryLeaseLostError extends Error {
  public readonly code = "AUTH_EMAIL_DELIVERY_LEASE_LOST";

  public constructor() {
    super("Auth email delivery lease is no longer owned by this worker");
    this.name = "AuthEmailDeliveryLeaseLostError";
  }
}

interface ClaimedDelivery {
  readonly row: AuthEmailDeliveryAttempt;
  readonly leaseToken: string;
  readonly mode: "DELIVER" | "DLQ";
}

type ClaimResult =
  | { readonly kind: "CLAIMED"; readonly claim: ClaimedDelivery }
  | {
      readonly kind: "DURABLE";
      readonly status: AuthEmailDeliveryStatus;
    }
  | {
      readonly kind: "BUSY";
      readonly status: AuthEmailDeliveryStatus;
      readonly retryDelayMs: number;
    };

interface DeliveryFailure {
  readonly code: string;
  readonly retryable: boolean;
}

@Injectable()
export class AuthEmailDeliveryService {
  private readonly workerId = `auth-email-${randomUUID()}`;

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly materialClient: AuthEmailMaterialClient,
    private readonly nats: AuthEmailNatsService,
    @Inject(EMAIL) private readonly email: EmailPort
  ) {}

  public async processEvent(
    event: TransactionalEmailEventEnvelopeV1,
    sourceEventHash: Uint8Array
  ): Promise<AuthEmailDeliveryProcessResult> {
    if (sourceEventHash.byteLength !== 32) {
      throw new AuthEmailDeliveryInvariantError();
    }
    const row = await this.ensureAttempt(
      event.eventId,
      event.eventType,
      sourceEventHash
    );
    return this.processAttempt(row.id);
  }

  public async processAttempt(
    attemptId: string
  ): Promise<AuthEmailDeliveryProcessResult> {
    const claim = await this.claim(attemptId);
    if (claim.kind === "DURABLE") {
      return { disposition: "ACK", status: claim.status };
    }
    if (claim.kind === "BUSY") {
      return {
        disposition: "BUSY",
        status: claim.status,
        retryDelayMs: claim.retryDelayMs
      };
    }

    const { row } = claim.claim;
    if (claim.claim.mode === "DLQ") {
      await this.deadLetterFailure(claim.claim);
      return { disposition: "ACK", status: "FAILED_FINAL" };
    }

    let activeClaim = claim.claim;
    try {
      if (row.providerMessageId) {
        await this.finishAfterSmtp(claim.claim);
        return { disposition: "ACK", status: "COMPLETED" };
      }

      const material = await this.materialClient.material(
        row.sourceEventId,
        eventType(row.eventType)
      );
      if (material.decision === "SKIPPED") {
        await this.cancel(claim.claim, "NOT_DELIVERABLE");
        return { disposition: "ACK", status: "CANCELLED" };
      }
      const now = await this.databaseNow();
      if (
        material.decision === "READY" &&
        new Date(material.expiresAt) <= now
      ) {
        await this.cancel(claim.claim, "MATERIAL_EXPIRED");
        return { disposition: "ACK", status: "CANCELLED" };
      }
      const messageIdDomain = this.config.email.messageIdDomain;
      if (!messageIdDomain) {
        throw new EmailDeliveryError(
          "SMTP_CONFIGURATION_INVALID",
          false
        );
      }
      const message = renderAuthEmail(material, messageIdDomain);

      /*
       * SMTP is not transactional with PostgreSQL. A process crash after the
       * server accepts this send and before persistSmtpAccepted commits can
       * cause one resend after lease expiry. Reusing the exact Message-ID for
       * every event gives SMTP providers the strongest available best-effort
       * duplicate signal without persisting recipient, token or body.
       */
      await this.email.send(message);
      const accepted = await this.persistSmtpAccepted(
        activeClaim,
        safeProviderMessageId(message.messageId)
      );
      activeClaim = accepted;
      await this.finishAfterSmtp(accepted);
      return { disposition: "ACK", status: "COMPLETED" };
    } catch (error) {
      const failure = deliveryFailure(error);
      const status = await this.fail(activeClaim, failure);
      return { disposition: "ACK", status };
    }
  }

  public async pendingAttemptIds(): Promise<readonly string[]> {
    const now = await this.databaseNow();
    const rows = await this.prisma.authEmailDeliveryAttempt.findMany({
      where: {
        OR: [
          { status: "PENDING" },
          { status: "RETRY_SCHEDULED", retryAt: { lte: now } },
          { status: "SENDING", leaseExpiresAt: { lte: now } },
          { status: "SMTP_ACCEPTED", leaseExpiresAt: { lte: now } },
          { status: "DLQ_PENDING", leaseExpiresAt: { lte: now } }
        ]
      },
      orderBy: [{ retryAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: DISPATCH_BATCH_SIZE,
      select: { id: true }
    });
    return rows.map((row) => row.id);
  }

  private async ensureAttempt(
    sourceEventId: string,
    eventTypeValue: TransactionalEmailEventTypeV1,
    sourceEventHash: Uint8Array
  ): Promise<AuthEmailDeliveryAttempt> {
    const existing =
      await this.prisma.authEmailDeliveryAttempt.findUnique({
        where: { sourceEventId }
      });
    if (existing) {
      assertSourceIdentity(existing, eventTypeValue, sourceEventHash);
      return existing;
    }

    let created: AuthEmailDeliveryAttempt;
    try {
      created = await this.prisma.authEmailDeliveryAttempt.create({
        data: {
          sourceEventId,
          eventType: eventTypeValue,
          sourceEventHash: Buffer.from(sourceEventHash)
        }
      });
    } catch (error) {
      const raced =
        await this.prisma.authEmailDeliveryAttempt.findUnique({
          where: { sourceEventId }
        });
      if (!raced) throw error;
      created = raced;
    }
    assertSourceIdentity(created, eventTypeValue, sourceEventHash);
    return created;
  }

  private async claim(attemptId: string): Promise<ClaimResult> {
    for (let retry = 0; retry < 3; retry += 1) {
      const row =
        await this.prisma.authEmailDeliveryAttempt.findUnique({
          where: { id: attemptId }
        });
      if (!row) {
        throw new AuthEmailDeliveryInvariantError();
      }
      if (TERMINAL_STATUSES.has(row.status)) {
        return { kind: "DURABLE", status: row.status };
      }
      const now = await this.databaseNow();
      if (
        row.leaseExpiresAt &&
        row.leaseExpiresAt > now
      ) {
        return {
          kind: "BUSY",
          status: row.status,
          retryDelayMs: Math.max(
            1,
            Math.min(
              this.config.authEmail.retryMaxMs,
              row.leaseExpiresAt.getTime() - now.getTime()
            )
          )
        };
      }
      if (row.retryAt && row.retryAt > now) {
        return { kind: "DURABLE", status: row.status };
      }

      const leaseToken = randomUUID();
      const hasProviderReceipt = row.providerMessageId !== null;
      const mode =
        row.status === "DLQ_PENDING" ||
        (!hasProviderReceipt &&
          row.attempts >= this.config.authEmail.maxAttempts)
          ? "DLQ"
          : "DELIVER";
      const status: AuthEmailDeliveryStatus =
        mode === "DLQ"
          ? "DLQ_PENDING"
          : row.providerMessageId
            ? "SMTP_ACCEPTED"
            : "SENDING";
      const updated =
        await this.prisma.authEmailDeliveryAttempt.updateMany({
          where: { id: row.id, version: row.version },
          data: {
            status,
            ...(mode === "DELIVER" && !hasProviderReceipt
              ? { attempts: { increment: 1 } }
              : {}),
            leaseOwner: this.workerId,
            leaseToken,
            leaseExpiresAt: new Date(
              now.getTime() + this.config.authEmail.leaseSeconds * 1_000
            ),
            retryAt: null,
            version: { increment: 1 }
          }
        });
      if (updated.count !== 1) continue;
      const claimed =
        await this.prisma.authEmailDeliveryAttempt.findUnique({
          where: { id: row.id }
        });
      if (!claimed || claimed.leaseToken !== leaseToken) {
        throw new AuthEmailDeliveryLeaseLostError();
      }
      return {
        kind: "CLAIMED",
        claim: { row: claimed, leaseToken, mode }
      };
    }
    return {
      kind: "BUSY",
      status: "PENDING",
      retryDelayMs: this.config.authEmail.retryBaseMs
    };
  }

  private async persistSmtpAccepted(
    claim: ClaimedDelivery,
    providerMessageId: string
  ): Promise<ClaimedDelivery> {
    const now = await this.databaseNow();
    const row = await this.updateClaimed(claim, {
      status: "SMTP_ACCEPTED",
      providerMessageId,
      smtpAcceptedAt: now,
      lastErrorCode: null
    });
    return { ...claim, row };
  }

  private async finishAfterSmtp(claim: ClaimedDelivery): Promise<void> {
    if (
      claim.row.eventType ===
        transactionalEmailEventTypesV1.workspaceInviteRequested ||
      claim.row.eventType ===
        transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested
    ) {
      await this.materialClient.complete(claim.row.sourceEventId);
    }
    const now = await this.databaseNow();
    await this.updateClaimed(claim, {
      status: "COMPLETED",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      retryAt: null,
      lastErrorCode: null,
      completedAt: now
    });
  }

  private async cancel(
    claim: ClaimedDelivery,
    errorCode: "MATERIAL_EXPIRED" | "NOT_DELIVERABLE"
  ): Promise<void> {
    const now = await this.databaseNow();
    await this.updateClaimed(claim, {
      status: "CANCELLED",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      retryAt: null,
      lastErrorCode: errorCode,
      cancelledAt: now
    });
  }

  private async fail(
    claim: ClaimedDelivery,
    failure: DeliveryFailure
  ): Promise<AuthEmailDeliveryStatus> {
    if (!failure.retryable) {
      const dlqClaim = await this.updateClaimed(claim, {
        status: "DLQ_PENDING",
        lastErrorCode: failure.code
      });
      await this.deadLetterFailure({ ...claim, row: dlqClaim, mode: "DLQ" });
      return "FAILED_FINAL";
    }

    if (
      claim.row.providerMessageId !== null ||
      claim.row.attempts < this.config.authEmail.maxAttempts
    ) {
      const now = await this.databaseNow();
      const retryAt = new Date(
        now.getTime() + retryDelayMs(
          claim.row.sourceEventId,
          claim.row.attempts,
          this.config.authEmail.retryBaseMs,
          this.config.authEmail.retryMaxMs
        )
      );
      await this.updateClaimed(claim, {
        status: "RETRY_SCHEDULED",
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        retryAt,
        lastErrorCode: failure.code
      });
      return "RETRY_SCHEDULED";
    }

    const dlqClaim = await this.updateClaimed(claim, {
      status: "DLQ_PENDING",
      lastErrorCode: failure.code
    });
    await this.deadLetterFailure({ ...claim, row: dlqClaim, mode: "DLQ" });
    return "FAILED_FINAL";
  }

  private async deadLetterFailure(
    claim: ClaimedDelivery
  ): Promise<void> {
    const environment = this.config.authEmail.environment;
    if (!environment) throw new AuthEmailDeliveryInvariantError();
    const subject = transactionalEmailEventSubjectV1(
      environment,
      eventType(claim.row.eventType)
    );
    const messageReference = `sha256:${Buffer.from(
      claim.row.sourceEventHash
    ).toString("hex")}` as const;
    const failureCode = PERMANENT_FAILURE_CODES.has(
      claim.row.lastErrorCode ?? ""
    )
      ? "DELIVERY_PERMANENT_FAILURE"
      : "DELIVERY_ATTEMPTS_EXHAUSTED";
    const failureId = createHash("sha256")
      .update("jobs-auth-email-delivery-dlq-v1\0")
      .update(this.config.authEmail.streamName)
      .update("\0")
      .update(this.config.authEmail.durableName)
      .update("\0")
      .update(messageReference)
      .update(`\0${failureCode}`)
      .digest("hex");
    const envelope = createTransactionalEmailDeadLetterEnvelopeV1({
      failureId,
      failureCode,
      sourceStream: this.config.authEmail.streamName,
      sourceConsumer: this.config.authEmail.durableName,
      sourceSubject: subject,
      messageReference
    });
    try {
      await this.nats.publishDeadLetter(envelope);
    } catch {
      throw new AuthEmailDeliveryDeadLetterPendingError();
    }
    if (claim.row.lastErrorCode === "SMTP_RECIPIENT_REJECTED") {
      try {
        await this.materialClient.complete(
          claim.row.sourceEventId,
          "BOUNCED"
        );
      } catch {
        throw new AuthEmailDeliveryDeadLetterPendingError();
      }
    }
    const now = await this.databaseNow();
    await this.updateClaimed(claim, {
      status: "FAILED_FINAL",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      retryAt: null,
      failedAt: now
    });
  }

  private async updateClaimed(
    claim: ClaimedDelivery,
    data: Prisma.AuthEmailDeliveryAttemptUpdateManyMutationInput
  ): Promise<AuthEmailDeliveryAttempt> {
    const result =
      await this.prisma.authEmailDeliveryAttempt.updateMany({
        where: {
          id: claim.row.id,
          version: claim.row.version,
          leaseOwner: this.workerId,
          leaseToken: claim.leaseToken
        },
        data: { ...data, version: { increment: 1 } }
      });
    if (result.count !== 1) {
      throw new AuthEmailDeliveryLeaseLostError();
    }
    const row = await this.prisma.authEmailDeliveryAttempt.findUnique({
      where: { id: claim.row.id }
    });
    if (!row) throw new AuthEmailDeliveryLeaseLostError();
    return row;
  }

  private async databaseNow(): Promise<Date> {
    const rows = await this.prisma.$queryRaw<readonly { now: Date }[]>`
      SELECT clock_timestamp() AS "now"
    `;
    const now = rows[0]?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error("Database clock returned an invalid value");
    }
    return now;
  }
}

function assertSourceIdentity(
  row: AuthEmailDeliveryAttempt,
  eventTypeValue: TransactionalEmailEventTypeV1,
  sourceEventHash: Uint8Array
): void {
  const storedHash = Buffer.from(row.sourceEventHash);
  const incomingHash = Buffer.from(sourceEventHash);
  if (
    row.eventType !== eventTypeValue ||
    storedHash.length !== incomingHash.length ||
    !timingSafeEqual(storedHash, incomingHash)
  ) {
    throw new AuthEmailDeliveryInvariantError();
  }
}

function eventType(value: string): TransactionalEmailEventTypeV1 {
  if (
    value !== transactionalEmailEventTypesV1.emailVerificationRequested &&
    value !== transactionalEmailEventTypesV1.passwordResetRequested &&
    value !== transactionalEmailEventTypesV1.workspaceInviteRequested &&
    value !==
      transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested
  ) {
    throw new AuthEmailDeliveryInvariantError();
  }
  return value;
}

function safeProviderMessageId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 255 ||
    /[\r\n]/u.test(value)
  ) {
    throw new EmailDeliveryError("SMTP_CONFIGURATION_INVALID", false);
  }
  return value;
}

function deliveryFailure(error: unknown): DeliveryFailure {
  if (
    error instanceof EmailDeliveryError ||
    error instanceof AuthEmailMaterialClientError
  ) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof AuthEmailDeliveryInvariantError) throw error;
  if (error instanceof AuthEmailDeliveryLeaseLostError) throw error;
  if (error instanceof TypeError) {
    return { code: "MATERIAL_INVALID", retryable: false };
  }
  return { code: "INTERNAL_UNAVAILABLE", retryable: true };
}

export function retryDelayMs(
  eventId: string,
  attempt: number,
  baseMs: number,
  maximumMs: number
): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 30);
  const exponential = Math.min(maximumMs, baseMs * 2 ** exponent);
  const jitterRange = Math.max(1, Math.floor(exponential * 0.2));
  const seed = createHash("sha256")
    .update("jobs-auth-email-retry-v1\0")
    .update(eventId)
    .update("\0")
    .update(String(attempt))
    .digest()
    .readUInt32BE(0);
  const jitter = (seed % (jitterRange * 2 + 1)) - jitterRange;
  return Math.max(1, Math.min(maximumMs, exponential + jitter));
}
