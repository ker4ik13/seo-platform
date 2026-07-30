import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import {
  createTransactionalEmailEventEnvelopeV1,
  transactionalEmailEventFilterSubjectV1,
  transactionalEmailEventSubjectV1,
  transactionalEmailEventTypesV1,
  type TransactionalEmailDeadLetterEnvelopeV1
} from "@seo-platform/contracts";
import type { ConsumerMessages, JsMsg } from "@nats-io/jetstream";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { EmailPort } from "../email/email.port.js";
import {
  AuthEmailDeliveryInvariantError,
  AuthEmailDeliveryLeaseLostError,
  type AuthEmailDeliveryProcessResult,
  type AuthEmailDeliveryService
} from "./auth-email-delivery.service.js";
import {
  AUTH_EMAIL_READY_FILE,
  AuthEmailConsumer,
  type AuthEmailConsumerLogger
} from "./auth-email.consumer.js";
import type { AuthEmailNatsService } from "./auth-email-nats.service.js";

const event = createTransactionalEmailEventEnvelopeV1({
  eventId: "01900000-0000-7000-8000-000000000001",
  eventType: transactionalEmailEventTypesV1.emailVerificationRequested,
  occurredAt: new Date("2026-07-30T12:00:00.000Z"),
  traceId: "auth-email-test-trace",
  metadata: {},
  userId: "01900000-0000-7000-8000-000000000002",
  oneTimeTokenId: "01900000-0000-7000-8000-000000000003",
  locale: "ru",
  expiresAt: new Date("2026-07-30T13:00:00.000Z"),
  aggregateVersion: 1
});

test("ACKs a valid source only after the durable delivery result", async () => {
  const order: string[] = [];
  const fixture = consumerFixture({
    processEvent: async () => {
      order.push("delivery-durable");
      return { disposition: "ACK", status: "COMPLETED" };
    },
    onAck: () => order.push("source-ack")
  });

  await fixture.consumer.processMessage(fixture.message);

  assert.deepEqual(order, ["delivery-durable", "source-ack"]);
  assert.equal(fixture.calls.acks, 1);
  assert.deepEqual(fixture.calls.naks, []);
  assert.deepEqual(fixture.calls.deadLetters, []);
});

test("publishes poison input to DLQ before ACK and uses the filter fallback subject", async () => {
  const order: string[] = [];
  const fixture = consumerFixture({
    subject: "test.email.unexpected.v1",
    onDeadLetter: () => order.push("dlq-puback"),
    onAck: () => order.push("source-ack")
  });

  await fixture.consumer.processMessage(fixture.message);

  assert.deepEqual(order, ["dlq-puback", "source-ack"]);
  assert.equal(fixture.calls.deadLetters.length, 1);
  assert.equal(
    fixture.calls.deadLetters[0]?.failureCode,
    "SOURCE_SUBJECT_MISMATCH"
  );
  assert.equal(
    fixture.calls.deadLetters[0]?.source.subject,
    transactionalEmailEventFilterSubjectV1("test")
  );
});

test("does not ACK when DLQ publication is not durably acknowledged", async () => {
  const fixture = consumerFixture({
    subject: "test.email.unexpected.v1",
    deadLetterError: new Error("NATS unavailable")
  });

  await fixture.consumer.processMessage(fixture.message);

  assert.equal(fixture.calls.acks, 0);
  assert.equal(fixture.calls.naks.length, 1);
  assert.deepEqual(fixture.calls.logs, [
    "AUTH_EMAIL_CONSUMER_DEAD_LETTER_OR_ACK_FAILED"
  ]);
});

test("NAKs a busy or lease-lost durable attempt without source DLQ", async () => {
  for (const processEvent of [
    async (): Promise<AuthEmailDeliveryProcessResult> => ({
      disposition: "BUSY",
      status: "SENDING",
      retryDelayMs: 777
    }),
    async (): Promise<AuthEmailDeliveryProcessResult> => {
      throw new AuthEmailDeliveryLeaseLostError();
    }
  ]) {
    const fixture = consumerFixture({ processEvent });
    await fixture.consumer.processMessage(fixture.message);
    assert.equal(fixture.calls.acks, 0);
    assert.equal(fixture.calls.naks.length, 1);
    assert.deepEqual(fixture.calls.deadLetters, []);
  }
});

test("dead-letters invariant conflicts and exhausted unexpected failures", async () => {
  for (const [error, deliveryCount, expectedCode] of [
    [new AuthEmailDeliveryInvariantError(), 1, "EVENT_SCHEMA_INVALID"],
    [new Error("database unavailable"), 3, "PROCESSING_ATTEMPTS_EXHAUSTED"]
  ] as const) {
    const fixture = consumerFixture({
      deliveryCount,
      processEvent: async () => {
        throw error;
      }
    });
    await fixture.consumer.processMessage(fixture.message);
    assert.equal(fixture.calls.deadLetters[0]?.failureCode, expectedCode);
    assert.equal(fixture.calls.acks, 1);
    assert.deepEqual(fixture.calls.naks, []);
  }
});

