import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA,
  AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
  createTransactionalEmailEventEnvelopeV1,
  transactionalEmailEventTypesV1,
  type InternalAuthEmailMaterialDecisionV1,
  type TransactionalEmailDeadLetterEnvelopeV1,
  type TransactionalEmailEventEnvelopeV1
} from "@seo-platform/contracts";
import type {
  AuthEmailDeliveryAttempt,
  AuthEmailDeliveryStatus
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import {
  EmailDeliveryError,
  type EmailPort,
  type TransactionalEmail
} from "../email/email.port.js";
import type { AuthEmailMaterialClient } from "./auth-email-material.client.js";
import type { AuthEmailNatsService } from "./auth-email-nats.service.js";
import {
  AuthEmailDeliveryDeadLetterPendingError,
  AuthEmailDeliveryLeaseLostError,
  AuthEmailDeliveryService
} from "./auth-email-delivery.service.js";

const sourceHash = Buffer.alloc(32, 7);
const initialNow = new Date("2026-07-30T12:00:00.000Z");

test("claims in PostgreSQL before JIT material, sends once and idempotently completes an invite", async () => {
  const fixture = deliveryFixture();

  const result = await fixture.service.processEvent(fixture.event, sourceHash);
  const replay = await fixture.service.processEvent(fixture.event, sourceHash);

  assert.deepEqual(result, { disposition: "ACK", status: "COMPLETED" });
  assert.deepEqual(replay, { disposition: "ACK", status: "COMPLETED" });
  assert.deepEqual(fixture.calls.order.slice(0, 3), [
    "db-claim",
    "material",
    "smtp"
  ]);
  assert.equal(fixture.calls.messages.length, 1);
  assert.deepEqual(fixture.calls.completions, [
    { eventId: fixture.event.eventId, outcome: "DELIVERED" }
  ]);
  assert.equal(fixture.row()?.status, "COMPLETED");
  assert.equal(fixture.row()?.attempts, 1);
  assert.equal(
    fixture.calls.messages[0]?.messageId,
    `<auth-email-${fixture.event.eventId}@mail.example.test>`
  );
  assertRedacted(fixture.row());
});

test("sends an official NPD receipt and durably completes its Platform state", async () => {
  const fixture = deliveryFixture({ receipt: true });
  const result = await fixture.service.processEvent(fixture.event, sourceHash);

  assert.deepEqual(result, { disposition: "ACK", status: "COMPLETED" });
  assert.equal(fixture.calls.messages.length, 1);
  assert.equal(
    fixture.calls.messages[0]?.subject,
    "Ваш чек об оплате SEO Workspace"
  );
  assert.match(
    fixture.calls.messages[0]?.text ?? "",
    /https:\/\/lknpd\.nalog\.ru\/api\/v1\/receipt\//u
  );
  assert.deepEqual(fixture.calls.completions, [
    { eventId: fixture.event.eventId, outcome: "DELIVERED" }
  ]);
  assertRedacted(fixture.row());
});

test("cancels stale or skipped material without SMTP access", async () => {
  for (const material of ["SKIPPED", "EXPIRED"] as const) {
    const fixture = deliveryFixture({ material });
    const result = await fixture.service.processEvent(fixture.event, sourceHash);

    assert.deepEqual(result, { disposition: "ACK", status: "CANCELLED" });
    assert.equal(fixture.row()?.status, "CANCELLED");
    assert.equal(fixture.calls.messages.length, 0);
    assert.deepEqual(fixture.calls.completions, []);
  }
});

test("durably schedules retryable SMTP failures and resumes after retryAt", async () => {
  let sends = 0;
  const fixture = deliveryFixture({
    send: async (message) => {
      sends += 1;
      if (sends === 1) {
        throw new EmailDeliveryError("SMTP_TEMPORARY_REJECTION", true);
      }
      return { messageId: message.messageId };
    }
  });

  const first = await fixture.service.processEvent(fixture.event, sourceHash);
  assert.deepEqual(first, {
    disposition: "ACK",
    status: "RETRY_SCHEDULED"
  });
  const retryAt = fixture.row()?.retryAt;
  assert.ok(retryAt instanceof Date && retryAt > initialNow);

  fixture.setNow(new Date(retryAt.getTime() + 1));
  const second = await fixture.service.processEvent(fixture.event, sourceHash);
  assert.deepEqual(second, { disposition: "ACK", status: "COMPLETED" });
  assert.equal(sends, 2);
  assert.equal(fixture.row()?.attempts, 2);
});

test("resumes completion only after a durable SMTP receipt at the attempt limit", async () => {
  let completionCalls = 0;
  const fixture = deliveryFixture({
    maxAttempts: 1,
    complete: async () => {
      completionCalls += 1;
      if (completionCalls === 1) {
        throw new Error("Platform temporarily unavailable");
      }
    }
  });

  const first = await fixture.service.processEvent(fixture.event, sourceHash);
  assert.deepEqual(first, {
    disposition: "ACK",
    status: "RETRY_SCHEDULED"
  });
  assert.equal(fixture.row()?.attempts, 1);
  assert.equal(fixture.calls.messages.length, 1);
  assert.ok(fixture.row()?.providerMessageId);
  assert.equal(fixture.calls.deadLetters.length, 0);

  const retryAt = fixture.row()?.retryAt;
  assert.ok(retryAt instanceof Date);
  fixture.setNow(new Date(retryAt.getTime() + 1));
  const recovered = await fixture.service.processAttempt(fixture.row()!.id);

  assert.deepEqual(recovered, { disposition: "ACK", status: "COMPLETED" });
  assert.equal(fixture.row()?.attempts, 1);
  assert.equal(fixture.calls.messages.length, 1);
  assert.equal(fixture.calls.completions.length, 2);
  assert.equal(fixture.calls.deadLetters.length, 0);
});

test("requires durable DLQ PubAck before terminalizing exhausted delivery", async () => {
  let dlqUnavailable = true;
  const fixture = deliveryFixture({
    maxAttempts: 1,
    send: async () => {
      throw new EmailDeliveryError("SMTP_TRANSPORT_UNAVAILABLE", true);
    },
    publishDeadLetter: async () => {
      if (dlqUnavailable) throw new Error("NATS unavailable");
    }
  });

  await assert.rejects(
    () => fixture.service.processEvent(fixture.event, sourceHash),
    AuthEmailDeliveryDeadLetterPendingError
  );
  assert.equal(fixture.row()?.status, "DLQ_PENDING");
  assert.equal(fixture.calls.deadLetters.length, 1);

  dlqUnavailable = false;
  const leaseExpiry = fixture.row()?.leaseExpiresAt;
  assert.ok(leaseExpiry instanceof Date);
  fixture.setNow(new Date(leaseExpiry.getTime() + 1));
  const terminal = await fixture.service.processAttempt(fixture.row()!.id);

  assert.deepEqual(terminal, {
    disposition: "ACK",
    status: "FAILED_FINAL"
  });
  assert.equal(fixture.calls.deadLetters.length, 2);
  assert.equal(
    fixture.calls.deadLetters[1]?.failureCode,
    "DELIVERY_ATTEMPTS_EXHAUSTED"
  );
  assert.equal(fixture.row()?.status, "FAILED_FINAL");
});

test("requires durable DLQ PubAck before terminalizing a permanent failure", async () => {
  let dlqUnavailable = true;
  const fixture = deliveryFixture({
    send: async () => {
      throw new EmailDeliveryError("SMTP_RECIPIENT_REJECTED", false);
    },
    publishDeadLetter: async () => {
      if (dlqUnavailable) throw new Error("NATS unavailable");
    }
  });

  await assert.rejects(
    () => fixture.service.processEvent(fixture.event, sourceHash),
    AuthEmailDeliveryDeadLetterPendingError
  );
  assert.equal(fixture.row()?.status, "DLQ_PENDING");
  assert.equal(
    fixture.calls.deadLetters[0]?.failureCode,
    "DELIVERY_PERMANENT_FAILURE"
  );

  dlqUnavailable = false;
  const leaseExpiry = fixture.row()?.leaseExpiresAt;
  assert.ok(leaseExpiry instanceof Date);
  fixture.setNow(new Date(leaseExpiry.getTime() + 1));
  const terminal = await fixture.service.processAttempt(fixture.row()!.id);

  assert.equal(terminal.status, "FAILED_FINAL");
  assert.equal(
    fixture.calls.deadLetters[1]?.failureCode,
    "DELIVERY_PERMANENT_FAILURE"
  );
  assert.deepEqual(fixture.calls.completions, [
    { eventId: fixture.event.eventId, outcome: "BOUNCED" }
  ]);
  assert.equal(fixture.row()?.status, "FAILED_FINAL");
});

test("keeps BOUNCED callback durable after DLQ PubAck until Platform recovers", async () => {
  let platformUnavailable = true;
  const fixture = deliveryFixture({
    send: async () => {
      throw new EmailDeliveryError("SMTP_RECIPIENT_REJECTED", false);
    },
    complete: async () => {
      if (platformUnavailable) throw new Error("Platform unavailable");
    }
  });

  await assert.rejects(
    () => fixture.service.processEvent(fixture.event, sourceHash),
    AuthEmailDeliveryDeadLetterPendingError
  );
  assert.equal(fixture.row()?.status, "DLQ_PENDING");
  assert.deepEqual(fixture.calls.order.slice(-2), [
    "dlq-puback",
    "completion"
  ]);

  platformUnavailable = false;
  const leaseExpiry = fixture.row()?.leaseExpiresAt;
  assert.ok(leaseExpiry instanceof Date);
  fixture.setNow(new Date(leaseExpiry.getTime() + 1));
  const terminal = await fixture.service.processAttempt(fixture.row()!.id);

  assert.equal(terminal.status, "FAILED_FINAL");
  assert.equal(fixture.calls.deadLetters.length, 2);
  assert.equal(fixture.calls.completions.length, 2);
});

test("documents the SMTP accept to DB crash window with a stable replay Message-ID", async () => {
  const fixture = deliveryFixture({ failFirstSmtpReceiptWrite: true });

  await assert.rejects(
    () => fixture.service.processEvent(fixture.event, sourceHash),
    AuthEmailDeliveryLeaseLostError
  );
  assert.equal(fixture.calls.messages.length, 1);
  assert.equal(fixture.row()?.status, "SENDING");

  const leaseExpiry = fixture.row()?.leaseExpiresAt;
  assert.ok(leaseExpiry instanceof Date);
  fixture.setNow(new Date(leaseExpiry.getTime() + 1));
  const recovered = await fixture.service.processEvent(fixture.event, sourceHash);

  assert.deepEqual(recovered, { disposition: "ACK", status: "COMPLETED" });
  assert.equal(fixture.calls.messages.length, 2);
  assert.equal(
    fixture.calls.messages[0]?.messageId,
    fixture.calls.messages[1]?.messageId
  );
  assert.equal(fixture.row()?.attempts, 2);
});

interface DeliveryFixtureOptions {
  readonly material?: "READY" | "SKIPPED" | "EXPIRED";
  readonly receipt?: boolean;
  readonly maxAttempts?: number;
  readonly failFirstSmtpReceiptWrite?: boolean;
  readonly send?: EmailPort["send"];
  readonly publishDeadLetter?: (
    envelope: TransactionalEmailDeadLetterEnvelopeV1
  ) => Promise<void>;
  readonly complete?: (
    eventId: string,
    outcome: "DELIVERED" | "BOUNCED"
  ) => Promise<void>;
}

function deliveryFixture(options: DeliveryFixtureOptions = {}) {
  let now = new Date(initialNow);
  let stored: AuthEmailDeliveryAttempt | undefined;
  let failSmtpReceiptWrite = options.failFirstSmtpReceiptWrite ?? false;
  const event = options.receipt ? receiptEvent() : inviteEvent();
  const calls = {
    order: [] as string[],
    messages: [] as TransactionalEmail[],
    completions: [] as Array<{
      readonly eventId: string;
      readonly outcome: "DELIVERED" | "BOUNCED";
    }>,
    deadLetters: [] as TransactionalEmailDeadLetterEnvelopeV1[]
  };
  const prisma = {
    authEmailDeliveryAttempt: {
      findUnique: async ({ where }: { where: { id?: string; sourceEventId?: string } }) => {
        if (!stored) return null;
        if (where.id && where.id !== stored.id) return null;
        if (where.sourceEventId && where.sourceEventId !== stored.sourceEventId) return null;
        return cloneRow(stored);
      },
      create: async ({ data }: { data: { sourceEventId: string; eventType: string; sourceEventHash: Uint8Array } }) => {
        stored = newRow(data, now);
        return cloneRow(stored);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!stored || !matches(stored, where)) return { count: 0 };
        if (failSmtpReceiptWrite && typeof data.providerMessageId === "string") {
          failSmtpReceiptWrite = false;
          return { count: 0 };
        }
        if (data.status === "SENDING" || data.status === "SMTP_ACCEPTED") {
          calls.order.push("db-claim");
        }
        stored = applyMutation(stored, data, now);
        return { count: 1 };
      },
      findMany: async () => (stored ? [{ id: stored.id }] : [])
    },
    $queryRaw: async () => [{ now: new Date(now) }]
  } as unknown as PrismaService;
  const materialClient = {
    material: async (): Promise<InternalAuthEmailMaterialDecisionV1> => {
      calls.order.push("material");
      if (options.material === "SKIPPED") {
        return {
          schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
          decision: "SKIPPED",
          eventId: event.eventId,
          reason: "NOT_DELIVERABLE"
        };
      }
      if (
        event.eventType ===
        transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested
      ) {
        return readyReceiptMaterial(event);
      }
      return readyMaterial(
        event,
        options.material === "EXPIRED"
          ? "2026-07-30T11:59:59.000Z"
          : "2026-08-01T12:00:00.000Z"
      );
    },
    complete: async (
      eventId: string,
      outcome: "DELIVERED" | "BOUNCED" = "DELIVERED"
    ) => {
      calls.completions.push({ eventId, outcome });
      calls.order.push("completion");
      await options.complete?.(eventId, outcome);
      return {
        schemaVersion: AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA,
        eventId,
        outcome
      } as const;
    }
  } as unknown as AuthEmailMaterialClient;
  const email: EmailPort = {
    isEnabled: () => true,
    healthCheck: async () => undefined,
    send: async (message) => {
      calls.order.push("smtp");
      calls.messages.push(message);
      return options.send
        ? options.send(message)
        : { messageId: message.messageId };
    }
  };
  const nats = {
    publishDeadLetter: async (envelope: TransactionalEmailDeadLetterEnvelopeV1) => {
      calls.deadLetters.push(envelope);
      await options.publishDeadLetter?.(envelope);
      calls.order.push("dlq-puback");
      return { stream: "DOMAIN_EVENTS_DLQ", seq: calls.deadLetters.length };
    }
  } as unknown as AuthEmailNatsService;
  return {
    event,
    service: new AuthEmailDeliveryService(
      deliveryConfig(options.maxAttempts ?? 3),
      prisma,
      materialClient,
      nats,
      email
    ),
    calls,
    row: () => stored,
    setNow: (value: Date) => {
      now = new Date(value);
    }
  };
}

