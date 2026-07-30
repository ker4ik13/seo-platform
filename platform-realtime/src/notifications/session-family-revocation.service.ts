import { Injectable } from "@nestjs/common";
import {
  InvalidSessionFamilyRevokedEventEnvelopeError,
  parseSessionFamilyRevokedEventEnvelopeV1,
  type SessionFamilyRevokedEventEnvelopeV1
} from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { acquireWebPushUserLock } from "./web-push-user-lock.js";

const CONSUMER = "realtime.session-family-revocation.v1";

export interface SessionFamilyRevocationResult {
  readonly status: "PROCESSED" | "DUPLICATE";
  readonly revokedDeviceCount: number;
}

interface ValidatedSessionFamilyRevokedEvent {
  readonly eventId: string;
  readonly eventType: SessionFamilyRevokedEventEnvelopeV1["eventType"];
  readonly userId: string;
  readonly sessionFamilyId: string;
  readonly revokedAt: Date;
  readonly scopeKey: string;
}

@Injectable()
export class SessionFamilyRevocationService {
  public constructor(private readonly prisma: PrismaService) {}

  public async handle(
    input: unknown
  ): Promise<SessionFamilyRevocationResult> {
    const event = sessionFamilyRevokedEvent(input);

    return this.prisma.$transaction(async (transaction) => {
      await acquireWebPushUserLock(transaction, event.userId);

      const existingInbox = await transaction.inboxEvent.findUnique({
        where: { eventId: event.eventId },
        select: {
          eventType: true,
          consumer: true,
          scopeKey: true
        }
      });
      if (existingInbox) {
        if (
          existingInbox.eventType !== event.eventType ||
          existingInbox.consumer !== CONSUMER ||
          existingInbox.scopeKey !== event.scopeKey
        ) {
          throw new SessionFamilyRevocationInvariantError(
            "The event ID is already bound to another inbox scope"
          );
        }
        return {
          status: "DUPLICATE",
          revokedDeviceCount: 0
        };
      }

      await transaction.inboxEvent.create({
        data: {
          eventId: event.eventId,
          eventType: event.eventType,
          consumer: CONSUMER,
          scopeKey: event.scopeKey
        }
      });

      const tombstone =
        await transaction.revokedSessionFamilyTombstone.findUnique({
          where: {
            userId_sessionFamilyId: {
              userId: event.userId,
              sessionFamilyId: event.sessionFamilyId
            }
          },
          select: { revokedAt: true }
        });
      let terminalRevokedAt = event.revokedAt;
      if (!tombstone) {
        await transaction.revokedSessionFamilyTombstone.create({
          data: {
            userId: event.userId,
            sessionFamilyId: event.sessionFamilyId,
            sourceEventId: event.eventId,
            revokedAt: event.revokedAt
          }
        });
      } else {
        if (
          tombstone.revokedAt.getTime() !== event.revokedAt.getTime()
        ) {
          throw new SessionFamilyRevocationInvariantError(
            "The session family is already bound to another revocation time"
          );
        }
        terminalRevokedAt = tombstone.revokedAt;
      }

      const revoked =
        await transaction.webPushSubscription.updateMany({
          where: {
            userId: event.userId,
            registeredSessionFamilyId: event.sessionFamilyId,
            status: "ACTIVE"
          },
          data: terminalSessionRevocation(terminalRevokedAt)
        });

      return {
        status: "PROCESSED",
        revokedDeviceCount: revoked.count
      };
    });
  }
}

export class InvalidSessionFamilyRevokedEventError extends Error {
  public readonly code = "INVALID_SESSION_FAMILY_REVOKED_EVENT";

  public constructor(message: string) {
    super(message);
    this.name = "InvalidSessionFamilyRevokedEventError";
  }
}

export class SessionFamilyRevocationInvariantError extends Error {
  public readonly code = "SESSION_FAMILY_REVOCATION_INBOX_CONFLICT";

  public constructor(message: string) {
    super(message);
    this.name = "SessionFamilyRevocationInvariantError";
  }
}

function terminalSessionRevocation(
  revokedAt: Date
): Prisma.WebPushSubscriptionUpdateManyMutationInput {
  return {
    status: "REVOKED",
    statusReason: "SESSION_REVOKED",
    endpointFingerprint: null,
    materialFingerprint: null,
    materialCiphertext: null,
    materialNonce: null,
    materialAuthTag: null,
    encryptionKeyVersion: null,
    fingerprintKeyVersion: null,
    providerExpiresAt: null,
    revokedAt,
    expiredAt: null,
    version: { increment: 1 }
  };
}

function sessionFamilyRevokedEvent(
  input: unknown
): ValidatedSessionFamilyRevokedEvent {
  let envelope: SessionFamilyRevokedEventEnvelopeV1;
  try {
    envelope = parseSessionFamilyRevokedEventEnvelopeV1(input);
  } catch (error) {
    if (error instanceof InvalidSessionFamilyRevokedEventEnvelopeError) {
      throw new InvalidSessionFamilyRevokedEventError(
        "Invalid session-family revocation event"
      );
    }
    throw error;
  }
  const { userId, sessionFamilyId } = envelope.data;

  return {
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    userId,
    sessionFamilyId,
    revokedAt: new Date(envelope.data.revokedAt),
    scopeKey: `${CONSUMER}:${userId}:${sessionFamilyId}`
  };
}
