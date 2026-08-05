import assert from "node:assert/strict";
import test from "node:test";
import {
  createTransactionalEmailDeadLetterEnvelopeV1,
  createTransactionalEmailEventEnvelopeV1,
  InvalidTransactionalEmailDeadLetterEnvelopeError,
  InvalidTransactionalEmailEventEnvironmentError,
  InvalidTransactionalEmailEventEnvelopeError,
  parseTransactionalEmailDeadLetterEnvelopeV1,
  parseTransactionalEmailEventEnvelopeV1,
  transactionalEmailDeadLetterFailureCodesV1,
  transactionalEmailDeadLetterSubjectV1,
  transactionalEmailEventFilterSubjectV1,
  transactionalEmailEventProducerV1,
  transactionalEmailEventSubjectV1,
  transactionalEmailEventTypesV1,
  transactionalEmailNpdReceiptAggregateTypeV1,
  transactionalEmailUserAggregateTypeV1,
  transactionalEmailWorkspaceInviteAggregateTypeV1,
  transactionalEmailWorkspaceInviteAggregateVersionV1,
  type BillingNpdReceiptDeliveryRequestedEventEnvelopeV1,
  type EmailVerificationRequestedEventEnvelopeV1,
  type PasswordResetRequestedEventEnvelopeV1,
  type TransactionalEmailDeadLetterEnvelopeV1,
  type TransactionalEmailEventEnvelopeV1,
  type WorkspaceInviteRequestedEventEnvelopeV1
} from "./transactional-email.js";

const EVENT_ID = "0190abcd-ef12-7abc-8def-0123456789ab";
const USER_ID = "01900000-0000-7000-8000-000000000002";
const ONE_TIME_TOKEN_ID = "01900000-0000-7000-8000-000000000003";
const INVITE_ID = "01900000-0000-7000-8000-000000000004";
const WORKSPACE_ID = "01900000-0000-7000-8000-000000000005";
const RECEIPT_ID = "01900000-0000-7000-8000-000000000007";
const OCCURRED_AT = "2026-07-30T12:00:00.123Z";
const EXPIRES_AT = "2026-07-30T12:30:00.000Z";
const TRACE_ID = "request-01900000-0000-7000-8000-000000000006";
const CORRELATION_ID = "correlation-0001";
const CAUSATION_ID = "causation-0001";
const FAILURE_ID = "a".repeat(64);

function identityEnvelope(
  eventType:
    | typeof transactionalEmailEventTypesV1.emailVerificationRequested
    | typeof transactionalEmailEventTypesV1.passwordResetRequested =
    transactionalEmailEventTypesV1.emailVerificationRequested
): Readonly<Record<string, unknown>> {
  return {
    eventId: EVENT_ID,
    eventType,
    occurredAt: OCCURRED_AT,
    producer: "platform-api",
    traceId: TRACE_ID,
    aggregate: {
      type: "user",
      id: USER_ID,
      version: 7
    },
    data: {
      userId: USER_ID,
      oneTimeTokenId: ONE_TIME_TOKEN_ID,
      locale: "ru-RU",
      expiresAt: EXPIRES_AT
    },
    metadata: {
      correlationId: CORRELATION_ID,
      causationId: CAUSATION_ID
    }
  };
}

function inviteEnvelope(): Readonly<Record<string, unknown>> {
  return {
    eventId: EVENT_ID,
    eventType: transactionalEmailEventTypesV1.workspaceInviteRequested,
    occurredAt: OCCURRED_AT,
    producer: "platform-api",
    traceId: TRACE_ID,
    workspaceId: WORKSPACE_ID,
    aggregate: {
      type: "workspaceInvite",
      id: INVITE_ID,
      version: 1
    },
    data: {
      inviteId: INVITE_ID,
      workspaceId: WORKSPACE_ID,
      expiresAt: EXPIRES_AT
    },
    metadata: {
      correlationId: CORRELATION_ID,
      causationId: CAUSATION_ID
    }
  };
}