function receiptEvent(): Extract<
  TransactionalEmailEventEnvelopeV1,
  {
    readonly eventType:
      "billing.npd-receipt.delivery-requested.v1";
  }
> {
  return createTransactionalEmailEventEnvelopeV1({
    eventId: "01900000-0000-7000-8000-000000000021",
    eventType:
      transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested,
    occurredAt: new Date("2026-07-30T11:50:00.000Z"),
    traceId: "npd-receipt-delivery-test",
    metadata: {},
    receiptId: "01900000-0000-7000-8000-000000000022",
    workspaceId: "01900000-0000-7000-8000-000000000013",
    aggregateVersion: 2
  });
}

function inviteEvent(): Extract<
  TransactionalEmailEventEnvelopeV1,
  { readonly eventType: "workspace.invite.requested.v1" }
> {
  return createTransactionalEmailEventEnvelopeV1({
    eventId: "01900000-0000-7000-8000-000000000011",
    eventType: transactionalEmailEventTypesV1.workspaceInviteRequested,
    occurredAt: new Date("2026-07-30T11:50:00.000Z"),
    traceId: "auth-email-delivery-test",
    metadata: {},
    inviteId: "01900000-0000-7000-8000-000000000012",
    workspaceId: "01900000-0000-7000-8000-000000000013",
    expiresAt: new Date("2026-08-01T12:00:00.000Z")
  });
}

