import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { NatsService } from "../messaging/nats.service.js";
import {
  boundedRetryDelayMs,
  OutboxPublisherService,
  type OutboxPublisherLogger,
  type OutboxPublisherScheduler
} from "./outbox-publisher.service.js";

const EVENT_ID = "01900000-0000-7000-8000-000000000101";
const USER_ID = "01900000-0000-7000-8000-000000000102";
const FAMILY_ID = "01900000-0000-7000-8000-000000000103";
const TOKEN_ID = "01900000-0000-7000-8000-000000000105";
const WORKSPACE_ID = "01900000-0000-7000-8000-000000000106";
const INVITE_ID = "01900000-0000-7000-8000-000000000107";

test("drains the publisher before the later database and NATS shutdown phase", () => {
  assert.equal(
    typeof OutboxPublisherService.prototype.beforeApplicationShutdown,
    "function"
  );
  assert.equal(typeof PrismaService.prototype.onApplicationShutdown, "function");
  assert.equal(typeof NatsService.prototype.onApplicationShutdown, "function");
  assert.equal("onModuleDestroy" in PrismaService.prototype, false);
  assert.equal("onModuleDestroy" in NatsService.prototype, false);
});

test("leaves the database and transport untouched when no supported row is due", async () => {
  const fixture = publisherFixture();

  assert.equal(await fixture.service.runOnce(), 0);
  assert.equal(fixture.transactionCalls, 1);
  assert.equal(fixture.publishCalls.length, 0);
  assert.equal(fixture.updateCalls.length, 0);
});

test("leaves unsupported pending event types untouched", async () => {
  const fixture = publisherFixture({
    row: outboxRow({ event_type: "identity.user.created.v1" })
  });

  assert.equal(await fixture.service.runOnce(), 0);
  assert.equal(fixture.publishCalls.length, 0);
  assert.equal(fixture.updateCalls.length, 0);
});

test("claims one row with SKIP LOCKED and publishes the exact shared envelope", async () => {
  const fixture = publisherFixture({ row: outboxRow() });

  assert.equal(await fixture.service.runOnce(), 1);
  assert.match(fixture.selectSql, /FOR UPDATE SKIP LOCKED/u);
  assert.match(fixture.selectSql, /LIMIT 1/u);
  assert.match(fixture.selectSql, /available_at <= CURRENT_TIMESTAMP/u);
  assert.match(fixture.selectSql, /ORDER BY available_at ASC, created_at ASC, id ASC/u);
  assert.deepEqual(fixture.selectValues, [
    "identity.session-family.revoked.v1",
    "identity.email-verification.requested.v1",
    "identity.password-reset.requested.v1",
    "workspace.invite.requested.v1"
  ]);
  assert.equal(fixture.publishCalls.length, 1);
  assert.deepEqual(fixture.publishCalls[0], {
    subject: "test-eu1.identity.session-family.revoked.v1",
    eventId: EVENT_ID,
    streamName: "IDENTITY_EVENTS",
    payload: {
      eventId: EVENT_ID,
      eventType: "identity.session-family.revoked.v1",
      occurredAt: "2026-07-30T10:00:00.000Z",
      producer: "platform-api",
      traceId: "request-01900000-0000-7000-8000-000000000104",
      aggregate: {
        type: "session-family",
        id: FAMILY_ID,
        version: 1
      },
      data: {
        userId: USER_ID,
        sessionFamilyId: FAMILY_ID,
        revokedAt: "2026-07-30T09:59:59.000Z"
      },
      metadata: {
        correlationId: "request-01900000-0000-7000-8000-000000000104"
      }
    }
  });
  assert.match(fixture.updateCalls[0]?.sql ?? "", /status = 'PUBLISHED'/u);
  assert.match(fixture.updateCalls[0]?.sql ?? "", /published_at = CURRENT_TIMESTAMP/u);
  assert.deepEqual(fixture.updateCalls[0]?.values, [EVENT_ID]);
});

