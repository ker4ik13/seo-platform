import assert from "node:assert/strict";
import test from "node:test";
import type { AuditService } from "../audit/audit.service.js";
import { BillingPiiService } from "../billing/billing-pii.service.js";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import { AuthCryptoService } from "../identity/auth-crypto.service.js";
import {
  AuthEmailDeliveryService,
  tokenHashesEqual
} from "./auth-email-delivery.service.js";
import type { AuthEmailOutboxRow } from "./auth-email-outbox.js";

const EVENT_ID = "01900000-0000-7000-8000-000000000101";
const USER_ID = "01900000-0000-7000-8000-000000000102";
const TOKEN_ID = "01900000-0000-7000-8000-000000000103";
const WORKSPACE_ID = "01900000-0000-7000-8000-000000000104";
const INVITE_ID = "01900000-0000-7000-8000-000000000105";
const RECEIPT_ID = "01900000-0000-7000-8000-000000000106";
const ORDER_ID = "01900000-0000-7000-8000-000000000107";
const EXPIRES_AT = new Date("2026-07-30T11:00:00.000Z");
const DATABASE_NOW = new Date("2026-07-30T10:00:00.000Z");

test("reconstructs verification and reset tokens only inside fragment action URLs", async () => {
  for (const eventType of [
    "identity.email-verification.requested.v1",
    "identity.password-reset.requested.v1"
  ] as const) {
    const fixture = identityFixture(eventType);
    const result = await fixture.service.material(EVENT_ID);
    assert.equal(result.decision, "READY");
    if (result.decision !== "READY") continue;
    assert.equal(result.recipient, "Owner@Example.test");
    assert.equal(result.locale, "ru");
    assert.equal(result.expiresAt, EXPIRES_AT.toISOString());
    const url = new URL(result.actionUrl);
    assert.equal(url.origin, "https://app.example.test");
    assert.equal(url.search, "");
    assert.equal(
      url.pathname,
      eventType === "identity.email-verification.requested.v1"
        ? "/app/verify-email"
        : "/app/reset-password"
    );
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    assert.ok(token);
    assert.equal(
      fixture.crypto.hashOpaqueToken(token),
      fixture.token.tokenHash
    );
    assert.deepEqual(Object.keys(result).sort(), [
      "actionUrl",
      "decision",
      "eventId",
      "eventType",
      "expiresAt",
      "locale",
      "recipient",
      "schemaVersion"
    ]);
    assert.equal("token" in result, false);
  }
});

test("uses the database clock and skips consumed, expired, changed or hash-mismatched token state", async () => {
  const scenarios = [
    { token: { consumedAt: new Date() } },
    { databaseNow: EXPIRES_AT },
    { token: { tokenHash: "0".repeat(64) } },
    { token: { purpose: "PASSWORD_RESET" } },
    { user: { status: "ACTIVE", emailVerifiedAt: new Date() } }
  ] as const;

  for (const scenario of scenarios) {
    const fixture = identityFixture(
      "identity.email-verification.requested.v1",
      scenario
    );
    assert.deepEqual(await fixture.service.material(EVENT_ID), {
      schemaVersion: "auth-email-material-decision@1",
      decision: "SKIPPED",
      eventId: EVENT_ID,
      reason: "NOT_DELIVERABLE"
    });
  }
});

test("keeps exact valid one-time material deliverable after an unrelated user version change", async () => {
  for (const eventType of [
    "identity.email-verification.requested.v1",
    "identity.password-reset.requested.v1"
  ] as const) {
    const fixture = identityFixture(eventType, { user: { version: 4 } });
    assert.equal((await fixture.service.material(EVENT_ID)).decision, "READY");
  }
});

test("reconstructs active invite material and completion is idempotent SENT to DELIVERED", async () => {
  const fixture = inviteFixture();
  const material = await fixture.service.material(EVENT_ID);
  assert.equal(material.decision, "READY");
  if (material.decision !== "READY") return;
  assert.equal(material.recipient, "Invitee@Example.test");
  assert.equal(material.locale, "en");
  const url = new URL(material.actionUrl);
  assert.equal(url.pathname, "/app/workspace-invites/accept");
  assert.equal(url.search, "");
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  assert.ok(token);
  assert.equal(
    fixture.crypto.hashOpaqueToken(token),
    fixture.invite.tokenHash
  );

  const first = await fixture.service.complete(EVENT_ID, "DELIVERED");
  const second = await fixture.service.complete(EVENT_ID, "DELIVERED");
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    schemaVersion: "auth-email-completion-receipt@1",
    eventId: EVENT_ID,
    outcome: "DELIVERED"
  });
  assert.equal(fixture.appliedTransitions, 1);
  assert.equal(fixture.invite.status, "DELIVERED");
  assert.equal(
    (await fixture.service.material(EVENT_ID)).decision,
    "SKIPPED"
  );
});