function readyMaterial(
  event: Extract<
    TransactionalEmailEventEnvelopeV1,
    { readonly eventType: "workspace.invite.requested.v1" }
  >,
  expiresAt: string
): InternalAuthEmailMaterialDecisionV1 {
  return {
    schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
    decision: "READY",
    eventId: event.eventId,
    eventType: event.eventType,
    recipient: "invitee@example.test",
    locale: "ru",
    expiresAt,
    actionUrl: "https://app.example.test/invite#token=one_time~secret"
  };
}

function readyReceiptMaterial(
  event: Extract<
    TransactionalEmailEventEnvelopeV1,
    {
      readonly eventType:
        "billing.npd-receipt.delivery-requested.v1";
    }
  >
): InternalAuthEmailMaterialDecisionV1 {
  return {
    schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
    decision: "READY_RECEIPT",
    eventId: event.eventId,
    eventType: event.eventType,
    recipient: "buyer@example.test",
    locale: "ru",
    officialReceiptId: "205ldfqqhc",
    receiptUrl:
      "https://lknpd.nalog.ru/api/v1/receipt/220704837033/205ldfqqhc/print",
    grossAmountMinor: 12_500,
    currency: "RUB",
    serviceDescription: "Подписка Team на 1 месяц"
  };
}