test("publishes all three redacted transactional-email envelopes only to AUTH_EMAIL_EVENTS", async () => {
  for (const row of [
    authIdentityOutboxRow("identity.email-verification.requested.v1"),
    authIdentityOutboxRow("identity.password-reset.requested.v1"),
    authInviteOutboxRow()
  ]) {
    const fixture = publisherFixture({ row });
    assert.equal(await fixture.service.runOnce(), 1);
    assert.equal(fixture.publishCalls.length, 1);
    const published = fixture.publishCalls[0];
    assert.equal(published?.streamName, "AUTH_EMAIL_EVENTS");
    assert.equal(
      published?.subject,
      `test-eu1.email.${row.event_type}`
    );
    const serialized = JSON.stringify(published?.payload);
    assert.doesNotMatch(
      serialized,
      /recipient|emailDisplay|emailNormalized|actionUrl|tokenHash|\.signature|secret/u
    );
    assert.match(fixture.updateCalls[0]?.sql ?? "", /'PUBLISHED'/u);
  }
});

test("never publishes poisoned auth-email material and consumes the retry budget", async () => {
  const row = authIdentityOutboxRow(
    "identity.email-verification.requested.v1"
  );
  const fixture = publisherFixture({
    row: {
      ...row,
      payload: {
        ...(row.payload as Readonly<Record<string, unknown>>),
        token: "must-never-enter-the-event"
      }
    }
  });
  assert.equal(await fixture.service.runOnce(), 1);
  assert.equal(fixture.publishCalls.length, 0);
  assert.match(fixture.updateCalls[0]?.sql ?? "", /attempts =/u);
  assert.doesNotMatch(
    JSON.stringify(fixture.updateCalls),
    /must-never-enter-the-event/u
  );
});

test("treats a duplicate PubAck as a successful durable publication", async () => {
  const fixture = publisherFixture({
    row: outboxRow(),
    acknowledgement: {
      stream: "IDENTITY_EVENTS",
      seq: 71,
      duplicate: true
    }
  });

  assert.equal(await fixture.service.runOnce(), 1);
  assert.equal(fixture.updateCalls.length, 1);
  assert.match(fixture.updateCalls[0]?.sql ?? "", /'PUBLISHED'/u);
});

test("reuses the same msgID after PubAck and an ambiguous database commit", async () => {
  const fixture = publisherFixture({
    row: outboxRow(),
    transactionCommitError: new Error("commit outcome unknown")
  });

  await assert.rejects(fixture.service.runOnce(), /commit outcome unknown/u);
  assert.equal(await fixture.service.runOnce(), 1);
  assert.deepEqual(
    fixture.publishCalls.map(({ eventId }) => eventId),
    [EVENT_ID, EVENT_ID]
  );
  assert.equal(fixture.updateCalls.length, 2);
  assert.match(fixture.updateCalls[0]?.sql ?? "", /'PUBLISHED'/u);
  assert.match(fixture.updateCalls[1]?.sql ?? "", /'PUBLISHED'/u);
});

test("records bounded retry from the database clock without echoing the transport error", async () => {
  const secret = "provider-password=never-log-this";
  const fixture = publisherFixture({
    row: outboxRow({ attempts: 1 }),
    publishError: new Error(secret)
  });

  assert.equal(await fixture.service.runOnce(), 1);
  assert.equal(fixture.updateCalls.length, 1);
  const update = fixture.updateCalls[0];
  assert.match(update?.sql ?? "", /attempts =/u);
  assert.match(update?.sql ?? "", /available_at = CURRENT_TIMESTAMP \+/u);
  assert.doesNotMatch(update?.sql ?? "", /provider-password/u);
  assert.equal(update?.values[0], 2);
  assert.equal(update?.values[2], EVENT_ID);
  assert.equal(typeof update?.values[1], "number");
  assert.ok((update?.values[1] as number) >= 1_500);
  assert.ok((update?.values[1] as number) <= 2_000);
  assert.deepEqual(fixture.logs, []);
});

