import assert from "node:assert/strict";
import { setImmediate as setImmediatePromise } from "node:timers/promises";
import test from "node:test";
import type {
  ConsumerMessages,
  DeliveryInfo,
  JsMsg
} from "@nats-io/jetstream";
import type { AppConfig } from "../config/app-config.js";
import type { SessionFamilyRevocationService } from "../notifications/session-family-revocation.service.js";
import { SessionFamilyRevocationInvariantError } from "../notifications/session-family-revocation.service.js";
import type { NatsService } from "./nats.service.js";
import {
  SessionFamilyRevocationConsumer,
  type SessionFamilyRevocationConsumerLogger
} from "./session-family-revocation.consumer.js";

const USER_ID = "01900000-0000-7000-8000-000000000001";
const FAMILY_ID = "01900000-0000-7000-8000-000000000010";
const EVENT_ID = "01900000-0000-7000-8000-000000000100";
const SOURCE_SUBJECT = "prod.identity.session-family.revoked.v1";

test("acks only after a successful application commit", async () => {
  let releaseHandler: (() => void) | undefined;
  const handlerGate = new Promise<void>((resolve) => {
    releaseHandler = resolve;
  });
  const message = messageFixture();
  const harness = consumerFixture({
    handler: async () => {
      await handlerGate;
      return { status: "PROCESSED", revokedDeviceCount: 1 };
    }
  });

  const processing = harness.consumer.processMessage(message.value);
  await setImmediatePromise();
  assert.equal(message.acknowledgements, 0);
  releaseHandler?.();
  await processing;

  assert.equal(message.acknowledgements, 1);
  assert.deepEqual(message.negativeAcknowledgements, []);
  assert.equal(harness.deadLetters.length, 0);
});

test("acks an idempotent duplicate after the handler returns", async () => {
  const message = messageFixture({ deliveryCount: 2 });
  const harness = consumerFixture({
    handler: async () => ({
      status: "DUPLICATE",
      revokedDeviceCount: 0
    })
  });

  await harness.consumer.processMessage(message.value);

  assert.equal(message.acknowledgements, 1);
  assert.equal(harness.handlerCalls, 1);
});

test("unconfirmed source ack after committed handling is left for idempotent redelivery", async () => {
  for (const message of [
    messageFixture({ ackResult: false }),
    messageFixture({ ackError: new Error("ack transport failed") })
  ]) {
    const harness = consumerFixture();
    await assert.rejects(
      harness.consumer.processMessage(message.value)
    );
    assert.equal(harness.handlerCalls, 1);
    assert.equal(message.acknowledgements, 1);
    assert.deepEqual(message.negativeAcknowledgements, []);
    assert.equal(harness.deadLetters.length, 0);
  }
});

test("transient application failure uses delayed NAK without ack or DLQ", async () => {
  const message = messageFixture({ deliveryCount: 2 });
  const harness = consumerFixture({
    handler: async () => {
      throw new Error("database temporarily unavailable");
    },
    maxAttempts: 3
  });

  await harness.consumer.processMessage(message.value);

  assert.equal(message.acknowledgements, 0);
  assert.equal(message.negativeAcknowledgements.length, 1);
  assert.ok(
    (message.negativeAcknowledgements[0] ?? 0) >= 1_600 &&
      (message.negativeAcknowledgements[0] ?? 0) <= 2_400
  );
  assert.equal(harness.deadLetters.length, 0);
});

test("exhausted transient failure publishes a deterministic redacted DLQ envelope then acks", async () => {
  const firstMessage = messageFixture({ deliveryCount: 3 });
  const secondMessage = messageFixture({ deliveryCount: 4 });
  const harness = consumerFixture({
    handler: async () => {
      throw new Error("database still unavailable");
    },
    maxAttempts: 3
  });

  await harness.consumer.processMessage(firstMessage.value);
  await harness.consumer.processMessage(secondMessage.value);

  assert.equal(firstMessage.acknowledgements, 1);
  assert.equal(secondMessage.acknowledgements, 1);
  assert.equal(harness.deadLetters.length, 2);
  assert.deepEqual(harness.deadLetters[0], harness.deadLetters[1]);
  assert.equal(
    parsedDeadLetter(harness.deadLetters[0]?.payload).failureCode,
    "PROCESSING_ATTEMPTS_EXHAUSTED"
  );
});

test("permanent invariant failure publishes DLQ before source ack", async () => {
  const message = messageFixture();
  const order: string[] = [];
  message.onAcknowledge = () => order.push("source-ack");
  const harness = consumerFixture({
    handler: async () => {
      throw new SessionFamilyRevocationInvariantError("scope conflict");
    },
    onDeadLetter: () => order.push("dlq-puback")
  });

  await harness.consumer.processMessage(message.value);

  assert.deepEqual(order, ["dlq-puback", "source-ack"]);
  assert.equal(
    parsedDeadLetter(harness.deadLetters[0]?.payload).failureCode,
    "EVENT_INVARIANT_VIOLATION"
  );
});

