import { domainEventTypes } from "./catalog.js";
import type {
  DomainEventEnvelope,
  EventMetadata
} from "./envelope.js";
import type { EventId } from "../identifiers.js";

export const sessionFamilyRevokedEventTypeV1 =
  domainEventTypes.sessionFamilyRevoked;
export const sessionFamilyRevokedEventProducerV1 = "platform-api";
export const sessionFamilyRevokedEventAggregateTypeV1 = "session-family";
export const sessionFamilyRevokedEventAggregateVersionV1 = 1;
export const sessionFamilyRevokedEventSubjectSuffixV1 =
  "identity.session-family.revoked.v1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_MILLIS_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_CONTEXT_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ENVIRONMENT_PATTERN =
  /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;

export interface SessionFamilyRevokedEventDataV1 {
  readonly userId: string;
  readonly sessionFamilyId: string;
  readonly revokedAt: string;
}

export interface SessionFamilyRevokedEventMetadataV1
  extends EventMetadata {
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface SessionFamilyRevokedEventEnvelopeV1
  extends DomainEventEnvelope<SessionFamilyRevokedEventDataV1> {
  readonly eventType: typeof sessionFamilyRevokedEventTypeV1;
  readonly producer: typeof sessionFamilyRevokedEventProducerV1;
  readonly workspaceId?: never;
  readonly projectId?: never;
  readonly aggregate: {
    readonly type: typeof sessionFamilyRevokedEventAggregateTypeV1;
    readonly id: string;
    readonly version: typeof sessionFamilyRevokedEventAggregateVersionV1;
  };
  readonly metadata: SessionFamilyRevokedEventMetadataV1;
}

export interface CreateSessionFamilyRevokedEventEnvelopeV1Input {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly traceId: string;
  readonly userId: string;
  readonly sessionFamilyId: string;
  readonly revokedAt: Date;
  readonly metadata: SessionFamilyRevokedEventMetadataV1;
}

export type SessionFamilyRevokedEventSubjectV1<
  Environment extends string = string
> = `${Environment}.${typeof sessionFamilyRevokedEventSubjectSuffixV1}`;

export function sessionFamilyRevokedEventDataV1(input: {
  readonly userId: string;
  readonly sessionFamilyId: string;
  readonly revokedAt: Date;
}): SessionFamilyRevokedEventDataV1 {
  return {
    userId: input.userId,
    sessionFamilyId: input.sessionFamilyId,
    revokedAt: input.revokedAt.toISOString()
  };
}

export function createSessionFamilyRevokedEventEnvelopeV1(
  input: CreateSessionFamilyRevokedEventEnvelopeV1Input
): SessionFamilyRevokedEventEnvelopeV1 {
  const record = exactRecord(
    input,
    [
      "eventId",
      "occurredAt",
      "traceId",
      "userId",
      "sessionFamilyId",
      "revokedAt",
      "metadata"
    ],
    [],
    "input"
  );
  const occurredAt = canonicalDate(
    record.occurredAt,
    "input.occurredAt"
  );
  const revokedAt = canonicalDate(record.revokedAt, "input.revokedAt");

  return parseSessionFamilyRevokedEventEnvelopeV1({
    eventId: canonicalUuid(record.eventId, "input.eventId"),
    eventType: sessionFamilyRevokedEventTypeV1,
    occurredAt,
    producer: sessionFamilyRevokedEventProducerV1,
    traceId: safeContextId(record.traceId, "input.traceId"),
    aggregate: {
      type: sessionFamilyRevokedEventAggregateTypeV1,
      id: canonicalUuid(
        record.sessionFamilyId,
        "input.sessionFamilyId"
      ),
      version: sessionFamilyRevokedEventAggregateVersionV1
    },
    data: {
      userId: canonicalUuid(record.userId, "input.userId"),
      sessionFamilyId: canonicalUuid(
        record.sessionFamilyId,
        "input.sessionFamilyId"
      ),
      revokedAt
    },
    metadata: validatedMetadata(record.metadata, "input.metadata")
  });
}

export function parseSessionFamilyRevokedEventEnvelopeV1(
  input: unknown
): SessionFamilyRevokedEventEnvelopeV1 {
  try {
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
      [],
      "event"
    );
    const eventId = canonicalUuid(envelope.eventId, "event.eventId");
    if (envelope.eventType !== sessionFamilyRevokedEventTypeV1) {
      invalid("event.eventType");
    }
    if (envelope.producer !== sessionFamilyRevokedEventProducerV1) {
      invalid("event.producer");
    }
    const occurredAt = canonicalIsoMillisUtc(
      envelope.occurredAt,
      "event.occurredAt"
    );
    const traceId = safeContextId(envelope.traceId, "event.traceId");

    const aggregate = exactRecord(
      envelope.aggregate,
      ["type", "id", "version"],
      [],
      "event.aggregate"
    );
    if (
      aggregate.type !== sessionFamilyRevokedEventAggregateTypeV1 ||
      aggregate.version !== sessionFamilyRevokedEventAggregateVersionV1
    ) {
      invalid("event.aggregate");
    }
    const aggregateId = canonicalUuid(
      aggregate.id,
      "event.aggregate.id"
    );

    const data = exactRecord(
      envelope.data,
      ["userId", "sessionFamilyId", "revokedAt"],
      [],
      "event.data"
    );
    const userId = canonicalUuid(data.userId, "event.data.userId");
    const sessionFamilyId = canonicalUuid(
      data.sessionFamilyId,
      "event.data.sessionFamilyId"
    );
    if (aggregateId !== sessionFamilyId) {
      invalid("event.aggregate.id");
    }
    const revokedAt = canonicalIsoMillisUtc(
      data.revokedAt,
      "event.data.revokedAt"
    );
    const metadata = validatedMetadata(
      envelope.metadata,
      "event.metadata"
    );

    return Object.freeze({
      eventId: eventId as EventId,
      eventType: sessionFamilyRevokedEventTypeV1,
      occurredAt,
      producer: sessionFamilyRevokedEventProducerV1,
      traceId,
      aggregate: Object.freeze({
        type: sessionFamilyRevokedEventAggregateTypeV1,
        id: aggregateId,
        version: sessionFamilyRevokedEventAggregateVersionV1
      }),
      data: Object.freeze({
        userId,
        sessionFamilyId,
        revokedAt
      }),
      metadata
    });
  } catch (error) {
    if (
      error instanceof InvalidSessionFamilyRevokedEventEnvelopeError
    ) {
      throw error;
    }
    invalid("event");
  }
}