test("moves the row to terminal FAILED after the configured failure budget", async () => {
  const secret = "token=must-not-be-persisted";
  const fixture = publisherFixture({
    row: outboxRow({ attempts: 2 }),
    maxAttempts: 3,
    publishError: new Error(secret)
  });

  assert.equal(await fixture.service.runOnce(), 1);
  assert.equal(fixture.updateCalls.length, 1);
  assert.match(fixture.updateCalls[0]?.sql ?? "", /status = 'FAILED'/u);
  assert.match(fixture.updateCalls[0]?.sql ?? "", /available_at = CURRENT_TIMESTAMP/u);
  assert.deepEqual(fixture.updateCalls[0]?.values, [3, EVENT_ID]);
  assert.deepEqual(fixture.logs, [
    "OUTBOX_PUBLISHER_EVENT_FAILED_FINAL"
  ]);
  assert.doesNotMatch(JSON.stringify(fixture.logs), /must-not-be-persisted/u);
});

test("rejects an acknowledgement from another stream and retries the row", async () => {
  const fixture = publisherFixture({
    row: outboxRow(),
    acknowledgement: { stream: "WRONG_STREAM", seq: 1, duplicate: false }
  });

  assert.equal(await fixture.service.runOnce(), 1);
  assert.match(fixture.updateCalls[0]?.sql ?? "", /attempts =/u);
  assert.doesNotMatch(fixture.updateCalls[0]?.sql ?? "", /PUBLISHED/u);
});

test("requires AUTH_EMAIL_EVENTS PubAck for an auth-email event", async () => {
  const fixture = publisherFixture({
    row: authIdentityOutboxRow(
      "identity.email-verification.requested.v1"
    ),
    acknowledgement: {
      stream: "IDENTITY_EVENTS",
      seq: 1,
      duplicate: false
    }
  });
  assert.equal(await fixture.service.runOnce(), 1);
  assert.equal(fixture.publishCalls[0]?.streamName, "AUTH_EMAIL_EVENTS");
  assert.match(fixture.updateCalls[0]?.sql ?? "", /attempts =/u);
  assert.doesNotMatch(fixture.updateCalls[0]?.sql ?? "", /PUBLISHED/u);
});

test("redacts non-contract payload fields and replaces an unsafe request id deterministically", async () => {
  const fixture = publisherFixture({
    row: outboxRow({
      payload: {
        userId: USER_ID,
        sessionFamilyId: FAMILY_ID,
        revokedAt: "2026-07-30T09:59:59.000Z",
        refreshToken: "never-publish-me"
      },
      metadata: {
        producer: "platform-api",
        requestId: "unsafe request id",
        credential: "never-log-me"
      }
    })
  });

  assert.equal(await fixture.service.runOnce(), 1);
  const published = fixture.publishCalls[0];
  assert.equal(published?.payload.traceId, `outbox-${EVENT_ID}`);
  assert.deepEqual(published?.payload.metadata, {});
  const serialized = JSON.stringify(published?.payload);
  assert.doesNotMatch(serialized, /never-publish-me|never-log-me|unsafe request id/u);
  assert.deepEqual(fixture.logs, []);
});

test("invalid contract data is never sent and consumes the durable retry budget", async () => {
  const fixture = publisherFixture({
    row: outboxRow({
      payload: {
        userId: USER_ID,
        sessionFamilyId: FAMILY_ID,
        revokedAt: "not-a-date"
      }
    })
  });

  assert.equal(await fixture.service.runOnce(), 1);
  assert.equal(fixture.publishCalls.length, 0);
  assert.match(fixture.updateCalls[0]?.sql ?? "", /attempts =/u);
  assert.deepEqual(fixture.logs, []);
});

test("never publishes a tenant-tagged corruption as a global identity event", async () => {
  const fixture = publisherFixture({
    row: outboxRow({ workspace_id: USER_ID })
  });

  assert.equal(await fixture.service.runOnce(), 1);
  assert.equal(fixture.publishCalls.length, 0);
  assert.match(fixture.updateCalls[0]?.sql ?? "", /attempts =/u);
  assert.deepEqual(fixture.logs, []);
});

test("coalesces overlapping ticks into one active database run", async () => {
  const transaction = deferred<TransactionOutcome>();
  const fixture = publisherFixture({ transactionOverride: transaction.promise });

  const first = fixture.service.runOnce();
  const second = fixture.service.runOnce();
  assert.strictEqual(first, second);
  assert.equal(fixture.transactionCalls, 1);

  transaction.resolve("EMPTY");
  assert.equal(await first, 0);
});

