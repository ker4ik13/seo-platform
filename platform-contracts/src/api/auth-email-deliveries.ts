import {
  transactionalEmailEventTypesV1,
  type TransactionalEmailEventTypeV1
} from "../events/transactional-email.js";

export const AUTH_EMAIL_MATERIAL_DECISION_SCHEMA =
  "auth-email-material-decision@1" as const;
export const AUTH_EMAIL_COMPLETION_SCHEMA =
  "auth-email-completion@1" as const;
export const AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA =
  "auth-email-completion-receipt@1" as const;

export type InternalAuthEmailCompletionOutcomeV1 =
  | "DELIVERED"
  | "BOUNCED";

export interface InternalAuthEmailReadyMaterialDecisionV1 {
  readonly schemaVersion: typeof AUTH_EMAIL_MATERIAL_DECISION_SCHEMA;
  readonly decision: "READY";
  readonly eventId: string;
  readonly eventType: TransactionalEmailEventTypeV1;
  readonly recipient: string;
  readonly locale: string;
  readonly expiresAt: string;
  /**
   * The one-time token exists only in this URL fragment. It must never be
   * copied into another field, queue payload, persistence record or log.
   */
  readonly actionUrl: string;
}

export interface InternalAuthEmailSkippedMaterialDecisionV1 {
  readonly schemaVersion: typeof AUTH_EMAIL_MATERIAL_DECISION_SCHEMA;
  readonly decision: "SKIPPED";
  readonly eventId: string;
  readonly reason: "NOT_DELIVERABLE";
}

export type InternalAuthEmailMaterialDecisionV1 =
  | InternalAuthEmailReadyMaterialDecisionV1
  | InternalAuthEmailSkippedMaterialDecisionV1;

export interface InternalAuthEmailCompletionV1 {
  readonly schemaVersion: typeof AUTH_EMAIL_COMPLETION_SCHEMA;
  readonly eventId: string;
  readonly outcome: InternalAuthEmailCompletionOutcomeV1;
}

export interface InternalAuthEmailCompletionReceiptV1 {
  readonly schemaVersion: typeof AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA;
  readonly eventId: string;
  readonly outcome: InternalAuthEmailCompletionOutcomeV1;
}

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_MILLIS_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
const EVENT_TYPES = new Set<string>(
  Object.values(transactionalEmailEventTypesV1)
);

export function internalAuthEmailMaterialDecision(
  value: unknown
): InternalAuthEmailMaterialDecisionV1 {
  const base = exactRecord(value, "material decision");
  const decision = base.decision;
  const eventId = uuidV7(base.eventId, "eventId");

  if (decision === "SKIPPED") {
    exactKeys(base, [
      "schemaVersion",
      "decision",
      "eventId",
      "reason"
    ]);
    if (
      base.schemaVersion !== AUTH_EMAIL_MATERIAL_DECISION_SCHEMA ||
      base.reason !== "NOT_DELIVERABLE"
    ) {
      return invalid("material decision");
    }
    return Object.freeze({
      schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
      decision: "SKIPPED",
      eventId,
      reason: "NOT_DELIVERABLE"
    });
  }

  if (decision !== "READY") return invalid("material decision");
  exactKeys(base, [
    "schemaVersion",
    "decision",
    "eventId",
    "eventType",
    "recipient",
    "locale",
    "expiresAt",
    "actionUrl"
  ]);
  if (
    base.schemaVersion !== AUTH_EMAIL_MATERIAL_DECISION_SCHEMA ||
    typeof base.eventType !== "string" ||
    !EVENT_TYPES.has(base.eventType)
  ) {
    return invalid("material decision");
  }

  return Object.freeze({
    schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
    decision: "READY",
    eventId,
    eventType: base.eventType as TransactionalEmailEventTypeV1,
    recipient: recipient(base.recipient),
    locale: locale(base.locale),
    expiresAt: isoDate(base.expiresAt, "expiresAt"),
    actionUrl: actionUrl(base.actionUrl)
  });
}

export function internalAuthEmailCompletion(
  value: unknown
): InternalAuthEmailCompletionV1 {
  const input = exactRecord(value, "completion");
  exactKeys(input, ["schemaVersion", "eventId", "outcome"]);
  if (
    input.schemaVersion !== AUTH_EMAIL_COMPLETION_SCHEMA ||
    !isCompletionOutcome(input.outcome)
  ) {
    return invalid("completion");
  }
  return Object.freeze({
    schemaVersion: AUTH_EMAIL_COMPLETION_SCHEMA,
    eventId: uuidV7(input.eventId, "eventId"),
    outcome: input.outcome
  });
}

export function internalAuthEmailCompletionReceipt(
  value: unknown
): InternalAuthEmailCompletionReceiptV1 {
  const receipt = exactRecord(value, "completion receipt");
  exactKeys(receipt, ["schemaVersion", "eventId", "outcome"]);
  if (
    receipt.schemaVersion !== AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA ||
    !isCompletionOutcome(receipt.outcome)
  ) {
    return invalid("completion receipt");
  }
  return Object.freeze({
    schemaVersion: AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA,
    eventId: uuidV7(receipt.eventId, "eventId"),
    outcome: receipt.outcome
  });
}

function isCompletionOutcome(
  value: unknown
): value is InternalAuthEmailCompletionOutcomeV1 {
  return value === "DELIVERED" || value === "BOUNCED";
}

function actionUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) {
    return invalid("actionUrl");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid("actionUrl");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    !/^#token=[A-Za-z0-9._~-]+$/u.test(parsed.hash)
  ) {
    return invalid("actionUrl");
  }
  return value;
}

function recipient(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 320 ||
    !EMAIL_PATTERN.test(value) ||
    /[\r\n]/u.test(value)
  ) {
    return invalid("recipient");
  }
  return value;
}

function locale(value: unknown): string {
  if (typeof value !== "string" || !LOCALE_PATTERN.test(value)) {
    return invalid("locale");
  }
  return value;
}

function isoDate(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !ISO_MILLIS_UTC_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    return invalid(field);
  }
  return value;
}

function uuidV7(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    return invalid(field);
  }
  return value;
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
  keys: readonly string[]
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    invalid("fields");
  }
}

function invalid(field: string): never {
  throw new TypeError(`Invalid auth-email ${field}`);
}
