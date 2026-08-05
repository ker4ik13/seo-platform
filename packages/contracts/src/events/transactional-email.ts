import type {
  DomainEventEnvelope,
  EventMetadata
} from "./envelope.js";
import { domainEventTypes } from "./catalog.js";
import type {
  EventId,
  WorkspaceId
} from "../identifiers.js";

export const transactionalEmailEventTypesV1 = {
  emailVerificationRequested:
    domainEventTypes.emailVerificationRequested,
  passwordResetRequested: domainEventTypes.passwordResetRequested,
  workspaceInviteRequested: domainEventTypes.workspaceInviteRequested,
  billingNpdReceiptDeliveryRequested:
    domainEventTypes.billingNpdReceiptDeliveryRequested
} as const;

export type TransactionalEmailEventTypeV1 =
  (typeof transactionalEmailEventTypesV1)[keyof typeof transactionalEmailEventTypesV1];

export const transactionalEmailEventProducerV1 = "platform-api";
export const transactionalEmailUserAggregateTypeV1 = "user";
export const transactionalEmailWorkspaceInviteAggregateTypeV1 =
  "workspaceInvite";
export const transactionalEmailWorkspaceInviteAggregateVersionV1 = 1;
export const transactionalEmailNpdReceiptAggregateTypeV1 =
  "npdReceiptObligation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_MILLIS_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_CONTEXT_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ENVIRONMENT_PATTERN =
  /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;
const SAFE_TRANSPORT_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const STREAM_SEQUENCE_REFERENCE_PATTERN =
  /^stream-sequence:([1-9][0-9]{0,19})$/u;
const SHA_256_REFERENCE_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_UINT64 = 18_446_744_073_709_551_615n;

