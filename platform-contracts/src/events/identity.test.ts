import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { domainEventTypes } from "./catalog.js";
import {
  createSessionFamilyRevokedEventEnvelopeV1,
  InvalidSessionFamilyRevokedEventEnvelopeError,
  InvalidSessionFamilyRevokedEventEnvironmentError,
  parseSessionFamilyRevokedEventEnvelopeV1,
  sessionFamilyRevokedEventAggregateTypeV1,
  sessionFamilyRevokedEventAggregateVersionV1,
  sessionFamilyRevokedEventDataV1,
  sessionFamilyRevokedEventProducerV1,
  sessionFamilyRevokedEventSubjectSuffixV1,
  sessionFamilyRevokedEventSubjectV1,
  sessionFamilyRevokedEventTypeV1,
  type CreateSessionFamilyRevokedEventEnvelopeV1Input
} from "./identity.js";

const EVENT_ID = "0190abcd-ef12-7abc-8def-0123456789ab";
const USER_ID = "01900000-0000-7000-8000-000000000002";
const FAMILY_ID = "01900000-0000-7000-8000-000000000003";
const OCCURRED_AT = "2026-07-29T15:30:45.456Z";
const REVOKED_AT = "2026-07-29T15:30:45.123Z";

function validEnvelope(): Readonly<Record<string, unknown>> {
  return {
    eventId: EVENT_ID,
    eventType: "identity.session-family.revoked.v1",
    occurredAt: OCCURRED_AT,
    producer: "platform-api",
    traceId: "01900000-0000-7000-8000-000000000004",
    aggregate: {
      type: "session-family",
      id: FAMILY_ID,
      version: 1
    },
    data: {
      userId: USER_ID,
      sessionFamilyId: FAMILY_ID,
      revokedAt: REVOKED_AT
    },
    metadata: {
      correlationId: "request-01900000-0000-7000-8000-000000000005",
      causationId: "01900000-0000-7000-8000-000000000006"
    }
  };
}

test("session family revoke exposes stable typed constants", () => {
  assert.equal(
    domainEventTypes.sessionFamilyRevoked,
    "identity.session-family.revoked.v1"
  );
  assert.equal(
    sessionFamilyRevokedEventTypeV1,
    domainEventTypes.sessionFamilyRevoked
  );
  assert.equal(sessionFamilyRevokedEventProducerV1, "platform-api");
  assert.equal(
    sessionFamilyRevokedEventAggregateTypeV1,
    "session-family"
  );
  assert.equal(sessionFamilyRevokedEventAggregateVersionV1, 1);
  assert.equal(
    sessionFamilyRevokedEventSubjectSuffixV1,
    "identity.session-family.revoked.v1"
  );
});

test("legacy session-family payload creator stays exact and compatible", () => {
  const payload = sessionFamilyRevokedEventDataV1({
    userId: USER_ID,
    sessionFamilyId: FAMILY_ID,
    revokedAt: new Date(REVOKED_AT),
    reason: "must not cross the event boundary",
    sessionId: "must not cross the event boundary",
    email: "must-not-cross@example.com",
    token: "must not cross the event boundary"
  } as {
    userId: string;
    sessionFamilyId: string;
    revokedAt: Date;
    reason: string;
    sessionId: string;
    email: string;
    token: string;
  });

  assert.deepEqual(payload, {
    userId: USER_ID,
    sessionFamilyId: FAMILY_ID,
    revokedAt: REVOKED_AT
  });
  assert.deepEqual(Object.keys(payload), [
    "userId",
    "sessionFamilyId",
    "revokedAt"
  ]);
});

test("exact creator derives producer, aggregate and redacted scope", () => {
  const envelope = createSessionFamilyRevokedEventEnvelopeV1({
    eventId: EVENT_ID,
    occurredAt: new Date(OCCURRED_AT),
    traceId: "trace-0001",
    userId: USER_ID,
    sessionFamilyId: FAMILY_ID,
    revokedAt: new Date(REVOKED_AT),
    metadata: {
      correlationId: "correlation-0001",
      causationId: "causation-0001"
    }
  });

  assert.deepEqual(envelope, {
    eventId: EVENT_ID,
    eventType: "identity.session-family.revoked.v1",
    occurredAt: OCCURRED_AT,
    producer: "platform-api",
    traceId: "trace-0001",
    aggregate: {
      type: "session-family",
      id: FAMILY_ID,
      version: 1
    },
    data: {
      userId: USER_ID,
      sessionFamilyId: FAMILY_ID,
      revokedAt: REVOKED_AT
    },
    metadata: {
      correlationId: "correlation-0001",
      causationId: "causation-0001"
    }
  });
  assert.equal(Object.hasOwn(envelope, "workspaceId"), false);
  assert.equal(Object.hasOwn(envelope, "projectId"), false);
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.aggregate), true);
  assert.equal(Object.isFrozen(envelope.data), true);
  assert.equal(Object.isFrozen(envelope.metadata), true);
});