function receiptEnvelope(): Readonly<Record<string, unknown>> {
  return {
    eventId: EVENT_ID,
    eventType:
      transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested,
    occurredAt: OCCURRED_AT,
    producer: "platform-api",
    traceId: TRACE_ID,
    workspaceId: WORKSPACE_ID,
    aggregate: {
      type: "npdReceiptObligation",
      id: RECEIPT_ID,
      version: 2
    },
    data: {
      receiptId: RECEIPT_ID,
      workspaceId: WORKSPACE_ID
    },
    metadata: {
      correlationId: CORRELATION_ID,
      causationId: CAUSATION_ID
    }
  };
}

function deadLetterEnvelope(): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    failureId: FAILURE_ID,
    failureCode: "DELIVERY_ATTEMPTS_EXHAUSTED",
    source: {
      stream: "TRANSACTIONAL_EMAIL_EVENTS",
      consumer: "jobs_transactional_email_v1",
      subject:
        "prod.email.identity.email-verification.requested.v1",
      messageReference: "stream-sequence:42"
    }
  };
}

test("transactional email constants expose only the four allowlisted events", () => {
  assert.deepEqual(transactionalEmailEventTypesV1, {
    emailVerificationRequested:
      "identity.email-verification.requested.v1",
    passwordResetRequested: "identity.password-reset.requested.v1",
    workspaceInviteRequested: "workspace.invite.requested.v1",
    billingNpdReceiptDeliveryRequested:
      "billing.npd-receipt.delivery-requested.v1"
  });
  assert.equal(transactionalEmailEventProducerV1, "platform-api");
  assert.equal(transactionalEmailUserAggregateTypeV1, "user");
  assert.equal(
    transactionalEmailWorkspaceInviteAggregateTypeV1,
    "workspaceInvite"
  );
  assert.equal(transactionalEmailWorkspaceInviteAggregateVersionV1, 1);
  assert.equal(
    transactionalEmailNpdReceiptAggregateTypeV1,
    "npdReceiptObligation"
  );
});

test("creator builds all four exact immutable envelopes", () => {
  const verification: EmailVerificationRequestedEventEnvelopeV1 =
    createTransactionalEmailEventEnvelopeV1({
      eventId: EVENT_ID,
      eventType:
        transactionalEmailEventTypesV1.emailVerificationRequested,
      occurredAt: new Date(OCCURRED_AT),
      traceId: TRACE_ID,
      metadata: {
        correlationId: CORRELATION_ID,
        causationId: CAUSATION_ID
      },
      userId: USER_ID,
      oneTimeTokenId: ONE_TIME_TOKEN_ID,
      locale: "ru-RU",
      expiresAt: new Date(EXPIRES_AT),
      aggregateVersion: 7
    });
  const reset: PasswordResetRequestedEventEnvelopeV1 =
    createTransactionalEmailEventEnvelopeV1({
      eventId: EVENT_ID,
      eventType: transactionalEmailEventTypesV1.passwordResetRequested,
      occurredAt: new Date(OCCURRED_AT),
      traceId: TRACE_ID,
      metadata: {
        correlationId: CORRELATION_ID,
        causationId: CAUSATION_ID
      },
      userId: USER_ID,
      oneTimeTokenId: ONE_TIME_TOKEN_ID,
      locale: "ru-RU",
      expiresAt: new Date(EXPIRES_AT),
      aggregateVersion: 7
    });
  const invite: WorkspaceInviteRequestedEventEnvelopeV1 =
    createTransactionalEmailEventEnvelopeV1({
      eventId: EVENT_ID,
      eventType: transactionalEmailEventTypesV1.workspaceInviteRequested,
      occurredAt: new Date(OCCURRED_AT),
      traceId: TRACE_ID,
      metadata: {
        correlationId: CORRELATION_ID,
        causationId: CAUSATION_ID
      },
      inviteId: INVITE_ID,
      workspaceId: WORKSPACE_ID,
      expiresAt: new Date(EXPIRES_AT)
    });
  const receipt: BillingNpdReceiptDeliveryRequestedEventEnvelopeV1 =
    createTransactionalEmailEventEnvelopeV1({
      eventId: EVENT_ID,
      eventType:
        transactionalEmailEventTypesV1
          .billingNpdReceiptDeliveryRequested,
      occurredAt: new Date(OCCURRED_AT),
      traceId: TRACE_ID,
      metadata: {
        correlationId: CORRELATION_ID,
        causationId: CAUSATION_ID
      },
      receiptId: RECEIPT_ID,
      workspaceId: WORKSPACE_ID,
      aggregateVersion: 2
    });

  assert.deepEqual(verification, identityEnvelope());
  assert.deepEqual(reset, identityEnvelope(
    transactionalEmailEventTypesV1.passwordResetRequested
  ));
  assert.deepEqual(invite, inviteEnvelope());
  assert.deepEqual(receipt, receiptEnvelope());
  for (const envelope of [verification, reset, invite, receipt]) {
    assert.equal(Object.isFrozen(envelope), true);
    assert.equal(Object.isFrozen(envelope.aggregate), true);
    assert.equal(Object.isFrozen(envelope.data), true);
    assert.equal(Object.isFrozen(envelope.metadata), true);
    assert.equal(Object.hasOwn(envelope, "projectId"), false);
  }
  assert.equal(Object.hasOwn(verification, "workspaceId"), false);
  assert.equal(Object.hasOwn(reset, "workspaceId"), false);
});