function deliveryConfig(maxAttempts: number): AppConfig {
  return {
    email: {
      enabled: true,
      messageIdDomain: "mail.example.test"
    },
    authEmail: {
      enabled: true,
      environment: "test",
      streamName: "AUTH_EMAIL_EVENTS",
      durableName: "jobs_auth_email_v1",
      deadLetterStreamName: "DOMAIN_EVENTS_DLQ",
      maxAttempts,
      leaseSeconds: 120,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000
    }
  } as AppConfig;
}

function newRow(
  data: {
    readonly sourceEventId: string;
    readonly eventType: string;
    readonly sourceEventHash: Uint8Array;
  },
  now: Date
): AuthEmailDeliveryAttempt {
  return {
    id: "01900000-0000-7000-8000-000000000099",
    sourceEventId: data.sourceEventId,
    eventType: data.eventType,
    sourceEventHash: Buffer.from(data.sourceEventHash),
    status: "PENDING",
    attempts: 0,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    retryAt: null,
    providerMessageId: null,
    lastErrorCode: null,
    smtpAcceptedAt: null,
    completedAt: null,
    cancelledAt: null,
    failedAt: null,
    version: 1,
    createdAt: new Date(now),
    updatedAt: new Date(now)
  };
}

function matches(
  row: AuthEmailDeliveryAttempt,
  where: Record<string, unknown>
): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "id") return row.id === value;
    if (key === "version") return row.version === value;
    if (key === "leaseOwner") return row.leaseOwner === value;
    if (key === "leaseToken") return row.leaseToken === value;
    return true;
  });
}