test("marks a recipient-rejected workspace invitation as BOUNCED idempotently", async () => {
  const fixture = inviteFixture();
  const first = await fixture.service.complete(EVENT_ID, "BOUNCED");
  const second = await fixture.service.complete(EVENT_ID, "BOUNCED");

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    schemaVersion: "auth-email-completion-receipt@1",
    eventId: EVENT_ID,
    outcome: "BOUNCED"
  });
  assert.equal(fixture.appliedTransitions, 1);
  assert.equal(fixture.invite.status, "BOUNCED");
});

test("delivers exact NPD receipt material and records completion idempotently", async () => {
  const fixture = receiptFixture();
  const material = await fixture.service.material(EVENT_ID);

  assert.deepEqual(material, {
    schemaVersion: "auth-email-material-decision@1",
    decision: "READY_RECEIPT",
    eventId: EVENT_ID,
    eventType: "billing.npd-receipt.delivery-requested.v1",
    recipient: "Buyer@Example.test",
    locale: "ru",
    officialReceiptId: "205ldfqqhc",
    receiptUrl:
      "https://lknpd.nalog.ru/api/v1/receipt/220704837033/205ldfqqhc/print",
    grossAmountMinor: 12_500,
    currency: "RUB",
    serviceDescription: "Подписка Team на 1 месяц"
  });

  const first = await fixture.service.complete(EVENT_ID, "DELIVERED");
  const replay = await fixture.service.complete(EVENT_ID, "DELIVERED");
  assert.deepEqual(first, replay);
  assert.equal(fixture.receipt.status, "DELIVERED");
  assert.equal(fixture.receipt.version, 3);
  assert.equal(fixture.receipt.deliveryAttempts, 1);
  assert.deepEqual(fixture.receipt.deliveredAt, DATABASE_NOW);
  assert.equal(fixture.appliedTransitions, 1);
  assert.equal(fixture.auditCalls, 1);
  assert.equal(
    (await fixture.service.material(EVENT_ID)).decision,
    "SKIPPED"
  );
});

test("records a permanent NPD recipient bounce without claiming delivery", async () => {
  const fixture = receiptFixture();
  await fixture.service.complete(EVENT_ID, "BOUNCED");
  await fixture.service.complete(EVENT_ID, "BOUNCED");

  assert.equal(fixture.receipt.status, "FAILED_FINAL");
  assert.equal(fixture.receipt.deliveredAt, null);
  assert.equal(fixture.receipt.deliveryAttempts, 1);
  assert.equal(fixture.appliedTransitions, 1);
  await assert.rejects(
    fixture.service.complete(EVENT_ID, "DELIVERED"),
    TypeError
  );
});

test("skips revoked and suspended invite state without exposing material", async () => {
  for (const scenario of [
    { invite: { status: "REVOKED" } },
    { workspace: { status: "SUSPENDED" } },
    { invite: { tokenHash: "f".repeat(64) } },
    { databaseNow: EXPIRES_AT }
  ] as const) {
    const fixture = inviteFixture(scenario);
    const result = await fixture.service.material(EVENT_ID);
    assert.equal(result.decision, "SKIPPED");
    assert.equal(JSON.stringify(result).includes("Invitee@"), false);
    assert.equal(JSON.stringify(result).includes("#token="), false);
  }
});

test("rejects poisoned event state and completion never accepts an absent outbox row", async () => {
  const poisoned = identityFixture(
    "identity.email-verification.requested.v1",
    { outbox: { aggregate_type: "workspaceInvite" } }
  );
  await assert.rejects(poisoned.service.material(EVENT_ID), TypeError);

  const absent = serviceFixture({ outbox: undefined });
  assert.equal(
    (await absent.service.material(EVENT_ID)).decision,
    "SKIPPED"
  );
  await assert.rejects(
    absent.service.complete(EVENT_ID, "DELIVERED"),
    TypeError
  );
});

test("hash equality accepts only the exact digest through a fixed-length timing-safe comparison", () => {
  assert.equal(tokenHashesEqual("a".repeat(64), "a".repeat(64)), true);
  assert.equal(tokenHashesEqual("a".repeat(64), "b".repeat(64)), false);
  assert.equal(tokenHashesEqual("short", "another-length"), false);
});