export interface TransactionalEmailEventMetadataV1
  extends EventMetadata {
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface EmailVerificationRequestedEventDataV1 {
  readonly userId: string;
  readonly oneTimeTokenId: string;
  readonly locale: string;
  readonly expiresAt: string;
}

export interface PasswordResetRequestedEventDataV1 {
  readonly userId: string;
  readonly oneTimeTokenId: string;
  readonly locale: string;
  readonly expiresAt: string;
}

export interface WorkspaceInviteRequestedEventDataV1 {
  readonly inviteId: string;
  readonly workspaceId: string;
  readonly expiresAt: string;
}

export interface BillingNpdReceiptDeliveryRequestedEventDataV1 {
  readonly receiptId: string;
  readonly workspaceId: string;
}

interface TransactionalEmailIdentityEventEnvelopeV1<
  EventType extends
    | typeof transactionalEmailEventTypesV1.emailVerificationRequested
    | typeof transactionalEmailEventTypesV1.passwordResetRequested,
  Data extends
    | EmailVerificationRequestedEventDataV1
    | PasswordResetRequestedEventDataV1
> extends DomainEventEnvelope<Data> {
  readonly eventType: EventType;
  readonly producer: typeof transactionalEmailEventProducerV1;
  readonly workspaceId?: never;
  readonly projectId?: never;
  readonly aggregate: {
    readonly type: typeof transactionalEmailUserAggregateTypeV1;
    readonly id: string;
    readonly version: number;
  };
  readonly metadata: TransactionalEmailEventMetadataV1;
}

export interface EmailVerificationRequestedEventEnvelopeV1
  extends TransactionalEmailIdentityEventEnvelopeV1<
    typeof transactionalEmailEventTypesV1.emailVerificationRequested,
    EmailVerificationRequestedEventDataV1
  > {}

export interface PasswordResetRequestedEventEnvelopeV1
  extends TransactionalEmailIdentityEventEnvelopeV1<
    typeof transactionalEmailEventTypesV1.passwordResetRequested,
    PasswordResetRequestedEventDataV1
  > {}

export interface WorkspaceInviteRequestedEventEnvelopeV1
  extends DomainEventEnvelope<WorkspaceInviteRequestedEventDataV1> {
  readonly eventType:
    typeof transactionalEmailEventTypesV1.workspaceInviteRequested;
  readonly producer: typeof transactionalEmailEventProducerV1;
  readonly workspaceId: WorkspaceId;
  readonly projectId?: never;
  readonly aggregate: {
    readonly type:
      typeof transactionalEmailWorkspaceInviteAggregateTypeV1;
    readonly id: string;
    readonly version:
      typeof transactionalEmailWorkspaceInviteAggregateVersionV1;
  };
  readonly metadata: TransactionalEmailEventMetadataV1;
}

export interface BillingNpdReceiptDeliveryRequestedEventEnvelopeV1
  extends DomainEventEnvelope<BillingNpdReceiptDeliveryRequestedEventDataV1> {
  readonly eventType:
    typeof transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested;
  readonly producer: typeof transactionalEmailEventProducerV1;
  readonly workspaceId: WorkspaceId;
  readonly projectId?: never;
  readonly aggregate: {
    readonly type: typeof transactionalEmailNpdReceiptAggregateTypeV1;
    readonly id: string;
    readonly version: number;
  };
  readonly metadata: TransactionalEmailEventMetadataV1;
}

export type TransactionalEmailEventEnvelopeV1 =
  | EmailVerificationRequestedEventEnvelopeV1
  | PasswordResetRequestedEventEnvelopeV1
  | WorkspaceInviteRequestedEventEnvelopeV1
  | BillingNpdReceiptDeliveryRequestedEventEnvelopeV1;

interface CreateTransactionalEmailEventEnvelopeBaseV1Input {
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly traceId: string;
  readonly metadata: TransactionalEmailEventMetadataV1;
}

export interface CreateEmailVerificationRequestedEventEnvelopeV1Input
  extends CreateTransactionalEmailEventEnvelopeBaseV1Input {
  readonly eventType:
    typeof transactionalEmailEventTypesV1.emailVerificationRequested;
  readonly userId: string;
  readonly oneTimeTokenId: string;
  readonly locale: string;
  readonly expiresAt: Date;
  readonly aggregateVersion: number;
}

export interface CreatePasswordResetRequestedEventEnvelopeV1Input
  extends CreateTransactionalEmailEventEnvelopeBaseV1Input {
  readonly eventType:
    typeof transactionalEmailEventTypesV1.passwordResetRequested;
  readonly userId: string;
  readonly oneTimeTokenId: string;
  readonly locale: string;
  readonly expiresAt: Date;
  readonly aggregateVersion: number;
}

export interface CreateWorkspaceInviteRequestedEventEnvelopeV1Input
  extends CreateTransactionalEmailEventEnvelopeBaseV1Input {
  readonly eventType:
    typeof transactionalEmailEventTypesV1.workspaceInviteRequested;
  readonly inviteId: string;
  readonly workspaceId: string;
  readonly expiresAt: Date;
}

export interface CreateBillingNpdReceiptDeliveryRequestedEventEnvelopeV1Input
  extends CreateTransactionalEmailEventEnvelopeBaseV1Input {
  readonly eventType:
    typeof transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested;
  readonly receiptId: string;
  readonly workspaceId: string;
  readonly aggregateVersion: number;
}

export type CreateTransactionalEmailEventEnvelopeV1Input =
  | CreateEmailVerificationRequestedEventEnvelopeV1Input
  | CreatePasswordResetRequestedEventEnvelopeV1Input
  | CreateWorkspaceInviteRequestedEventEnvelopeV1Input
  | CreateBillingNpdReceiptDeliveryRequestedEventEnvelopeV1Input;

export type TransactionalEmailEventSubjectV1<
  Environment extends string = string,
  EventType extends TransactionalEmailEventTypeV1 =
    TransactionalEmailEventTypeV1
> = `${Environment}.email.${EventType}`;

export type TransactionalEmailEventFilterSubjectV1<
  Environment extends string = string
> = `${Environment}.email.>`;

export type TransactionalEmailDeadLetterSubjectV1<
  Environment extends string = string
> = `${Environment}.dlq.jobs.transactional-email.v1`;

export type TransactionalEmailDeadLetterSourceSubjectV1<
  Environment extends string = string
> =
  | TransactionalEmailEventSubjectV1<Environment>
  | TransactionalEmailEventFilterSubjectV1<Environment>;

export function createTransactionalEmailEventEnvelopeV1(
  input: CreateEmailVerificationRequestedEventEnvelopeV1Input
): EmailVerificationRequestedEventEnvelopeV1;
export function createTransactionalEmailEventEnvelopeV1(
  input: CreatePasswordResetRequestedEventEnvelopeV1Input
): PasswordResetRequestedEventEnvelopeV1;
export function createTransactionalEmailEventEnvelopeV1(
  input: CreateWorkspaceInviteRequestedEventEnvelopeV1Input
): WorkspaceInviteRequestedEventEnvelopeV1;
export function createTransactionalEmailEventEnvelopeV1(
  input: CreateBillingNpdReceiptDeliveryRequestedEventEnvelopeV1Input
): BillingNpdReceiptDeliveryRequestedEventEnvelopeV1;
export function createTransactionalEmailEventEnvelopeV1(
  input: CreateTransactionalEmailEventEnvelopeV1Input
): TransactionalEmailEventEnvelopeV1;
export function createTransactionalEmailEventEnvelopeV1(
  input: CreateTransactionalEmailEventEnvelopeV1Input
): TransactionalEmailEventEnvelopeV1 {
  try {
    const candidate = exactRecord(
      input,
      ["eventType"],
      [
        "eventId",
        "occurredAt",
        "traceId",
        "metadata",
        "userId",
        "oneTimeTokenId",
        "locale",
        "expiresAt",
        "aggregateVersion",
        "inviteId",
        "workspaceId",
        "receiptId"
      ],
      "input"
    );
    const eventType = transactionalEmailEventType(
      candidate.eventType,
      "input.eventType"
    );

    if (
      eventType ===
        transactionalEmailEventTypesV1.emailVerificationRequested ||
      eventType ===
        transactionalEmailEventTypesV1.passwordResetRequested
    ) {
      const record = exactRecord(
        input,
        [
          "eventId",
          "eventType",
          "occurredAt",
          "traceId",
          "metadata",
          "userId",
          "oneTimeTokenId",
          "locale",
          "expiresAt",
          "aggregateVersion"
        ],
        [],
        "input"
      );
      const userId = canonicalUuid(record.userId, "input.userId");
      const data = {
        userId,
        oneTimeTokenId: canonicalUuid(
          record.oneTimeTokenId,
          "input.oneTimeTokenId"
        ),
        locale: canonicalLocale(record.locale, "input.locale"),
        expiresAt: canonicalDate(record.expiresAt, "input.expiresAt")
      };

      return parseTransactionalEmailEventEnvelopeV1({
        eventId: canonicalUuid(record.eventId, "input.eventId"),
        eventType,
        occurredAt: canonicalDate(record.occurredAt, "input.occurredAt"),
        producer: transactionalEmailEventProducerV1,
        traceId: safeContextId(record.traceId, "input.traceId"),
        aggregate: {
          type: transactionalEmailUserAggregateTypeV1,
          id: userId,
          version: positiveVersion(
            record.aggregateVersion,
            "input.aggregateVersion"
          )
        },
        data,
        metadata: validatedMetadata(record.metadata, "input.metadata")
      });
    }

    if (
      eventType ===
      transactionalEmailEventTypesV1.workspaceInviteRequested
    ) {
      const record = exactRecord(
        input,
        [
          "eventId",
          "eventType",
          "occurredAt",
          "traceId",
          "metadata",
          "inviteId",
          "workspaceId",
          "expiresAt"
        ],
        [],
        "input"
      );
      const inviteId = canonicalUuid(record.inviteId, "input.inviteId");
      const workspaceId = canonicalUuid(
        record.workspaceId,
        "input.workspaceId"
      );

      return parseTransactionalEmailEventEnvelopeV1({
        eventId: canonicalUuid(record.eventId, "input.eventId"),
        eventType,
        occurredAt: canonicalDate(record.occurredAt, "input.occurredAt"),
        producer: transactionalEmailEventProducerV1,
        traceId: safeContextId(record.traceId, "input.traceId"),
        workspaceId,
        aggregate: {
          type: transactionalEmailWorkspaceInviteAggregateTypeV1,
          id: inviteId,
          version: transactionalEmailWorkspaceInviteAggregateVersionV1
        },
        data: {
          inviteId,
          workspaceId,
          expiresAt: canonicalDate(record.expiresAt, "input.expiresAt")
        },
        metadata: validatedMetadata(record.metadata, "input.metadata")
      });
    }

    const record = exactRecord(
      input,
      [
        "eventId",
        "eventType",
        "occurredAt",
        "traceId",
        "metadata",
        "receiptId",
        "workspaceId",
        "aggregateVersion"
      ],
      [],
      "input"
    );
    const receiptId = canonicalUuid(record.receiptId, "input.receiptId");
    const workspaceId = canonicalUuid(
      record.workspaceId,
      "input.workspaceId"
    );
    return parseTransactionalEmailEventEnvelopeV1({
      eventId: canonicalUuid(record.eventId, "input.eventId"),
      eventType,
      occurredAt: canonicalDate(record.occurredAt, "input.occurredAt"),
      producer: transactionalEmailEventProducerV1,
      traceId: safeContextId(record.traceId, "input.traceId"),
      workspaceId,
      aggregate: {
        type: transactionalEmailNpdReceiptAggregateTypeV1,
        id: receiptId,
        version: positiveVersion(
          record.aggregateVersion,
          "input.aggregateVersion"
        )
      },
      data: { receiptId, workspaceId },
      metadata: validatedMetadata(record.metadata, "input.metadata")
    });
  } catch (error) {
    if (error instanceof InvalidTransactionalEmailEventEnvelopeError) {
      throw error;
    }
    invalidEvent("input");
  }
}

export function parseTransactionalEmailEventEnvelopeV1(
  input: unknown
): TransactionalEmailEventEnvelopeV1 {
  try {
    const candidate = exactRecord(
      input,
      ["eventType"],
      [
        "eventId",
        "occurredAt",
        "producer",
        "traceId",
        "workspaceId",
        "aggregate",
        "data",
        "metadata"
      ],
      "event"
    );
    const eventType = transactionalEmailEventType(
      candidate.eventType,
      "event.eventType"
    );
    const isWorkspaceInvite =
      eventType ===
      transactionalEmailEventTypesV1.workspaceInviteRequested;
    const isNpdReceipt =
      eventType ===
      transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested;
    const envelope = exactRecord(
      input,
      isWorkspaceInvite || isNpdReceipt
        ? [
            "eventId",
            "eventType",
            "occurredAt",
            "producer",
            "traceId",
            "workspaceId",
            "aggregate",
            "data",
            "metadata"
          ]
        : [
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
    if (envelope.producer !== transactionalEmailEventProducerV1) {
      invalidEvent("event.producer");
    }

    const common = {
      eventId: canonicalUuid(
        envelope.eventId,
        "event.eventId"
      ) as EventId,
      occurredAt: canonicalIsoMillisUtc(
        envelope.occurredAt,
        "event.occurredAt"
      ),
      traceId: safeContextId(envelope.traceId, "event.traceId"),
      metadata: validatedMetadata(envelope.metadata, "event.metadata")
    };
    const aggregate = exactRecord(
      envelope.aggregate,
      ["type", "id", "version"],
      [],
      "event.aggregate"
    );
    const aggregateId = canonicalUuid(
      aggregate.id,
      "event.aggregate.id"
    );

    if (isWorkspaceInvite) {
      if (
        aggregate.type !==
          transactionalEmailWorkspaceInviteAggregateTypeV1 ||
        aggregate.version !==
          transactionalEmailWorkspaceInviteAggregateVersionV1
      ) {
        invalidEvent("event.aggregate");
      }
      const workspaceId = canonicalUuid(
        envelope.workspaceId,
        "event.workspaceId"
      );
      const data = exactRecord(
        envelope.data,
        ["inviteId", "workspaceId", "expiresAt"],
        [],
        "event.data"
      );
      const inviteId = canonicalUuid(
        data.inviteId,
        "event.data.inviteId"
      );
      const dataWorkspaceId = canonicalUuid(
        data.workspaceId,
        "event.data.workspaceId"
      );
      if (
        aggregateId !== inviteId ||
        workspaceId !== dataWorkspaceId
      ) {
        invalidEvent("event.aggregate");
      }

      return Object.freeze({
        eventId: common.eventId,
        eventType:
          transactionalEmailEventTypesV1.workspaceInviteRequested,
        occurredAt: common.occurredAt,
        producer: transactionalEmailEventProducerV1,
        traceId: common.traceId,
        workspaceId: workspaceId as WorkspaceId,
        aggregate: Object.freeze({
          type: transactionalEmailWorkspaceInviteAggregateTypeV1,
          id: aggregateId,
          version: transactionalEmailWorkspaceInviteAggregateVersionV1
        }),
        data: Object.freeze({
          inviteId,
          workspaceId: dataWorkspaceId,
          expiresAt: canonicalIsoMillisUtc(
            data.expiresAt,
            "event.data.expiresAt"
          )
        }),
        metadata: common.metadata
      });
    }

    if (isNpdReceipt) {
      if (aggregate.type !== transactionalEmailNpdReceiptAggregateTypeV1) {
        invalidEvent("event.aggregate");
      }
      const aggregateVersion = positiveVersion(
        aggregate.version,
        "event.aggregate.version"
      );
      const workspaceId = canonicalUuid(
        envelope.workspaceId,
        "event.workspaceId"
      );
      const data = exactRecord(
        envelope.data,
        ["receiptId", "workspaceId"],
        [],
        "event.data"
      );
      const receiptId = canonicalUuid(
        data.receiptId,
        "event.data.receiptId"
      );
      const dataWorkspaceId = canonicalUuid(
        data.workspaceId,
        "event.data.workspaceId"
      );
      if (
        aggregateId !== receiptId ||
        workspaceId !== dataWorkspaceId
      ) {
        invalidEvent("event.aggregate");
      }
      return Object.freeze({
        eventId: common.eventId,
        eventType:
          transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested,
        occurredAt: common.occurredAt,
        producer: transactionalEmailEventProducerV1,
        traceId: common.traceId,
        workspaceId: workspaceId as WorkspaceId,
        aggregate: Object.freeze({
          type: transactionalEmailNpdReceiptAggregateTypeV1,
          id: aggregateId,
          version: aggregateVersion
        }),
        data: Object.freeze({
          receiptId,
          workspaceId: dataWorkspaceId
        }),
        metadata: common.metadata
      });
    }

    if (aggregate.type !== transactionalEmailUserAggregateTypeV1) {
      invalidEvent("event.aggregate.type");
    }
    const aggregateVersion = positiveVersion(
      aggregate.version,
      "event.aggregate.version"
    );
    const data = exactRecord(
      envelope.data,
      ["userId", "oneTimeTokenId", "locale", "expiresAt"],
      [],
      "event.data"
    );
    const userId = canonicalUuid(data.userId, "event.data.userId");
    if (aggregateId !== userId) {
      invalidEvent("event.aggregate.id");
    }
    const parsedData = Object.freeze({
      userId,
      oneTimeTokenId: canonicalUuid(
        data.oneTimeTokenId,
        "event.data.oneTimeTokenId"
      ),
      locale: canonicalLocale(data.locale, "event.data.locale"),
      expiresAt: canonicalIsoMillisUtc(
        data.expiresAt,
        "event.data.expiresAt"
      )
    });
    const parsedAggregate = Object.freeze({
      type: transactionalEmailUserAggregateTypeV1,
      id: aggregateId,
      version: aggregateVersion
    });
    const parsedCommon = {
      eventId: common.eventId,
      occurredAt: common.occurredAt,
      producer: transactionalEmailEventProducerV1,
      traceId: common.traceId,
      aggregate: parsedAggregate,
      data: parsedData,
      metadata: common.metadata
    } as const;

    return eventType ===
      transactionalEmailEventTypesV1.emailVerificationRequested
      ? Object.freeze({
          eventId: parsedCommon.eventId,
          eventType:
            transactionalEmailEventTypesV1.emailVerificationRequested,
          occurredAt: parsedCommon.occurredAt,
          producer: parsedCommon.producer,
          traceId: parsedCommon.traceId,
          aggregate: parsedCommon.aggregate,
          data: parsedCommon.data,
          metadata: parsedCommon.metadata
        })
      : Object.freeze({
          eventId: parsedCommon.eventId,
          eventType:
            transactionalEmailEventTypesV1.passwordResetRequested,
          occurredAt: parsedCommon.occurredAt,
          producer: parsedCommon.producer,
          traceId: parsedCommon.traceId,
          aggregate: parsedCommon.aggregate,
          data: parsedCommon.data,
          metadata: parsedCommon.metadata
        });
  } catch (error) {
    if (error instanceof InvalidTransactionalEmailEventEnvelopeError) {
      throw error;
    }
    invalidEvent("event");
  }
}

export function transactionalEmailEventSubjectV1<
  const Environment extends string,
  const EventType extends TransactionalEmailEventTypeV1
>(
  environment: Environment,
  eventType: EventType
): TransactionalEmailEventSubjectV1<Environment, EventType> {
  validateEnvironment(environment);
  transactionalEmailEventType(eventType, "eventType");
  return `${environment}.email.${eventType}`;
}

export function transactionalEmailEventFilterSubjectV1<
  const Environment extends string
>(
  environment: Environment
): TransactionalEmailEventFilterSubjectV1<Environment> {
  validateEnvironment(environment);
  return `${environment}.email.>`;
}

export function transactionalEmailDeadLetterSubjectV1<
  const Environment extends string
>(
  environment: Environment
): TransactionalEmailDeadLetterSubjectV1<Environment> {
  validateEnvironment(environment);
  return `${environment}.dlq.jobs.transactional-email.v1`;
}

export const transactionalEmailDeadLetterFailureCodesV1 = [
  "SOURCE_METADATA_MISMATCH",
  "SOURCE_SUBJECT_MISMATCH",
  "PAYLOAD_TOO_LARGE",
  "PAYLOAD_INVALID_ENCODING",
  "PAYLOAD_INVALID_JSON",
  "EVENT_SCHEMA_INVALID",
  "PROCESSING_ATTEMPTS_EXHAUSTED",
  "DELIVERY_PERMANENT_FAILURE",
  "DELIVERY_ATTEMPTS_EXHAUSTED"
] as const;

export type TransactionalEmailDeadLetterFailureCodeV1 =
  (typeof transactionalEmailDeadLetterFailureCodesV1)[number];

export interface TransactionalEmailDeadLetterEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly failureId: string;
  readonly failureCode: TransactionalEmailDeadLetterFailureCodeV1;
  readonly source: {
    readonly stream: string;
    readonly consumer: string;
    readonly subject: TransactionalEmailDeadLetterSourceSubjectV1;
    readonly messageReference: string;
  };
}

export interface CreateTransactionalEmailDeadLetterEnvelopeV1Input {
  readonly failureId: string;
  readonly failureCode: TransactionalEmailDeadLetterFailureCodeV1;
  readonly sourceStream: string;
  readonly sourceConsumer: string;
  readonly sourceSubject: TransactionalEmailDeadLetterSourceSubjectV1;
  readonly messageReference: string;
}

export function createTransactionalEmailDeadLetterEnvelopeV1(
  input: CreateTransactionalEmailDeadLetterEnvelopeV1Input
): TransactionalEmailDeadLetterEnvelopeV1 {
  try {
    const record = exactRecord(
      input,
      [
        "failureId",
        "failureCode",
        "sourceStream",
        "sourceConsumer",
        "sourceSubject",
        "messageReference"
      ],
      [],
      "input"
    );
    return parseTransactionalEmailDeadLetterEnvelopeV1({
      schemaVersion: 1,
      failureId: sha256(record.failureId, "input.failureId"),
      failureCode: deadLetterFailureCode(
        record.failureCode,
        "input.failureCode"
      ),
      source: {
        stream: safeTransportName(
          record.sourceStream,
          "input.sourceStream"
        ),
        consumer: safeTransportName(
          record.sourceConsumer,
          "input.sourceConsumer"
        ),
        subject: sourceEventSubject(
          record.sourceSubject,
          "input.sourceSubject"
        ),
        messageReference: messageReference(
          record.messageReference,
          "input.messageReference"
        )
      }
    });
  } catch (error) {
    if (
      error instanceof InvalidTransactionalEmailDeadLetterEnvelopeError
    ) {
      throw error;
    }
    invalidDeadLetter("input");
  }
}

export function parseTransactionalEmailDeadLetterEnvelopeV1(
  input: unknown
): TransactionalEmailDeadLetterEnvelopeV1 {
  try {
    const envelope = exactRecord(
      input,
      ["schemaVersion", "failureId", "failureCode", "source"],
      [],
      "deadLetter"
    );
    if (envelope.schemaVersion !== 1) {
      invalidDeadLetter("deadLetter.schemaVersion");
    }
    const source = exactRecord(
      envelope.source,
      ["stream", "consumer", "subject", "messageReference"],
      [],
      "deadLetter.source"
    );

    return Object.freeze({
      schemaVersion: 1,
      failureId: sha256(
        envelope.failureId,
        "deadLetter.failureId"
      ),
      failureCode: deadLetterFailureCode(
        envelope.failureCode,
        "deadLetter.failureCode"
      ),
      source: Object.freeze({
        stream: safeTransportName(
          source.stream,
          "deadLetter.source.stream"
        ),
        consumer: safeTransportName(
          source.consumer,
          "deadLetter.source.consumer"
        ),
        subject: sourceEventSubject(
          source.subject,
          "deadLetter.source.subject"
        ),
        messageReference: messageReference(
          source.messageReference,
          "deadLetter.source.messageReference"
        )
      })
    });
  } catch (error) {
    if (
      error instanceof InvalidTransactionalEmailDeadLetterEnvelopeError
    ) {
      throw error;
    }
    invalidDeadLetter("deadLetter");
  }
}

export class InvalidTransactionalEmailEventEnvelopeError
  extends TypeError {
  public readonly code = "INVALID_TRANSACTIONAL_EMAIL_EVENT_ENVELOPE";

  public constructor(field: string) {
    super(`Invalid transactional email ${field}`);
    this.name = "InvalidTransactionalEmailEventEnvelopeError";
  }
}

export class InvalidTransactionalEmailEventEnvironmentError
  extends TypeError {
  public readonly code =
    "INVALID_TRANSACTIONAL_EMAIL_EVENT_ENVIRONMENT";

  public constructor() {
    super("Invalid transactional email event environment");
    this.name = "InvalidTransactionalEmailEventEnvironmentError";
  }
}

export class InvalidTransactionalEmailDeadLetterEnvelopeError
  extends TypeError {
  public readonly code =
    "INVALID_TRANSACTIONAL_EMAIL_DEAD_LETTER_ENVELOPE";

  public constructor(field: string) {
    super(`Invalid transactional email dead letter ${field}`);
    this.name = "InvalidTransactionalEmailDeadLetterEnvelopeError";
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
    invalidFor(field);
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  let symbolKeys: readonly symbol[];
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    symbolKeys = Object.getOwnPropertySymbols(value);
  } catch {
    invalidFor(field);
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    symbolKeys.length !== 0
  ) {
    invalidFor(field);
  }

  const keys = Object.keys(descriptors);
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  if (
    keys.some((key) => !allowedKeys.has(key)) ||
    requiredKeys.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    invalidFor(field);
  }

  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      invalidFor(`${field}.${key}`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function validatedMetadata(
  value: unknown,
  field: string
): Readonly<TransactionalEmailEventMetadataV1> {
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
    ? safeContextId(metadata.causationId, `${field}.causationId`)
    : undefined;

  return Object.freeze({
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId })
  });
}

function transactionalEmailEventType(
  value: unknown,
  field: string
): TransactionalEmailEventTypeV1 {
  if (
    value !== transactionalEmailEventTypesV1.emailVerificationRequested &&
    value !== transactionalEmailEventTypesV1.passwordResetRequested &&
    value !== transactionalEmailEventTypesV1.workspaceInviteRequested &&
    value !==
      transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested
  ) {
    invalidEvent(field);
  }
  return value;
}

function canonicalUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalidEvent(field);
  }
  return value;
}