test("isolates a fatal tick, reschedules it and logs only a fixed message code", async () => {
  const fixture = publisherFixture({
    transactionError: new Error("DATABASE_URL=must-never-be-logged")
  });
  fixture.service.onApplicationBootstrap();
  assert.deepEqual(fixture.scheduledDelays, [0]);

  fixture.runScheduled(0);
  await flushMicrotasks();

  assert.deepEqual(fixture.logs, ["OUTBOX_PUBLISHER_TICK_FAILED"]);
  assert.deepEqual(fixture.scheduledDelays, [1_000]);
  await fixture.service.beforeApplicationShutdown();
  assert.equal(fixture.cancelCalls, 1);
});

test("the early shutdown phase cancels the timer and waits for an in-flight bounded run", async () => {
  const transaction = deferred<TransactionOutcome>();
  const fixture = publisherFixture({ transactionOverride: transaction.promise });
  fixture.service.onApplicationBootstrap();
  const active = fixture.service.runOnce();
  let shutdownFinished = false;
  const shutdown = fixture.service.beforeApplicationShutdown().then(() => {
    shutdownFinished = true;
  });

  await Promise.resolve();
  assert.equal(shutdownFinished, false);
  assert.equal(fixture.cancelCalls, 1);
  transaction.resolve("EMPTY");
  await active;
  await shutdown;
  assert.equal(shutdownFinished, true);
});

test("uses deterministic bounded exponential jitter", () => {
  const first = boundedRetryDelayMs(EVENT_ID, 1, 1_000, 5_000);
  const second = boundedRetryDelayMs(EVENT_ID, 2, 1_000, 5_000);
  const capped = boundedRetryDelayMs(EVENT_ID, 20, 1_000, 5_000);

  assert.equal(first, boundedRetryDelayMs(EVENT_ID, 1, 1_000, 5_000));
  assert.ok(first >= 750 && first <= 1_000);
  assert.ok(second >= 1_500 && second <= 2_000);
  assert.ok(capped >= 3_750 && capped <= 5_000);
});