test("exact creator rejects missing, extra and noncanonical input", () => {
  const base: CreateSessionFamilyRevokedEventEnvelopeV1Input = {
    eventId: EVENT_ID,
    occurredAt: new Date(OCCURRED_AT),
    traceId: "trace-0001",
    userId: USER_ID,
    sessionFamilyId: FAMILY_ID,
    revokedAt: new Date(REVOKED_AT),
    metadata: {}
  };

  for (const input of [
    { ...base, eventId: EVENT_ID.toUpperCase() },
    { ...base, occurredAt: new Date(Number.NaN) },
    { ...base, traceId: "trace id" },
    { ...base, metadata: { token: "private" } },
    { ...base, metadata: { correlationId: undefined } },
    { ...base, secret: "private" },
    omit(
      base as unknown as Readonly<Record<string, unknown>>,
      "metadata"
    )
  ]) {
    assert.throws(
      () =>
        createSessionFamilyRevokedEventEnvelopeV1(
          input as unknown as CreateSessionFamilyRevokedEventEnvelopeV1Input
        ),
      InvalidSessionFamilyRevokedEventEnvelopeError
    );
  }
});

test("parser returns an exact immutable canonical envelope", () => {
  const parsed = parseSessionFamilyRevokedEventEnvelopeV1(
    validEnvelope()
  );

  assert.deepEqual(parsed, validEnvelope());
  assert.deepEqual(Object.keys(parsed), [
    "eventId",
    "eventType",
    "occurredAt",
    "producer",
    "traceId",
    "aggregate",
    "data",
    "metadata"
  ]);
  assert.equal(Object.isFrozen(parsed), true);
});

test("parser fails closed on missing and extra envelope fields", () => {
  const base = validEnvelope();

  for (const requiredField of [
    "eventId",
    "eventType",
    "occurredAt",
    "producer",
    "traceId",
    "aggregate",
    "data",
    "metadata"
  ]) {
    assertInvalid(omit(base, requiredField));
  }

  for (const input of [
    { ...base, workspaceId: USER_ID },
    { ...base, projectId: USER_ID },
    { ...base, reason: "manual logout" },
    { ...base, email: "private@example.com" },
    { ...base, token: "private" },
    {
      ...base,
      aggregate: { ...(base.aggregate as object), secret: "private" }
    },
    {
      ...base,
      data: { ...(base.data as object), sessionId: EVENT_ID }
    },
    {
      ...base,
      metadata: {
        ...(base.metadata as object),
        ipAddress: "192.0.2.1"
      }
    },
    {
      ...base,
      metadata: { correlationId: undefined }
    }
  ]) {
    assertInvalid(input);
  }
});

test("parser enforces exact event, producer, aggregate and family binding", () => {
  const base = validEnvelope();
  for (const input of [
    { ...base, eventType: "identity.session-family.revoked.v2" },
    { ...base, producer: "realtime" },
    {
      ...base,
      aggregate: { type: "session", id: FAMILY_ID, version: 1 }
    },
    {
      ...base,
      aggregate: {
        type: "session-family",
        id: FAMILY_ID,
        version: 2
      }
    },
    {
      ...base,
      aggregate: {
        type: "session-family",
        id: EVENT_ID,
        version: 1
      }
    }
  ]) {
    assertInvalid(input);
  }
});

test("parser rejects noncanonical or malformed UUIDs", () => {
  const base = validEnvelope();
  const invalidUuids = [
    EVENT_ID.toUpperCase(),
    EVENT_ID.replaceAll("-", ""),
    ` ${EVENT_ID}`,
    `${EVENT_ID} `,
    "00000000-0000-0000-0000-000000000000",
    "01900000-0000-9000-8000-000000000001",
    "01900000-0000-7000-7000-000000000001"
  ];

  for (const invalidUuid of invalidUuids) {
    assertInvalid({ ...base, eventId: invalidUuid });
    assertInvalid({
      ...base,
      aggregate: {
        type: "session-family",
        id: invalidUuid,
        version: 1
      }
    });
    assertInvalid({
      ...base,
      data: {
        userId: invalidUuid,
        sessionFamilyId: FAMILY_ID,
        revokedAt: REVOKED_AT
      }
    });
  }
});