test("parser validates current outbox payload and aggregate shapes", () => {
  const events: readonly TransactionalEmailEventEnvelopeV1[] = [
    parseTransactionalEmailEventEnvelopeV1(identityEnvelope()),
    parseTransactionalEmailEventEnvelopeV1(identityEnvelope(
      transactionalEmailEventTypesV1.passwordResetRequested
    )),
    parseTransactionalEmailEventEnvelopeV1(inviteEnvelope()),
    parseTransactionalEmailEventEnvelopeV1(receiptEnvelope())
  ];

  assert.deepEqual(events[0], identityEnvelope());
  assert.deepEqual(events[1], identityEnvelope(
    transactionalEmailEventTypesV1.passwordResetRequested
  ));
  assert.deepEqual(events[2], inviteEnvelope());
  assert.deepEqual(events[3], receiptEnvelope());
});

test("creator and parser preserve golden field order", () => {
  const verification = parseTransactionalEmailEventEnvelopeV1({
    metadata: {
      causationId: CAUSATION_ID,
      correlationId: CORRELATION_ID
    },
    data: {
      expiresAt: EXPIRES_AT,
      locale: "ru-RU",
      oneTimeTokenId: ONE_TIME_TOKEN_ID,
      userId: USER_ID
    },
    aggregate: { version: 7, id: USER_ID, type: "user" },
    traceId: TRACE_ID,
    producer: "platform-api",
    occurredAt: OCCURRED_AT,
    eventType:
      transactionalEmailEventTypesV1.emailVerificationRequested,
    eventId: EVENT_ID
  });
  const invite = parseTransactionalEmailEventEnvelopeV1({
    metadata: {
      causationId: CAUSATION_ID,
      correlationId: CORRELATION_ID
    },
    data: {
      expiresAt: EXPIRES_AT,
      workspaceId: WORKSPACE_ID,
      inviteId: INVITE_ID
    },
    aggregate: { version: 1, id: INVITE_ID, type: "workspaceInvite" },
    workspaceId: WORKSPACE_ID,
    traceId: TRACE_ID,
    producer: "platform-api",
    occurredAt: OCCURRED_AT,
    eventType: transactionalEmailEventTypesV1.workspaceInviteRequested,
    eventId: EVENT_ID
  });

  assert.deepEqual(Object.keys(verification), [
    "eventId",
    "eventType",
    "occurredAt",
    "producer",
    "traceId",
    "aggregate",
    "data",
    "metadata"
  ]);
  assert.deepEqual(Object.keys(verification.data), [
    "userId",
    "oneTimeTokenId",
    "locale",
    "expiresAt"
  ]);
  assert.deepEqual(Object.keys(invite), [
    "eventId",
    "eventType",
    "occurredAt",
    "producer",
    "traceId",
    "workspaceId",
    "aggregate",
    "data",
    "metadata"
  ]);
  assert.deepEqual(Object.keys(invite.data), [
    "inviteId",
    "workspaceId",
    "expiresAt"
  ]);
  assert.equal(JSON.stringify(verification), JSON.stringify(identityEnvelope()));
  assert.equal(JSON.stringify(invite), JSON.stringify(inviteEnvelope()));
});