test("malformed encoding, JSON, schema and subject mismatch go straight to DLQ", async () => {
  const invalidSchema = event() as Record<string, unknown>;
  invalidSchema.workspaceId = USER_ID;
  const cases = [
    {
      message: messageFixture({ data: Uint8Array.from([0xff]) }),
      code: "PAYLOAD_INVALID_ENCODING"
    },
    {
      message: messageFixture({ payload: "{" }),
      code: "PAYLOAD_INVALID_JSON"
    },
    {
      message: messageFixture({ payload: JSON.stringify(invalidSchema) }),
      code: "EVENT_SCHEMA_INVALID"
    },
    {
      message: messageFixture({ subject: "prod.identity.other-event.v1" }),
      code: "SOURCE_SUBJECT_MISMATCH"
    }
  ] as const;

  for (const testCase of cases) {
    const harness = consumerFixture();
    await harness.consumer.processMessage(testCase.message.value);
    assert.equal(harness.handlerCalls, 0);
    assert.equal(testCase.message.acknowledgements, 1);
    assert.equal(
      parsedDeadLetter(harness.deadLetters[0]?.payload).failureCode,
      testCase.code
    );
  }
});

test("missing, invalid or throwing delivery metadata fails closed without transient retry", async () => {
  const messages = [
    messageFixture({ metadata: "missing" }),
    messageFixture({ metadata: "throwing" }),
    messageFixture({ deliveryCount: 0 }),
    messageFixture({ streamSequence: 0 })
  ];

  for (const message of messages) {
    const harness = consumerFixture({
      handler: async () => {
        throw new Error("must not be called");
      }
    });
    await harness.consumer.processMessage(message.value);
    assert.equal(harness.handlerCalls, 0);
    assert.equal(message.acknowledgements, 1);
    assert.deepEqual(message.negativeAcknowledgements, []);
    assert.equal(
      parsedDeadLetter(harness.deadLetters[0]?.payload).failureCode,
      "SOURCE_METADATA_MISMATCH"
    );
  }
});

test("DLQ failure never acknowledges source and logs only a fixed code", async () => {
  const secret = "never-log-this-provider-secret";
  const message = messageFixture({ payload: `{${secret}` });
  const harness = consumerFixture({ deadLetterError: new Error(secret) });

  await harness.consumer.processMessage(message.value);

  assert.equal(message.acknowledgements, 0);
  assert.equal(message.negativeAcknowledgements.length, 1);
  assert.deepEqual(harness.logs, [
    "SESSION_REVOCATION_CONSUMER_DEAD_LETTER_OR_ACK_FAILED"
  ]);
  assert.doesNotMatch(harness.logs.join(" "), new RegExp(secret, "u"));
});

test("confirmed DLQ with unconfirmed source ack leaves source for safe redelivery", async () => {
  const message = messageFixture({ payload: "{", ackResult: false });
  const harness = consumerFixture();

  await harness.consumer.processMessage(message.value);

  assert.equal(harness.deadLetters.length, 1);
  assert.equal(message.acknowledgements, 1);
  assert.equal(message.negativeAcknowledgements.length, 0);
  assert.deepEqual(harness.logs, [
    "SESSION_REVOCATION_CONSUMER_DEAD_LETTER_OR_ACK_FAILED"
  ]);
});

test("DLQ payload and logs exclude event IDs, user IDs, PII and raw error text", async () => {
  const email = "private-user@example.test";
  const secret = "secret-cookie-value";
  const malformed = {
    ...event(),
    data: {
      ...event().data,
      email,
      secret
    }
  };
  const message = messageFixture({ payload: JSON.stringify(malformed) });
  const harness = consumerFixture();

  await harness.consumer.processMessage(message.value);

  const serialized = JSON.stringify(harness.deadLetters);
  for (const forbidden of [
    email,
    secret,
    USER_ID,
    FAMILY_ID,
    EVENT_ID
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "u"));
    assert.doesNotMatch(harness.logs.join(" "), new RegExp(forbidden, "u"));
  }
  assert.deepEqual(Object.keys(parsedDeadLetter(
    harness.deadLetters[0]?.payload
  )).sort(), ["failureCode", "failureId", "schemaVersion", "source"]);
});