function identityFixture(
  eventType:
    | "identity.email-verification.requested.v1"
    | "identity.password-reset.requested.v1",
  overrides: {
    readonly token?: Readonly<Record<string, unknown>>;
    readonly user?: Readonly<Record<string, unknown>>;
    readonly outbox?: Partial<AuthEmailOutboxRow>;
    readonly databaseNow?: Date;
  } = {}
) {
  const config = appConfig();
  const crypto = new AuthCryptoService(config);
  const purpose =
    eventType === "identity.email-verification.requested.v1"
      ? "EMAIL_VERIFICATION"
      : "PASSWORD_RESET";
  const tokenValue =
    purpose === "EMAIL_VERIFICATION"
      ? crypto.emailVerificationToken(TOKEN_ID, USER_ID, EXPIRES_AT)
      : crypto.passwordResetToken(TOKEN_ID, USER_ID, EXPIRES_AT);
  const user = {
    id: USER_ID,
    version: 3,
    emailDisplay: "Owner@Example.test",
    status:
      purpose === "EMAIL_VERIFICATION"
        ? "PENDING_VERIFICATION"
        : "ACTIVE",
    emailVerifiedAt:
      purpose === "EMAIL_VERIFICATION" ? null : new Date(),
    ...overrides.user
  };
  const token = {
    id: TOKEN_ID,
    userId: USER_ID,
    purpose,
    tokenHash: crypto.hashOpaqueToken(tokenValue),
    expiresAt: EXPIRES_AT,
    consumedAt: null,
    user,
    ...overrides.token
  };
  const outbox = {
    ...baseOutbox(),
    event_type: eventType,
    aggregate_type: "user",
    aggregate_id: USER_ID,
    aggregate_version: 3,
    workspace_id: null,
    payload: {
      userId: USER_ID,
      oneTimeTokenId: TOKEN_ID,
      locale: "ru",
      expiresAt: EXPIRES_AT.toISOString()
    },
    ...overrides.outbox
  };
  return {
    ...serviceFixture({
      outbox,
      token,
      ...(overrides.databaseNow
        ? { databaseNow: overrides.databaseNow }
        : {})
    }),
    crypto,
    token
  };
}

function inviteFixture(
  overrides: {
    readonly invite?: Readonly<Record<string, unknown>>;
    readonly workspace?: Readonly<Record<string, unknown>>;
    readonly databaseNow?: Date;
  } = {}
) {
  const config = appConfig();
  const crypto = new AuthCryptoService(config);
  const tokenValue = crypto.workspaceInvitationToken(
    INVITE_ID,
    WORKSPACE_ID,
    "invitee@example.test",
    EXPIRES_AT
  );
  const workspace = {
    id: WORKSPACE_ID,
    locale: "en",
    status: "ACTIVE",
    ...overrides.workspace
  };
  const invite = {
    id: INVITE_ID,
    workspaceId: WORKSPACE_ID,
    emailNormalized: "invitee@example.test",
    emailDisplay: "Invitee@Example.test",
    expiresAt: EXPIRES_AT,
    status: "SENT",
    tokenHash: crypto.hashOpaqueToken(tokenValue),
    workspace,
    ...overrides.invite
  };
  const fixture = serviceFixture({
    outbox: {
      ...baseOutbox(),
      event_type: "workspace.invite.requested.v1",
      aggregate_type: "workspaceInvite",
      aggregate_id: INVITE_ID,
      aggregate_version: 1,
      workspace_id: WORKSPACE_ID,
      payload: {
        inviteId: INVITE_ID,
        workspaceId: WORKSPACE_ID,
        expiresAt: EXPIRES_AT.toISOString()
      }
    },
    invite,
    ...(overrides.databaseNow
      ? { databaseNow: overrides.databaseNow }
      : {})
  });
  return {
    service: fixture.service,
    crypto,
    invite,
    get appliedTransitions() {
      return fixture.appliedTransitions;
    }
  };
}