export function sessionFamilyRevokedEventSubjectV1<
  const Environment extends string
>(
  environment: Environment
): SessionFamilyRevokedEventSubjectV1<Environment> {
  if (
    typeof environment !== "string" ||
    !ENVIRONMENT_PATTERN.test(environment)
  ) {
    throw new InvalidSessionFamilyRevokedEventEnvironmentError();
  }

  return `${environment}.${sessionFamilyRevokedEventSubjectSuffixV1}`;
}

export class InvalidSessionFamilyRevokedEventEnvelopeError
  extends TypeError {
  public readonly code =
    "INVALID_SESSION_FAMILY_REVOKED_EVENT_ENVELOPE";

  public constructor(field: string) {
    super(`Invalid session-family revocation ${field}`);
    this.name = "InvalidSessionFamilyRevokedEventEnvelopeError";
  }
}

export class InvalidSessionFamilyRevokedEventEnvironmentError
  extends TypeError {
  public readonly code =
    "INVALID_SESSION_FAMILY_REVOKED_EVENT_ENVIRONMENT";

  public constructor() {
    super("Invalid session-family revocation event environment");
    this.name = "InvalidSessionFamilyRevokedEventEnvironmentError";
  }
}

function exactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  field: string
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    invalid(field);
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  let symbolKeys: readonly symbol[];
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    symbolKeys = Object.getOwnPropertySymbols(value);
  } catch {
    invalid(field);
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    symbolKeys.length !== 0
  ) {
    invalid(field);
  }

  const keys = Object.keys(descriptors);
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  if (
    keys.some((key) => !allowedKeys.has(key)) ||
    requiredKeys.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    invalid(field);
  }

  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      invalid(`${field}.${key}`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function validatedMetadata(
  value: unknown,
  field: string
): Readonly<SessionFamilyRevokedEventMetadataV1> {
  const metadata = exactRecord(
    value,
    [],
    ["correlationId", "causationId"],
    field
  );
  const correlationId = Object.hasOwn(metadata, "correlationId")
    ? safeContextId(
        metadata.correlationId,
        `${field}.correlationId`
      )
    : undefined;
  const causationId = Object.hasOwn(metadata, "causationId")
    ? safeContextId(
        metadata.causationId,
        `${field}.causationId`
      )
    : undefined;

  return Object.freeze({
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId })
  });
}

function canonicalUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid(field);
  }
  return value;
}

function canonicalDate(value: unknown, field: string): string {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime())
  ) {
    invalid(field);
  }
  return value.toISOString();
}

function canonicalIsoMillisUtc(
  value: unknown,
  field: string
): string {
  if (
    typeof value !== "string" ||
    !ISO_MILLIS_UTC_PATTERN.test(value)
  ) {
    invalid(field);
  }
  const timestamp = new Date(value);
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString() !== value
  ) {
    invalid(field);
  }
  return value;
}

function safeContextId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !SAFE_CONTEXT_ID_PATTERN.test(value)
  ) {
    invalid(field);
  }
  return value;
}

function invalid(field: string): never {
  throw new InvalidSessionFamilyRevokedEventEnvelopeError(field);
}