test("graceful shutdown closes an active fetch and does not leave the loop hanging", async () => {
  let finish: ((result: IteratorResult<JsMsg>) => void) | undefined;
  let closeCalls = 0;
  let fetchCalls = 0;
  const messages = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<JsMsg>>((resolve) => {
          finish = resolve;
        })
    }),
    close: async () => {
      closeCalls += 1;
      finish?.({ done: true, value: undefined });
    }
  } as unknown as ConsumerMessages;
  const harness = consumerFixture({
    fetchMessages: async () => {
      fetchCalls += 1;
      return messages;
    }
  });

  harness.consumer.onApplicationBootstrap();
  await setImmediatePromise();
  assert.equal(fetchCalls, 1);

  await Promise.race([
    harness.consumer.beforeApplicationShutdown(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("shutdown timed out")), 500)
    )
  ]);

  assert.ok(closeCalls >= 1);
});

test("shutdown grace is bounded when application handling never settles", async () => {
  const message = messageFixture();
  let rejectHandler: ((reason?: unknown) => void) | undefined;
  const handlerGate = new Promise<void>((_, reject) => {
    rejectHandler = reject;
  });
  let yielded = false;
  let closeCalls = 0;
  const messages = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (yielded) {
          return new Promise<IteratorResult<JsMsg>>(() => undefined);
        }
        yielded = true;
        return { done: false, value: message.value };
      }
    }),
    close: async () => {
      closeCalls += 1;
    }
  } as unknown as ConsumerMessages;
  const harness = consumerFixture({
    handler: async () => {
      await handlerGate;
      return { status: "PROCESSED", revokedDeviceCount: 1 };
    },
    fetchMessages: async () => messages,
    shutdownGraceMs: 100
  });

  harness.consumer.onApplicationBootstrap();
  await setImmediatePromise();
  const startedAt = performance.now();
  await Promise.race([
    harness.consumer.beforeApplicationShutdown(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("bounded shutdown timed out")), 500)
    )
  ]);

  assert.ok(performance.now() - startedAt < 450);
  assert.ok(closeCalls >= 1);
  assert.equal(message.acknowledgements, 0);
  assert.deepEqual(harness.logs, [
    "SESSION_REVOCATION_CONSUMER_SHUTDOWN_TIMEOUT"
  ]);
  rejectHandler?.(
    new SessionFamilyRevocationInvariantError("late scope conflict")
  );
  await setImmediatePromise();
  assert.equal(message.acknowledgements, 0);
  assert.deepEqual(message.negativeAcknowledgements, []);
  assert.equal(harness.deadLetters.length, 0);
});

test("shutdown permits an in-flight invariant DLQ inside the grace period", async () => {
  const message = messageFixture();
  let rejectHandler: ((reason?: unknown) => void) | undefined;
  const handlerGate = new Promise<void>((_, reject) => {
    rejectHandler = reject;
  });
  let markHandlerStarted: (() => void) | undefined;
  const handlerStarted = new Promise<void>((resolve) => {
    markHandlerStarted = resolve;
  });
  let yielded = false;
  const messages = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (yielded) {
          return new Promise<IteratorResult<JsMsg>>(() => undefined);
        }
        yielded = true;
        return { done: false, value: message.value };
      }
    }),
    close: async () => undefined
  } as unknown as ConsumerMessages;
  const harness = consumerFixture({
    handler: async () => {
      markHandlerStarted?.();
      await handlerGate;
      return { status: "PROCESSED", revokedDeviceCount: 1 };
    },
    fetchMessages: async () => messages,
    shutdownGraceMs: 500
  });

  harness.consumer.onApplicationBootstrap();
  await handlerStarted;
  const shutdown = harness.consumer.beforeApplicationShutdown();
  rejectHandler?.(
    new SessionFamilyRevocationInvariantError("in-flight scope conflict")
  );
  await shutdown;

  assert.equal(harness.deadLetters.length, 1);
  assert.equal(message.acknowledgements, 1);
  assert.deepEqual(message.negativeAcknowledgements, []);
  assert.deepEqual(harness.logs, []);
});

test("runOnce is non-overlapping for concurrent callers", async () => {
  let finish: ((result: IteratorResult<JsMsg>) => void) | undefined;
  let fetchCalls = 0;
  const messages = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<JsMsg>>((resolve) => {
          finish = resolve;
        })
    }),
    close: async () => undefined
  } as unknown as ConsumerMessages;
  const harness = consumerFixture({
    fetchMessages: async () => {
      fetchCalls += 1;
      return messages;
    }
  });

  const first = harness.consumer.runOnce();
  const second = harness.consumer.runOnce();
  await setImmediatePromise();
  assert.equal(fetchCalls, 1);
  finish?.({ done: true, value: undefined });
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
});

interface DeadLetterCall {
  readonly payload: string;
  readonly messageId: string;
}