function receiptFixture() {
  const pii = new BillingPiiService(appConfig());
  const receipt: Record<string, unknown> = {
    id: RECEIPT_ID,
    workspaceId: WORKSPACE_ID,
    version: 2,
    status: "DELIVERY_PENDING",
    currency: "RUB",
    officialReceiptId: "205ldfqqhc",
    officialReceiptUrl:
      "https://lknpd.nalog.ru/api/v1/receipt/220704837033/205ldfqqhc/print",
    registeredAt: new Date("2026-07-30T09:50:00.000Z"),
    grossAmountMinor: 12_500n,
    deliveryEmailEncrypted: pii.seal(
      "Buyer@Example.test",
      `order:${ORDER_ID}:delivery-email`
    ),
    serviceDescriptionSnapshot: "Подписка Team на 1 месяц",
    deliveredAt: null,
    deliveryAttempts: 0,
    workspace: {
      locale: "ru",
      status: "ACTIVE"
    },
    payment: {
      orderId: ORDER_ID
    }
  };
  const fixture = serviceFixture({
    outbox: {
      ...baseOutbox(),
      event_type: "billing.npd-receipt.delivery-requested.v1",
      aggregate_type: "npdReceiptObligation",
      aggregate_id: RECEIPT_ID,
      aggregate_version: 2,
      workspace_id: WORKSPACE_ID,
      payload: {
        receiptId: RECEIPT_ID,
        workspaceId: WORKSPACE_ID
      }
    },
    receipt
  });
  return {
    service: fixture.service,
    receipt,
    get appliedTransitions() {
      return fixture.appliedTransitions;
    },
    get auditCalls() {
      return fixture.auditCalls;
    }
  };
}

function serviceFixture(options: {
  readonly outbox?: AuthEmailOutboxRow | undefined;
  readonly token?: Readonly<Record<string, unknown>>;
  readonly invite?: Record<string, unknown>;
  readonly receipt?: Record<string, unknown>;
  readonly databaseNow?: Date;
}) {
  const config = appConfig();
  const crypto = new AuthCryptoService(config);
  let appliedTransitions = 0;
  let auditCalls = 0;
  const transaction = {
    $queryRaw: async () =>
      options.outbox
        ? [
            {
              ...options.outbox,
              database_now: options.databaseNow ?? DATABASE_NOW
            }
          ]
        : [],
    oneTimeToken: {
      findUnique: async () => options.token ?? null
    },
    workspaceInvite: {
      findUnique: async () => options.invite ?? null,
      updateMany: async (input: {
        readonly where: { readonly status: string };
        readonly data: { readonly status: string };
      }) => {
        if (options.invite?.status === "SENT") {
          options.invite.status = input.data.status;
          appliedTransitions += 1;
          return { count: 1 };
        }
        return { count: 0 };
      }
    },
    npdReceiptObligation: {
      findUnique: async () => options.receipt ?? null,
      updateMany: async (input: {
        readonly where: {
          readonly status: string;
          readonly version: number;
        };
        readonly data: Readonly<Record<string, unknown>>;
      }) => {
        if (
          options.receipt?.status !== input.where.status ||
          options.receipt.version !== input.where.version
        ) {
          return { count: 0 };
        }
        options.receipt.status = input.data.status;
        if (input.data.deliveredAt instanceof Date) {
          options.receipt.deliveredAt = input.data.deliveredAt;
        }
        options.receipt.deliveryAttempts =
          Number(options.receipt.deliveryAttempts) + 1;
        options.receipt.version = Number(options.receipt.version) + 1;
        appliedTransitions += 1;
        return { count: 1 };
      }
    }
  };
  const prisma = {
    $transaction: async (
      operation: (value: typeof transaction) => Promise<unknown>
    ) => operation(transaction)
  } as unknown as PrismaService;
  return {
    service: new AuthEmailDeliveryService(
      config,
      prisma,
      crypto,
      new BillingPiiService(config),
      {
        record: async () => {
          auditCalls += 1;
        }
      } as unknown as AuditService
    ),
    get appliedTransitions() {
      return appliedTransitions;
    },
    get auditCalls() {
      return auditCalls;
    }
  };
}

function baseOutbox(): AuthEmailOutboxRow {
  return {
    id: EVENT_ID,
    event_type: "identity.email-verification.requested.v1",
    aggregate_type: "user",
    aggregate_id: USER_ID,
    aggregate_version: 3,
    workspace_id: null,
    project_id: null,
    payload: {},
    metadata: {
      requestId: "request-auth-email-001",
      producer: "platform-api"
    },
    attempts: 0,
    created_at: DATABASE_NOW
  };
}

function appConfig(): AppConfig {
  return {
    webPublicUrl: "https://app.example.test",
    auth: {
      passwordPepper: "test-auth-email-pepper"
    }
  } as AppConfig;
}