interface RawOutboxRow {
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

function outboxRow(overrides: Partial<RawOutboxRow> = {}): RawOutboxRow {
  return {
    id: EVENT_ID,
    event_type: "identity.session-family.revoked.v1",
    aggregate_type: "session-family",
    aggregate_id: FAMILY_ID,
    aggregate_version: 1,
    workspace_id: null,
    project_id: null,
    payload: {
      userId: USER_ID,
      sessionFamilyId: FAMILY_ID,
      revokedAt: "2026-07-30T09:59:59.000Z"
    },
    metadata: {
      producer: "platform-api",
      requestId: "request-01900000-0000-7000-8000-000000000104"
    },
    attempts: 0,
    created_at: new Date("2026-07-30T10:00:00.000Z"),
    ...overrides
  };
}

function authIdentityOutboxRow(
  eventType:
    | "identity.email-verification.requested.v1"
    | "identity.password-reset.requested.v1"
): RawOutboxRow {
  return outboxRow({
    event_type: eventType,
    aggregate_type: "user",
    aggregate_id: USER_ID,
    aggregate_version: 3,
    payload: {
      userId: USER_ID,
      oneTimeTokenId: TOKEN_ID,
      locale: "ru",
      expiresAt: "2026-07-30T10:30:00.000Z"
    }
  });
}

function authInviteOutboxRow(): RawOutboxRow {
  return outboxRow({
    event_type: "workspace.invite.requested.v1",
    aggregate_type: "workspaceInvite",
    aggregate_id: INVITE_ID,
    aggregate_version: 1,
    workspace_id: WORKSPACE_ID,
    payload: {
      inviteId: INVITE_ID,
      workspaceId: WORKSPACE_ID,
      expiresAt: "2026-08-06T10:00:00.000Z"
    }
  });
}

interface PublishCall {
  readonly subject: string;
  readonly eventId: string;
  readonly streamName: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface SqlCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

type TransactionOutcome = "EMPTY" | "PROCESSED" | "FAILED_FINAL";

function publisherFixture(options: {
  readonly row?: RawOutboxRow;
  readonly maxAttempts?: number;
  readonly acknowledgement?: {
    readonly stream: string;
    readonly seq: number;
    readonly duplicate: boolean;
  };
  readonly publishError?: Error;
  readonly transactionError?: Error;
  readonly transactionCommitError?: Error;
  readonly transactionOverride?: Promise<TransactionOutcome>;
} = {}): {
  readonly service: OutboxPublisherService;
  readonly publishCalls: PublishCall[];
  readonly updateCalls: SqlCall[];
  readonly logs: string[];
  readonly scheduledDelays: number[];
  readonly selectValues: readonly unknown[];
  readonly selectSql: string;
  readonly transactionCalls: number;
  readonly cancelCalls: number;
  runScheduled(index: number): void;
} {
  const publishCalls: PublishCall[] = [];
  const updateCalls: SqlCall[] = [];
  const logs: string[] = [];
  const scheduled: Array<{ readonly task: () => void; readonly delayMs: number }> = [];
  let selectSql = "";
  let selectValues: readonly unknown[] = [];
  let transactionCalls = 0;
  let commitErrorRaised = false;
  let cancelCalls = 0;

  const transaction = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      selectSql = normalizeSql(strings);
      selectValues = values;
      const row = options.row;
      return row && values.includes(row.event_type) ? [row] : [];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      updateCalls.push({ sql: normalizeSql(strings), values });
      return 1;
    }
  };
  const prisma = {
    $transaction: async (
      operation: (value: typeof transaction) => Promise<TransactionOutcome>
    ): Promise<TransactionOutcome> => {
      transactionCalls += 1;
      if (options.transactionOverride) return options.transactionOverride;
      if (options.transactionError) throw options.transactionError;
      const result = await operation(transaction);
      if (options.transactionCommitError && !commitErrorRaised) {
        commitErrorRaised = true;
        throw options.transactionCommitError;
      }
      return result;
    }
  } as unknown as PrismaService;
  const nats = {
    publishOutboxEvent: async (
      subject: string,
      payload: string,
      eventId: string,
      streamName: string
    ) => {
      publishCalls.push({
        subject,
        eventId,
        streamName,
        payload: JSON.parse(payload) as Readonly<Record<string, unknown>>
      });
      if (options.publishError) throw options.publishError;
      return (
        options.acknowledgement ?? {
          stream: streamName,
          seq: 70,
          duplicate: false
        }
      );
    }
  } as unknown as NatsService;
  const scheduler: OutboxPublisherScheduler = {
    schedule: (task, delayMs) => {
      const handle = { task, delayMs };
      scheduled.push(handle);
      return handle;
    },
    cancel: () => {
      cancelCalls += 1;
    }
  };
  const logger: OutboxPublisherLogger = {
    warn: (message) => logs.push(message)
  };
  const config = {
    outboxPublisher: {
      enabled: true,
      eventEnvironment: "test-eu1",
      streamName: "IDENTITY_EVENTS",
      authEmailStreamName: "AUTH_EMAIL_EVENTS",
      pollIntervalMs: 1_000,
      batchSize: 1,
      maxAttempts: options.maxAttempts ?? 5,
      retryBaseMs: 1_000,
      retryMaxMs: 5_000,
      publishTimeoutMs: 500
    }
  } as AppConfig;
  const service = new OutboxPublisherService(
    config,
    prisma,
    nats,
    scheduler,
    logger
  );

  return {
    service,
    publishCalls,
    updateCalls,
    logs,
    get scheduledDelays() {
      return scheduled.map(({ delayMs }) => delayMs);
    },
    get selectValues() {
      return selectValues;
    },
    get selectSql() {
      return selectSql;
    },
    get transactionCalls() {
      return transactionCalls;
    },
    get cancelCalls() {
      return cancelCalls;
    },
    runScheduled(index) {
      const task = scheduled.splice(index, 1)[0];
      assert.ok(task);
      task.task();
    }
  };
}

function normalizeSql(strings: TemplateStringsArray): string {
  return strings.join("?").replace(/\s+/gu, " ").trim();
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      assert.ok(resolvePromise);
      resolvePromise(value);
    }
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}