test("event parser rejects every secret/content field at every boundary", () => {
  const identity = identityEnvelope();
  const invite = inviteEnvelope();
  const forbiddenFields = ["email", "token", "link", "content"];

  for (const field of forbiddenFields) {
    assertInvalidEvent({ ...identity, [field]: "must-not-cross" });
    assertInvalidEvent({
      ...identity,
      aggregate: { ...(identity.aggregate as object), [field]: "private" }
    });
    assertInvalidEvent({
      ...identity,
      data: { ...(identity.data as object), [field]: "private" }
    });
    assertInvalidEvent({
      ...identity,
      metadata: { ...(identity.metadata as object), [field]: "private" }
    });
    assertInvalidEvent({
      ...invite,
      data: { ...(invite.data as object), [field]: "private" }
    });
  }
});

test("event parser rejects missing and cross-branch envelope fields", () => {
  const identity = identityEnvelope();
  const invite = inviteEnvelope();
  for (const field of [
    "eventId",
    "eventType",
    "occurredAt",
    "producer",
    "traceId",
    "aggregate",
    "data",
    "metadata"
  ]) {
    assertInvalidEvent(omit(identity, field));
  }
  assertInvalidEvent({ ...identity, workspaceId: WORKSPACE_ID });
  assertInvalidEvent({ ...identity, projectId: WORKSPACE_ID });
  assertInvalidEvent(omit(invite, "workspaceId"));
  assertInvalidEvent({ ...invite, projectId: WORKSPACE_ID });
  assertInvalidEvent({
    ...identity,
    eventType: transactionalEmailEventTypesV1.workspaceInviteRequested
  });
  assertInvalidEvent({
    ...invite,
    eventType:
      transactionalEmailEventTypesV1.emailVerificationRequested
  });
  assertInvalidEvent({ ...identity, eventType: "identity.user.created.v1" });
});

test("event parser binds producer, aggregate and tenant scope exactly", () => {
  const identity = identityEnvelope();
  const invite = inviteEnvelope();
  for (const input of [
    { ...identity, producer: "jobs-integrations" },
    {
      ...identity,
      aggregate: { type: "user", id: INVITE_ID, version: 7 }
    },
    {
      ...identity,
      aggregate: { type: "account", id: USER_ID, version: 7 }
    },
    {
      ...identity,
      aggregate: { type: "user", id: USER_ID, version: 0 }
    },
    {
      ...invite,
      aggregate: { type: "workspaceInvite", id: USER_ID, version: 1 }
    },
    {
      ...invite,
      aggregate: { type: "workspaceInvite", id: INVITE_ID, version: 2 }
    },
    {
      ...invite,
      data: {
        inviteId: INVITE_ID,
        workspaceId: USER_ID,
        expiresAt: EXPIRES_AT
      }
    }
  ]) {
    assertInvalidEvent(input);
  }
});