function canonicalDate(value: unknown, field: string): string {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime())
  ) {
    invalidEvent(field);
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
    invalidEvent(field);
  }
  const timestamp = new Date(value);
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString() !== value
  ) {
    invalidEvent(field);
  }
  return value;
}

function canonicalLocale(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > 16
  ) {
    invalidEvent(field);
  }
  let canonical: string | undefined;
  try {
    canonical = Intl.getCanonicalLocales(value)[0];
  } catch {
    invalidEvent(field);
  }
  if (canonical !== value) {
    invalidEvent(field);
  }
  return value;
}

function positiveVersion(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    invalidEvent(field);
  }
  return value;
}

function safeContextId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !SAFE_CONTEXT_ID_PATTERN.test(value)
  ) {
    invalidEvent(field);
  }
  return value;
}

function validateEnvironment(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !ENVIRONMENT_PATTERN.test(value)
  ) {
    throw new InvalidTransactionalEmailEventEnvironmentError();
  }
}

function deadLetterFailureCode(
  value: unknown,
  field: string
): TransactionalEmailDeadLetterFailureCodeV1 {
  if (
    typeof value !== "string" ||
    !transactionalEmailDeadLetterFailureCodesV1.some(
      (candidate) => candidate === value
    )
  ) {
    invalidDeadLetter(field);
  }
  return value as TransactionalEmailDeadLetterFailureCodeV1;
}