function applyMutation(
  row: AuthEmailDeliveryAttempt,
  data: Record<string, unknown>,
  now: Date
): AuthEmailDeliveryAttempt {
  const next = { ...row } as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    if (
      typeof value === "object" &&
      value !== null &&
      "increment" in value &&
      typeof value.increment === "number"
    ) {
      next[key] = Number(next[key]) + value.increment;
    } else {
      next[key] = value;
    }
  }
  next.updatedAt = new Date(now);
  return next as unknown as AuthEmailDeliveryAttempt;
}

function cloneRow(row: AuthEmailDeliveryAttempt): AuthEmailDeliveryAttempt {
  return {
    ...row,
    sourceEventHash: Buffer.from(row.sourceEventHash)
  };
}

function assertRedacted(row: AuthEmailDeliveryAttempt | undefined): void {
  assert.ok(row);
  const serialized = JSON.stringify(row).toLowerCase();
  for (const privateValue of [
    "invitee@example.test",
    "one_time~secret",
    "actionurl",
    "recipient",
    "subject",
    "html"
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
  assert.ok(
    [
      "PENDING",
      "SENDING",
      "RETRY_SCHEDULED",
      "SMTP_ACCEPTED",
      "DLQ_PENDING",
      "COMPLETED",
      "CANCELLED",
      "FAILED_FINAL"
    ].includes(row.status satisfies AuthEmailDeliveryStatus)
  );
}