test("event parser rejects malformed IDs, timestamps, locale and context", () => {
  const identity = identityEnvelope();
  for (const invalidId of [
    EVENT_ID.toUpperCase(),
    EVENT_ID.replaceAll("-", ""),
    "00000000-0000-0000-0000-000000000000",
    ` ${EVENT_ID}`,
    `${EVENT_ID} `
  ]) {
    assertInvalidEvent({ ...identity, eventId: invalidId });
    assertInvalidEvent({
      ...identity,
      data: {
        userId: USER_ID,
        oneTimeTokenId: invalidId,
        locale: "ru-RU",
        expiresAt: EXPIRES_AT
      }
    });
  }
  for (const invalidTimestamp of [
    "2026-07-30T12:00:00Z",
    "2026-07-30T12:00:00.12Z",
    "2026-07-30T14:00:00.000+02:00",
    "2026-02-30T12:00:00.000Z"
  ]) {
    assertInvalidEvent({ ...identity, occurredAt: invalidTimestamp });
    assertInvalidEvent({
      ...identity,
      data: {
        userId: USER_ID,
        oneTimeTokenId: ONE_TIME_TOKEN_ID,
        locale: "ru-RU",
        expiresAt: invalidTimestamp
      }
    });
  }
  for (const invalidLocale of [
    "ru-ru",
    "RU",
    "private@example.com",
    "a",
    "en-US-extra-private"
  ]) {
    assertInvalidEvent({
      ...identity,
      data: {
        userId: USER_ID,
        oneTimeTokenId: ONE_TIME_TOKEN_ID,
        locale: invalidLocale,
        expiresAt: EXPIRES_AT
      }
    });
  }
  for (const invalidContext of [
    "",
    "a".repeat(129),
    "request id",
    "private@example.com",
    "request/value",
    "request\u0000value",
    "request\u202evalue"
  ]) {
    assertInvalidEvent({ ...identity, traceId: invalidContext });
    assertInvalidEvent({
      ...identity,
      metadata: { correlationId: invalidContext }
    });
  }
});

test("event creator rejects extra, missing and noncanonical input", () => {
  const base = {
    eventId: EVENT_ID,
    eventType: transactionalEmailEventTypesV1.passwordResetRequested,
    occurredAt: new Date(OCCURRED_AT),
    traceId: TRACE_ID,
    metadata: {},
    userId: USER_ID,
    oneTimeTokenId: ONE_TIME_TOKEN_ID,
    locale: "ru-RU",
    expiresAt: new Date(EXPIRES_AT),
    aggregateVersion: 7
  } as const;
  for (const input of [
    { ...base, email: "private@example.com" },
    { ...base, metadata: { token: "private" } },
    { ...base, aggregateVersion: 0 },
    { ...base, locale: "ru-ru" },
    { ...base, expiresAt: new Date(Number.NaN) },
    omit(base, "oneTimeTokenId")
  ]) {
    assert.throws(
      () => createTransactionalEmailEventEnvelopeV1(input as never),
      InvalidTransactionalEmailEventEnvelopeError
    );
  }
});

test("event parser rejects accessors, symbols, classes and hostile proxies", () => {
  const base = identityEnvelope();
  let getterCalls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, "traceId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return TRACE_ID;
    }
  });
  assertInvalidEvent(accessor);
  assert.equal(getterCalls, 0);

  const symbolBearing = { ...base };
  Object.defineProperty(symbolBearing, Symbol("secret"), {
    enumerable: true,
    value: "private"
  });
  assertInvalidEvent(symbolBearing);

  class ForgedEvent {}
  assertInvalidEvent(Object.assign(new ForgedEvent(), base));
  assertInvalidEvent([]);
  assertInvalidEvent(null);
  assertInvalidEvent(new Proxy(base, {
    ownKeys() {
      throw new Error("hostile proxy");
    }
  }));
});