function consumerFixture(options: {
  readonly handler?: (input: unknown) => Promise<unknown>;
  readonly maxAttempts?: number;
  readonly deadLetterError?: Error;
  readonly onDeadLetter?: () => void;
  readonly fetchMessages?: () => Promise<ConsumerMessages>;
  readonly shutdownGraceMs?: number;
} = {}): {
  readonly consumer: SessionFamilyRevocationConsumer;
  readonly deadLetters: DeadLetterCall[];
  readonly logs: string[];
  readonly handlerCalls: number;
} {
  const deadLetters: DeadLetterCall[] = [];
  const logs: string[] = [];
  let handlerCalls = 0;
  const handler = {
    handle: async (input: unknown) => {
      handlerCalls += 1;
      return options.handler
        ? options.handler(input)
        : { status: "PROCESSED", revokedDeviceCount: 1 };
    }
  } as SessionFamilyRevocationService;
  const nats = {
    publishDeadLetter: async (payload: string, messageId: string) => {
      deadLetters.push({ payload, messageId });
      if (options.deadLetterError) throw options.deadLetterError;
      options.onDeadLetter?.();
      return { stream: "DOMAIN_EVENTS_DLQ", seq: 1, duplicate: false };
    },
    fetchEventMessages: options.fetchMessages ?? (async () => {
      throw new Error("fetch is not configured in this test");
    })
  } as NatsService;
  const logger: SessionFamilyRevocationConsumerLogger = {
    warn: (code) => logs.push(code)
  };
  const consumer = new SessionFamilyRevocationConsumer(
    configFixture(options.maxAttempts, options.shutdownGraceMs),
    nats,
    handler,
    logger
  );
  return {
    consumer,
    deadLetters,
    logs,
    get handlerCalls() {
      return handlerCalls;
    }
  };
}

function configFixture(
  maxAttempts = 8,
  shutdownGraceMs = 10_000
): AppConfig {
  return {
    eventConsumer: {
      enabled: true,
      environment: "prod",
      streamName: "IDENTITY_EVENTS",
      durableName: "realtime_session_family_revoked_v1",
      subject: SOURCE_SUBJECT,
      deadLetterStreamName: "DOMAIN_EVENTS_DLQ",
      deadLetterSubject:
        "prod.dlq.realtime.identity.session-family.revoked.v1",
      fetchExpiresMs: 1_000,
      maxAttempts,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
      publishTimeoutMs: 5_000,
      maxPayloadBytes: 65_536,
      shutdownGraceMs
    }
  } as AppConfig;
}

type MetadataMode = "valid" | "missing" | "throwing";

function messageFixture(options: {
  readonly payload?: string;
  readonly data?: Uint8Array;
  readonly subject?: string;
  readonly deliveryCount?: number;
  readonly streamSequence?: number;
  readonly metadata?: MetadataMode;
  readonly ackResult?: boolean;
  readonly ackError?: Error;
} = {}): {
  readonly value: JsMsg;
  readonly negativeAcknowledgements: number[];
  acknowledgements: number;
  onAcknowledge: (() => void) | undefined;
} {
  const negativeAcknowledgements: number[] = [];
  const harness = {
    value: undefined as unknown as JsMsg,
    negativeAcknowledgements,
    acknowledgements: 0,
    onAcknowledge: undefined as (() => void) | undefined
  };
  const raw = {
    subject: options.subject ?? SOURCE_SUBJECT,
    data:
      options.data ??
      new TextEncoder().encode(options.payload ?? JSON.stringify(event())),
    seq: options.streamSequence ?? 41,
    ackAck: async () => {
      harness.acknowledgements += 1;
      harness.onAcknowledge?.();
      if (options.ackError) throw options.ackError;
      return options.ackResult ?? true;
    },
    nak: (delayMs?: number) => {
      negativeAcknowledgements.push(delayMs ?? 0);
    }
  };
  Object.defineProperty(raw, "info", {
    enumerable: true,
    get: () => {
      if (options.metadata === "throwing") {
        throw new Error("untrusted delivery metadata");
      }
      if (options.metadata === "missing") return {};
      return {
        stream: "IDENTITY_EVENTS",
        consumer: "realtime_session_family_revoked_v1",
        deliveryCount: options.deliveryCount ?? 1,
        streamSequence: options.streamSequence ?? 41
      } as DeliveryInfo;
    }
  });
  harness.value = raw as unknown as JsMsg;
  return harness;
}

function event() {
  return {
    eventId: EVENT_ID,
    eventType: "identity.session-family.revoked.v1",
    occurredAt: "2026-07-29T12:00:01.000Z",
    producer: "platform-api",
    traceId: "trace-session-family-revocation",
    aggregate: {
      type: "session-family",
      id: FAMILY_ID,
      version: 1
    },
    data: {
      userId: USER_ID,
      sessionFamilyId: FAMILY_ID,
      revokedAt: "2026-07-29T12:00:00.000Z"
    },
    metadata: {}
  };
}

function parsedDeadLetter(payload: string | undefined): Record<string, unknown> {
  assert.ok(payload);
  return JSON.parse(payload) as Record<string, unknown>;
}