function safeTransportName(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !SAFE_TRANSPORT_NAME_PATTERN.test(value)
  ) {
    invalidDeadLetter(field);
  }
  return value;
}

function sourceEventSubject(
  value: unknown,
  field: string
): TransactionalEmailDeadLetterSourceSubjectV1 {
  if (typeof value !== "string") {
    invalidDeadLetter(field);
  }
  for (const eventType of Object.values(transactionalEmailEventTypesV1)) {
    const suffix = `.email.${eventType}`;
    if (value.endsWith(suffix)) {
      const environment = value.slice(0, -suffix.length);
      if (ENVIRONMENT_PATTERN.test(environment)) {
        return value as TransactionalEmailEventSubjectV1;
      }
    }
  }
  const filterSuffix = ".email.>";
  if (value.endsWith(filterSuffix)) {
    const environment = value.slice(0, -filterSuffix.length);
    if (ENVIRONMENT_PATTERN.test(environment)) {
      return value as TransactionalEmailEventFilterSubjectV1;
    }
  }
  invalidDeadLetter(field);
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    invalidDeadLetter(field);
  }
  return value;
}

function messageReference(value: unknown, field: string): string {
  if (typeof value !== "string") {
    invalidDeadLetter(field);
  }
  if (SHA_256_REFERENCE_PATTERN.test(value)) {
    return value;
  }
  const match = STREAM_SEQUENCE_REFERENCE_PATTERN.exec(value);
  if (match?.[1] !== undefined && BigInt(match[1]) <= MAX_UINT64) {
    return value;
  }
  invalidDeadLetter(field);
}

function invalidFor(field: string): never {
  if (field === "input" || field.startsWith("input.")) {
    invalidEvent(field);
  }
  if (field === "event" || field.startsWith("event.")) {
    invalidEvent(field);
  }
  invalidDeadLetter(field);
}

function invalidEvent(field: string): never {
  throw new InvalidTransactionalEmailEventEnvelopeError(field);
}

function invalidDeadLetter(field: string): never {
  throw new InvalidTransactionalEmailDeadLetterEnvelopeError(field);
}