test("parser requires exact ISO UTC timestamps with milliseconds", () => {
  const base = validEnvelope();
  const invalidTimestamps = [
    "2026-07-29T15:30:45Z",
    "2026-07-29T15:30:45.12Z",
    "2026-07-29T15:30:45.1234Z",
    "2026-07-29T17:30:45.123+02:00",
    "2026-07-29t15:30:45.123z",
    "2026-02-30T15:30:45.123Z",
    ` ${REVOKED_AT}`,
    `${REVOKED_AT} `
  ];

  for (const invalidTimestamp of invalidTimestamps) {
    assertInvalid({ ...base, occurredAt: invalidTimestamp });
    assertInvalid({
      ...base,
      data: {
        userId: USER_ID,
        sessionFamilyId: FAMILY_ID,
        revokedAt: invalidTimestamp
      }
    });
  }
});

test("parser rejects unbounded, control, bidi and PII-shaped context IDs", () => {
  const base = validEnvelope();
  const invalidContextIds = [
    "",
    "a".repeat(129),
    "trace id",
    "private@example.com",
    "trace/value",
    "trace:value",
    "trace\u0000value",
    "trace\u001fvalue",
    "trace\u007fvalue",
    "trace\u0085value",
    "trace\u202evalue",
    "trace\u2066value"
  ];

  for (const invalidContextId of invalidContextIds) {
    assertInvalid({ ...base, traceId: invalidContextId });
    assertInvalid({
      ...base,
      metadata: { correlationId: invalidContextId }
    });
    assertInvalid({
      ...base,
      metadata: { causationId: invalidContextId }
    });
  }
});

test("parser rejects arrays, accessors, symbols, classes and hostile proxies", () => {
  const base = validEnvelope();
  let getterCalls = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, "traceId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "trace-0001";
    }
  });
  assertInvalid(accessor);
  assert.equal(getterCalls, 0);

  const symbolBearing = { ...base };
  Object.defineProperty(symbolBearing, Symbol("secret"), {
    enumerable: true,
    value: "private"
  });
  assertInvalid(symbolBearing);

  class ForgedEnvelope {}
  assertInvalid(Object.assign(new ForgedEnvelope(), base));
  assertInvalid([]);
  assertInvalid(null);
  assertInvalid(
    new Proxy(base, {
      ownKeys() {
        throw new Error("hostile proxy");
      }
    })
  );
});

test("subject builder returns an exact typed subject", () => {
  const subject: "prod.identity.session-family.revoked.v1" =
    sessionFamilyRevokedEventSubjectV1("prod");
  assert.equal(subject, "prod.identity.session-family.revoked.v1");
  assert.equal(
    sessionFamilyRevokedEventSubjectV1("staging-eu1"),
    "staging-eu1.identity.session-family.revoked.v1"
  );
  assert.equal(
    sessionFamilyRevokedEventSubjectV1(`a${"1".repeat(31)}`),
    `${`a${"1".repeat(31)}`}.identity.session-family.revoked.v1`
  );
});

test("subject builder rejects unsafe or ambiguous environments", () => {
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
      () => sessionFamilyRevokedEventSubjectV1(environment),
      InvalidSessionFamilyRevokedEventEnvironmentError
    );
  }
});

test("JSON Schema and AsyncAPI artifacts mirror runtime constants", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../schemas/identity.session-family.revoked.v1.schema.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const asyncApi = JSON.parse(
    await readFile(
      new URL(
        "../../schemas/identity.session-family.revoked.v1.asyncapi.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as Record<string, unknown>;

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "eventId",
    "eventType",
    "occurredAt",
    "producer",
    "traceId",
    "aggregate",
    "data",
    "metadata"
  ]);
  const schemaProperties = schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(
    schemaProperties.eventType?.const,
    sessionFamilyRevokedEventTypeV1
  );
  assert.equal(
    schemaProperties.producer?.const,
    sessionFamilyRevokedEventProducerV1
  );
  assert.equal(Object.hasOwn(schemaProperties, "workspaceId"), false);
  assert.equal(Object.hasOwn(schemaProperties, "projectId"), false);
  assert.equal(schema["x-secrets"], false);
  assert.equal(schema["x-direct-pii"], false);

  assert.equal(asyncApi.asyncapi, "2.6.0");
  const channels = asyncApi.channels as Record<string, unknown>;
  assert.deepEqual(Object.keys(channels), [
    `{environment}.${sessionFamilyRevokedEventSubjectSuffixV1}`
  ]);
  const components = asyncApi.components as {
    messages: Record<string, { payload: { $ref: string } }>;
  };
  assert.equal(
    components.messages.identitySessionFamilyRevokedV1?.payload.$ref,
    "./identity.session-family.revoked.v1.schema.json"
  );
});

function assertInvalid(input: unknown): void {
  assert.throws(
    () => parseSessionFamilyRevokedEventEnvelopeV1(input),
    InvalidSessionFamilyRevokedEventEnvelopeError
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
