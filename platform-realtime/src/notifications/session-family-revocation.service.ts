import { Injectable } from "@nestjs/common";
import {
  domainEventTypes,
  type DomainEventEnvelope,
  type SessionFamilyRevokedEventDataV1
} from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { acquireWebPushUserLock } from "./web-push-user-lock.js";

const CONSUMER = "realtime.session-family-revocation.v1";
const AGGREGATE_TYPE = "session-family";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UNSAFE_CONTEXT_PATTERN =
  // oxlint-disable-next-line no-control-regex -- Event context must reject C0/C1 controls and bidi isolates.
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export interface SessionFamilyRevocationResult {
  readonly status: "PROCESSED" | "DUPLICATE";
  readonly revokedDeviceCount: number;
}

interface ValidatedSessionFamilyRevokedEvent {
  readonly eventId: string;
  readonly eventType: typeof domainEventTypes.sessionFamilyRevoked;
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
  const envelope = exactRecord(
    input,
    [
      "eventId",
      "eventType",
      "occurredAt",
      "producer",
      "traceId",
      "aggregate",
      "data",
      "metadata"
    ],
    "event"
  );
  const eventId = uuid(envelope.eventId, "event.eventId");
  if (envelope.eventType !== domainEventTypes.sessionFamilyRevoked) {
    invalid("event.eventType");
  }
  if (envelope.producer !== "platform-api") {
    invalid("event.producer");
  }
  timestamp(envelope.occurredAt, "event.occurredAt");
  boundedContext(envelope.traceId, "event.traceId");

  const aggregate = exactRecord(
    envelope.aggregate,
    ["type", "id", "version"],
    "event.aggregate"
  );
  if (
    aggregate.type !== AGGREGATE_TYPE ||
    aggregate.version !== 1
  ) {
    invalid("event.aggregate");
  }
  const aggregateId = uuid(aggregate.id, "event.aggregate.id");

  const data = exactRecord(
    envelope.data,
    ["userId", "sessionFamilyId", "revokedAt"],
    "event.data"
  );
  const userId = uuid(data.userId, "event.data.userId");
  const sessionFamilyId = uuid(
    data.sessionFamilyId,
    "event.data.sessionFamilyId"
  );
  if (aggregateId !== sessionFamilyId) {
    invalid("event.aggregate.id");
  }
  const revokedAt = timestamp(
    data.revokedAt,
    "event.data.revokedAt"
  );

  const metadata = exactRecord(
    envelope.metadata,
    ["correlationId", "causationId"],
    "event.metadata",
    true
  );
  if (metadata.correlationId !== undefined) {
    boundedContext(
      metadata.correlationId,
      "event.metadata.correlationId"
    );
  }
  if (metadata.causationId !== undefined) {
    boundedContext(
      metadata.causationId,
      "event.metadata.causationId"
    );
  }

  return {
    eventId,
    eventType: domainEventTypes.sessionFamilyRevoked,
    userId,
    sessionFamilyId,
    revokedAt,
    scopeKey: `${CONSUMER}:${userId}:${sessionFamilyId}`
  };
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  field: string,
  optionalKeys = false
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    invalid(field);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  if (
    keys.some((key) => !allowedKeys.includes(key)) ||
    (!optionalKeys &&
      allowedKeys.some(
        (key) => !Object.prototype.hasOwnProperty.call(record, key)
      ))
  ) {
    invalid(field);
  }
  return record;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid(field);
  }
  return value.toLowerCase();
}

function timestamp(value: unknown, field: string): Date {
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(value)
  ) {
    invalid(field);
  }
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    invalid(field);
  }
  return parsed;
}

function boundedContext(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 200 ||
    UNSAFE_CONTEXT_PATTERN.test(value)
  ) {
    invalid(field);
  }
  return value;
}

function invalid(field: string): never {
  throw new InvalidSessionFamilyRevokedEventError(
    `Invalid session-family revocation ${field}`
  );
}

export type SessionFamilyRevokedEnvelope =
  DomainEventEnvelope<SessionFamilyRevokedEventDataV1>;