test("subject helpers produce exact typed event, filter and DLQ subjects", () => {
  const verification:
    "prod.email.identity.email-verification.requested.v1" =
    transactionalEmailEventSubjectV1(
      "prod",
      transactionalEmailEventTypesV1.emailVerificationRequested
    );
  const reset: "prod.email.identity.password-reset.requested.v1" =
    transactionalEmailEventSubjectV1(
      "prod",
      transactionalEmailEventTypesV1.passwordResetRequested
    );
  const invite: "prod.email.workspace.invite.requested.v1" =
    transactionalEmailEventSubjectV1(
      "prod",
      transactionalEmailEventTypesV1.workspaceInviteRequested
    );
  const receipt:
    "prod.email.billing.npd-receipt.delivery-requested.v1" =
    transactionalEmailEventSubjectV1(
      "prod",
      transactionalEmailEventTypesV1
        .billingNpdReceiptDeliveryRequested
    );
  const filter: "prod.email.>" =
    transactionalEmailEventFilterSubjectV1("prod");
  const deadLetter: "prod.dlq.jobs.transactional-email.v1" =
    transactionalEmailDeadLetterSubjectV1("prod");

  assert.equal(
    verification,
    "prod.email.identity.email-verification.requested.v1"
  );
  assert.equal(reset, "prod.email.identity.password-reset.requested.v1");
  assert.equal(invite, "prod.email.workspace.invite.requested.v1");
  assert.equal(
    receipt,
    "prod.email.billing.npd-receipt.delivery-requested.v1"
  );
  assert.equal(filter, "prod.email.>");
  assert.equal(deadLetter, "prod.dlq.jobs.transactional-email.v1");
});

test("subject helpers reject unsafe environments and non-allowlisted events", () => {
  for (const environment of [
    "",
    "Prod",
    "prod.eu",
    "prod_eu",
    "-prod",
    "prod-",
    "prod*",
    "prod>",
    "prod eu",
    "prod\u0000eu",
    "prod\u202eeu",
    `a${"1".repeat(32)}`
  ]) {
    assert.throws(
      () => transactionalEmailEventFilterSubjectV1(environment),
      InvalidTransactionalEmailEventEnvironmentError
    );
    assert.throws(
      () => transactionalEmailDeadLetterSubjectV1(environment),
      InvalidTransactionalEmailEventEnvironmentError
    );
  }
  assert.throws(
    () => transactionalEmailEventSubjectV1(
      "prod",
      "identity.user.created.v1" as never
    ),
    InvalidTransactionalEmailEventEnvelopeError
  );
});

test("redacted DLQ creator and parser are exact, ordered and immutable", () => {
  const created: TransactionalEmailDeadLetterEnvelopeV1 =
    createTransactionalEmailDeadLetterEnvelopeV1({
      failureId: FAILURE_ID,
      failureCode: "DELIVERY_ATTEMPTS_EXHAUSTED",
      sourceStream: "TRANSACTIONAL_EMAIL_EVENTS",
      sourceConsumer: "jobs_transactional_email_v1",
      sourceSubject:
        "prod.email.identity.email-verification.requested.v1",
      messageReference: "stream-sequence:42"
    });
  const parsed = parseTransactionalEmailDeadLetterEnvelopeV1(
    deadLetterEnvelope()
  );

  assert.deepEqual(created, deadLetterEnvelope());
  assert.deepEqual(parsed, deadLetterEnvelope());
  assert.deepEqual(Object.keys(parsed), [
    "schemaVersion",
    "failureId",
    "failureCode",
    "source"
  ]);
  assert.deepEqual(Object.keys(parsed.source), [
    "stream",
    "consumer",
    "subject",
    "messageReference"
  ]);
  assert.equal(JSON.stringify(parsed), JSON.stringify(deadLetterEnvelope()));
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.source), true);
  assert.deepEqual(transactionalEmailDeadLetterFailureCodesV1, [
    "SOURCE_METADATA_MISMATCH",
    "SOURCE_SUBJECT_MISMATCH",
    "PAYLOAD_TOO_LARGE",
    "PAYLOAD_INVALID_ENCODING",
    "PAYLOAD_INVALID_JSON",
    "EVENT_SCHEMA_INVALID",
    "PROCESSING_ATTEMPTS_EXHAUSTED",
    "DELIVERY_PERMANENT_FAILURE",
    "DELIVERY_ATTEMPTS_EXHAUSTED"
  ]);

  assert.equal(
    parseTransactionalEmailDeadLetterEnvelopeV1({
      ...deadLetterEnvelope(),
      failureCode: "SOURCE_SUBJECT_MISMATCH",
      source: {
        ...(deadLetterEnvelope().source as object),
        subject: "prod.email.>"
      }
    }).source.subject,
    "prod.email.>"
  );
});

