import {
  createTransactionalEmailEventEnvelopeV1,
  transactionalEmailEventProducerV1,
  transactionalEmailEventTypesV1,
  type TransactionalEmailEventEnvelopeV1
} from "@seo-platform/contracts";

export interface AuthEmailOutboxRow {
  readonly id: string;
  readonly event_type: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: number;
  readonly workspace_id: string | null;
  readonly project_id: string | null;
  readonly payload: unknown;
  readonly metadata: unknown;
  readonly attempts: number;
  readonly created_at: Date;
}

const SAFE_CONTEXT_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;

export function transactionalEmailEnvelopeFromOutbox(
  row: AuthEmailOutboxRow
): TransactionalEmailEventEnvelopeV1 {
  const payload = exactRecord(row.payload, "payload");
  const metadata = exactRecord(row.metadata, "metadata");
  exactKeys(metadata, ["requestId", "producer"], "metadata");
  if (
    metadata.producer !== transactionalEmailEventProducerV1 ||
    typeof metadata.requestId !== "string" ||
    !(row.created_at instanceof Date) ||
    !Number.isFinite(row.created_at.getTime()) ||
    row.project_id !== null
  ) {
    return invalid("outbox");
  }

  const requestId = SAFE_CONTEXT_ID_PATTERN.test(metadata.requestId)
    ? metadata.requestId
    : undefined;
  const common = {
    eventId: row.id,
    eventType: row.event_type,
    occurredAt: row.created_at,
    traceId: requestId ?? `outbox-${row.id}`,
    metadata: requestId ? { correlationId: requestId } : {}
  } as const;

  if (row.event_type === transactionalEmailEventTypesV1.billingNoticeRequested) {
    exactKeys(payload, ["noticeId", "workspaceId"], "payload");
    if (row.aggregate_type !== "billingNotice" || row.aggregate_version !== 1 || row.aggregate_id !== payload.noticeId || row.workspace_id !== payload.workspaceId) return invalid("billing notice outbox");
    return createTransactionalEmailEventEnvelopeV1({ ...common, eventType: row.event_type, noticeId: stringValue(payload.noticeId, "payload.noticeId"), workspaceId: stringValue(payload.workspaceId, "payload.workspaceId") });
  }

  if (
    row.event_type ===
      transactionalEmailEventTypesV1.emailVerificationRequested ||
    row.event_type ===
      transactionalEmailEventTypesV1.passwordResetRequested
  ) {
    exactKeys(
      payload,
      ["userId", "oneTimeTokenId", "locale", "expiresAt"],
      "payload"
    );
    if (
      row.aggregate_type !== "user" ||
      row.aggregate_id !== payload.userId ||
      row.workspace_id !== null
    ) {
      return invalid("identity outbox");
    }
    return createTransactionalEmailEventEnvelopeV1({
      ...common,
      eventType: row.event_type,
      userId: stringValue(payload.userId, "payload.userId"),
      oneTimeTokenId: stringValue(
        payload.oneTimeTokenId,
        "payload.oneTimeTokenId"
      ),
      locale: stringValue(payload.locale, "payload.locale"),
      expiresAt: canonicalDate(payload.expiresAt, "payload.expiresAt"),
      aggregateVersion: positiveInteger(
        row.aggregate_version,
        "aggregate_version"
      )
    });
  }

  if (
    row.event_type ===
    transactionalEmailEventTypesV1.workspaceInviteRequested
  ) {
    exactKeys(
      payload,
      ["inviteId", "workspaceId", "expiresAt"],
      "payload"
    );
    if (
      row.aggregate_type !== "workspaceInvite" ||
      row.aggregate_id !== payload.inviteId ||
      row.workspace_id !== payload.workspaceId ||
      row.aggregate_version !== 1
    ) {
      return invalid("invite outbox");
    }
    return createTransactionalEmailEventEnvelopeV1({
      ...common,
      eventType: row.event_type,
      inviteId: stringValue(payload.inviteId, "payload.inviteId"),
      workspaceId: stringValue(
        payload.workspaceId,
        "payload.workspaceId"
      ),
      expiresAt: canonicalDate(payload.expiresAt, "payload.expiresAt")
    });
  }

  if (
    row.event_type ===
    transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested
  ) {
    exactKeys(payload, ["receiptId", "workspaceId"], "payload");
    if (
      row.aggregate_type !== "npdReceiptObligation" ||
      row.aggregate_id !== payload.receiptId ||
      row.workspace_id !== payload.workspaceId
    ) {
      return invalid("receipt outbox");
    }
    return createTransactionalEmailEventEnvelopeV1({
      ...common,
      eventType: row.event_type,
      receiptId: stringValue(payload.receiptId, "payload.receiptId"),
      workspaceId: stringValue(
        payload.workspaceId,
        "payload.workspaceId"
      ),
      aggregateVersion: positiveInteger(
        row.aggregate_version,
        "aggregate_version"
      )
    });
  }

  return invalid("event type");
}

function canonicalDate(value: unknown, field: string): Date {
  if (typeof value !== "string") return invalid(field);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return invalid(field);
  }
  return parsed;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") return invalid(field);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return invalid(field);
  }
  return value as number;
}

function exactRecord(
  value: unknown,
  field: string
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return invalid(field);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
    )
  ) {
    return invalid(field);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  field: string
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    invalid(field);
  }
}

function invalid(field: string): never {
  throw new TypeError(`Invalid transactional email ${field}`);
}