test("publishes readiness only after DB, NATS and SMTP checks and removes it on shutdown", async () => {
  const fixture = consumerFixture();

  await fixture.consumer.onApplicationBootstrap();
  await access(AUTH_EMAIL_READY_FILE);
  assert.equal(fixture.calls.databasePings, 1);
  assert.equal(fixture.calls.natsChecks, 1);
  assert.equal(fixture.calls.smtpChecks, 1);
  assert.equal(fixture.calls.fetches, 1);

  await fixture.consumer.beforeApplicationShutdown();
  await assert.rejects(() => access(AUTH_EMAIL_READY_FILE));
});

test("stays alive but does not consume while SMTP startup is degraded", async () => {
  const fixture = consumerFixture({
    smtpHealthError: new Error("private SMTP detail")
  });

  await fixture.consumer.onApplicationBootstrap();
  await assert.rejects(() => access(AUTH_EMAIL_READY_FILE));
  assert.equal(fixture.calls.fetches, 0);
  assert.ok(fixture.calls.logs.includes("AUTH_EMAIL_WORKER_DEGRADED"));

  await fixture.consumer.beforeApplicationShutdown();
});

interface ConsumerFixtureOptions {
  readonly subject?: string;
  readonly deliveryCount?: number;
  readonly processEvent?: () => Promise<AuthEmailDeliveryProcessResult>;
  readonly deadLetterError?: Error;
  readonly onDeadLetter?: () => void;
  readonly onAck?: () => void;
  readonly smtpHealthError?: Error;
}

function consumerFixture(options: ConsumerFixtureOptions = {}) {
  const calls = {
    acks: 0,
    naks: [] as number[],
    deadLetters: [] as TransactionalEmailDeadLetterEnvelopeV1[],
    logs: [] as string[],
    databasePings: 0,
    natsChecks: 0,
    smtpChecks: 0,
    fetches: 0
  };
  const subject =
    options.subject ??
    transactionalEmailEventSubjectV1("test", event.eventType);
  const message = {
    subject,
    data: Buffer.from(JSON.stringify(event)),
    seq: 101,
    info: {
      stream: "AUTH_EMAIL_EVENTS",
      consumer: "jobs_auth_email_v1",
      streamSequence: 101,
      deliveryCount: options.deliveryCount ?? 1
    },
    ackAck: async () => {
      calls.acks += 1;
      options.onAck?.();
      return true;
    },
    nak: (delay?: number) => {
      calls.naks.push(delay ?? 0);
    }
  } as unknown as JsMsg;
  const nats = {
    isReady: () => true,
    healthCheck: async () => {
      calls.natsChecks += 1;
    },
    fetchMessages: async () => {
      calls.fetches += 1;
      let release = (): void => undefined;
      const closed = new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        close: async () => release(),
        async *[Symbol.asyncIterator]() {
          await closed;
          yield* [] as JsMsg[];
        }
      } as unknown as ConsumerMessages;
    },
    publishDeadLetter: async (envelope: TransactionalEmailDeadLetterEnvelopeV1) => {
      calls.deadLetters.push(envelope);
      if (options.deadLetterError) throw options.deadLetterError;
      options.onDeadLetter?.();
      return { stream: "DOMAIN_EVENTS_DLQ", seq: 1 };
    }
  } as unknown as AuthEmailNatsService;
  const deliveries = {
    processEvent:
      options.processEvent ??
      (async () => ({ disposition: "ACK", status: "COMPLETED" } as const)),
    pendingAttemptIds: async () => [],
    processAttempt: async () => ({ disposition: "ACK", status: "COMPLETED" } as const)
  } as unknown as AuthEmailDeliveryService;
  const prisma = {
    ping: async () => {
      calls.databasePings += 1;
    }
  } as unknown as PrismaService;
  const email: EmailPort = {
    isEnabled: () => true,
    healthCheck: async () => {
      calls.smtpChecks += 1;
      if (options.smtpHealthError) throw options.smtpHealthError;
    },
    send: async (transactionalEmail) => ({
      messageId: transactionalEmail.messageId
    })
  };
  const logger: AuthEmailConsumerLogger = {
    log: (code) => calls.logs.push(code),
    warn: (code) => calls.logs.push(code)
  };
  return {
    consumer: new AuthEmailConsumer(
      consumerConfig(),
      nats,
      deliveries,
      prisma,
      email,
      logger
    ),
    message,
    calls
  };
}

function consumerConfig(): AppConfig {
  return {
    authEmail: {
      enabled: true,
      environment: "test",
      streamName: "AUTH_EMAIL_EVENTS",
      durableName: "jobs_auth_email_v1",
      deadLetterStreamName: "DOMAIN_EVENTS_DLQ",
      maxAttempts: 3,
      leaseSeconds: 120,
      dispatchMs: 5_000,
      fetchExpiresMs: 1_000,
      publishTimeoutMs: 1_000,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
      maxPayloadBytes: 65_536,
      shutdownGraceMs: 5_000
    }
  } as AppConfig;
}