test("redacted DLQ excludes source event identity, payload and error detail", () => {
  const base = deadLetterEnvelope();
  for (const field of [
    "eventId",
    "eventType",
    "occurredAt",
    "attempts",
    "rawPayload",
    "error",
    "detail",
    "email",
    "token",
    "link",
    "content"
  ]) {
    assertInvalidDeadLetter({ ...base, [field]: "must-not-cross" });
    assertInvalidDeadLetter({
      ...base,
      source: { ...(base.source as object), [field]: "must-not-cross" }
    });
  }
});

test("redacted DLQ validates failure identity, topology and reference", () => {
  const base = deadLetterEnvelope();
  for (const input of [
    { ...base, schemaVersion: 2 },
    { ...base, failureId: "A".repeat(64) },
    { ...base, failureId: "a".repeat(63) },
    { ...base, failureCode: "RAW_PROVIDER_ERROR" },
    {
      ...base,
      source: { ...(base.source as object), stream: "bad.stream" }
    },
    {
      ...base,
      source: { ...(base.source as object), consumer: "bad consumer" }
    },
    {
      ...base,
      source: { ...(base.source as object), subject: "prod.email.invalid.>" }
    },
    {
      ...base,
      source: {
        ...(base.source as object),
        subject: "prod.identity.email-verification.requested.v1"
      }
    },
    {
      ...base,
      source: {
        ...(base.source as object),
        subject: "prod.email.identity.user.created.v1"
      }
    },
    {
      ...base,
      source: { ...(base.source as object), messageReference: "stream-sequence:0" }
    },
    {
      ...base,
      source: { ...(base.source as object), messageReference: "stream-sequence:01" }
    },
    {
      ...base,
      source: {
        ...(base.source as object),
        messageReference: "stream-sequence:18446744073709551616"
      }
    },
    {
      ...base,
      source: { ...(base.source as object), messageReference: `sha256:${"A".repeat(64)}` }
    }
  ]) {
    assertInvalidDeadLetter(input);
  }

  assert.deepEqual(
    parseTransactionalEmailDeadLetterEnvelopeV1({
      ...base,
      source: {
        ...(base.source as object),
        messageReference: `sha256:${"b".repeat(64)}`
      }
    }).source.messageReference,
    `sha256:${"b".repeat(64)}`
  );
});

test("redacted DLQ parser rejects hostile object shapes without invoking accessors", () => {
  const base = deadLetterEnvelope();
  let getterCalls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, "failureId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return FAILURE_ID;
    }
  });
  assertInvalidDeadLetter(accessor);
  assert.equal(getterCalls, 0);

  const symbolBearing = { ...base };
  Object.defineProperty(symbolBearing, Symbol("rawPayload"), {
    enumerable: true,
    value: "private"
  });
  assertInvalidDeadLetter(symbolBearing);

  class ForgedDeadLetter {}
  assertInvalidDeadLetter(Object.assign(new ForgedDeadLetter(), base));
  assertInvalidDeadLetter([]);
  assertInvalidDeadLetter(null);
  assertInvalidDeadLetter(new Proxy(base, {
    getOwnPropertyDescriptor() {
      throw new Error("hostile proxy");
    }
  }));
});

function assertInvalidEvent(input: unknown): void {
  assert.throws(
    () => parseTransactionalEmailEventEnvelopeV1(input),
    InvalidTransactionalEmailEventEnvelopeError
  );
}

function assertInvalidDeadLetter(input: unknown): void {
  assert.throws(
    () => parseTransactionalEmailDeadLetterEnvelopeV1(input),
    InvalidTransactionalEmailDeadLetterEnvelopeError
  );
}

function omit(
  input: Readonly<Record<string, unknown>>,
  key: string
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(input).filter(([candidate]) => candidate !== key)
  );
}
