import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, Session, User } from "../generated/prisma/client.js";
import type { AuditService } from "../audit/audit.service.js";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import type { AuthCryptoService } from "./auth-crypto.service.js";
import type {
  AuthenticatedPrincipal,
  RequestContext
} from "./identity.types.js";
import { SessionService } from "./session.service.js";

const USER_ID = "01900000-0000-7000-8000-000000000001";
const OTHER_USER_ID = "01900000-0000-7000-8000-000000000002";
const CURRENT_FAMILY_ID = "01900000-0000-7000-8000-000000000010";
const OTHER_FAMILY_ID = "01900000-0000-7000-8000-000000000020";
const REQUEST: RequestContext = { requestId: "request-session-lifecycle" };

interface MutableSession {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  revokedAt: Date | null;
  readonly replacedBySessionId?: string | null;
  readonly expiresAt?: Date;
}

interface RecordedOutboxEvent {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: unknown;
  readonly requestId: string;
}

interface FakeSessionStore {
  readonly transaction: Prisma.TransactionClient;
  readonly sessions: MutableSession[];
  readonly calls: string[];
}

test("revokes a whole family once and emits one exact redacted event", async () => {
  const store = fakeSessionStore([
    mutableSession("session-a1", USER_ID, CURRENT_FAMILY_ID),
    mutableSession("session-a2", USER_ID, CURRENT_FAMILY_ID),
    mutableSession("session-b1", USER_ID, OTHER_FAMILY_ID)
  ]);
  const events: RecordedOutboxEvent[] = [];
  const service = sessionService({
    transaction: store.transaction,
    events
  });

  const first = await service.revokeFamilies(store.transaction, {
    userId: USER_ID,
    familyIds: [CURRENT_FAMILY_ID, CURRENT_FAMILY_ID],
    requestId: REQUEST.requestId
  });
  const second = await service.revokeFamilies(store.transaction, {
    userId: USER_ID,
    familyIds: [CURRENT_FAMILY_ID],
    requestId: REQUEST.requestId
  });

  assert.deepEqual(first, {
    revokedSessionCount: 2,
    revokedFamilyIds: [CURRENT_FAMILY_ID]
  });
  assert.deepEqual(second, {
    revokedSessionCount: 0,
    revokedFamilyIds: []
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    eventType: "identity.session-family.revoked.v1",
    aggregateType: "session-family",
    aggregateId: CURRENT_FAMILY_ID,
    aggregateVersion: 1,
    payload: {
      userId: USER_ID,
      sessionFamilyId: CURRENT_FAMILY_ID,
      revokedAt: store.sessions[0]!.revokedAt!.toISOString()
    },
    requestId: REQUEST.requestId
  });
  assert.equal(
    store.sessions[0]!.revokedAt?.getTime(),
    store.sessions[1]!.revokedAt?.getTime()
  );
  assert.equal(store.sessions[2]!.revokedAt, null);
  assert.deepEqual(
    store.calls.filter((call) => call === "lock"),
    ["lock", "lock"]
  );
});

test("DELETE resolves only a user-owned target and revokes its whole family", async () => {
  const ownFamilyId = "01900000-0000-7000-8000-000000000030";
  const store = fakeSessionStore([
    mutableSession("current", USER_ID, CURRENT_FAMILY_ID),
    mutableSession("own-target", USER_ID, ownFamilyId),
    mutableSession("own-sibling", USER_ID, ownFamilyId),
    mutableSession("foreign-target", OTHER_USER_ID, OTHER_FAMILY_ID)
  ]);
  const events: RecordedOutboxEvent[] = [];
  const service = sessionService({
    transaction: store.transaction,
    events
  });
  const principal = principalFor(CURRENT_FAMILY_ID);

  assert.equal(
    await service.revoke(principal, "foreign-target", REQUEST),
    false
  );
  assert.equal(store.sessions[3]!.revokedAt, null);
  assert.equal(events.length, 0);

  assert.equal(await service.revoke(principal, "own-target", REQUEST), true);
  assert.ok(store.sessions[1]!.revokedAt);
  assert.ok(store.sessions[2]!.revokedAt);
  assert.equal(store.sessions[0]!.revokedAt, null);
  assert.equal(events.length, 1);

  assert.equal(await service.revoke(principal, "own-target", REQUEST), false);
  assert.equal(events.length, 1, "idempotent delete must not emit again");
});

test("revoke others excludes every row in the principal family", async () => {
  const store = fakeSessionStore([
    mutableSession("current", USER_ID, CURRENT_FAMILY_ID),
    mutableSession("current-sibling", USER_ID, CURRENT_FAMILY_ID),
    mutableSession("other", USER_ID, OTHER_FAMILY_ID)
  ]);
  const events: RecordedOutboxEvent[] = [];
  const service = sessionService({
    transaction: store.transaction,
    events
  });

  const revoked = await service.revokeOthers(
    principalFor(CURRENT_FAMILY_ID),
    REQUEST
  );

  assert.equal(revoked, 1);
  assert.equal(store.sessions[0]!.revokedAt, null);
  assert.equal(store.sessions[1]!.revokedAt, null);
  assert.ok(store.sessions[2]!.revokedAt);
  assert.equal(events[0]?.aggregateId, OTHER_FAMILY_ID);
});

test("stale revoke-others principal cannot revoke a newer family after reset", async () => {
  const staleCurrent = mutableSession(
    "current",
    USER_ID,
    CURRENT_FAMILY_ID
  );
  staleCurrent.revokedAt = new Date("2026-07-29T12:00:00.000Z");
  const newer = mutableSession("newer", USER_ID, OTHER_FAMILY_ID);
  const store = fakeSessionStore([staleCurrent, newer]);
  const events: RecordedOutboxEvent[] = [];
  const service = sessionService({
    transaction: store.transaction,
    events
  });

  await assert.rejects(
    service.revokeOthers(principalFor(CURRENT_FAMILY_ID), REQUEST),
    (error: unknown) =>
      error instanceof DomainError && error.code === "UNAUTHENTICATED"
  );
  assert.equal(newer.revokedAt, null);
  assert.equal(events.length, 0);
});

test("issue acquires the same user advisory lock before creating a session", async () => {
  const calls: string[] = [];
  const created = sessionRecord({
    id: "01900000-0000-7000-8000-000000000100",
    familyId: CURRENT_FAMILY_ID
  });
  const transaction = {
    $queryRaw: async () => {
      calls.push("lock");
      return [];
    },
    user: {
      findFirst: async () => ({ id: USER_ID })
    },
    session: {
      create: async () => {
        calls.push("create");
        return created;
      }
    }
  } as unknown as Prisma.TransactionClient;
  const service = sessionService({ transaction, events: [] });

  await service.issue(
    transaction,
    { id: USER_ID, version: 1 },
    REQUEST,
    CURRENT_FAMILY_ID
  );

  assert.deepEqual(calls, ["lock", "create"]);
});

test("advisory lock casts PostgreSQL void for Prisma driver adapters", async () => {
  let sql = "";
  let parameters: readonly unknown[] = [];
  const transaction = {
    $queryRaw: async (
      strings: TemplateStringsArray,
      ...values: readonly unknown[]
    ) => {
      sql = strings.join("?");
      parameters = values;
      return [{ lock_result: "" }];
    }
  } as unknown as Prisma.TransactionClient;
  const service = sessionService({ transaction, events: [] });

  await service.lockUserSessionLifecycle(transaction, USER_ID);

  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /::text AS lock_result/u);
  assert.deepEqual(parameters, [`identity-session-user:${USER_ID}`]);
});

test("issue rejects a stale user version after acquiring the lifecycle lock", async () => {
  const calls: string[] = [];
  const transaction = {
    $queryRaw: async () => {
      calls.push("lock");
      return [];
    },
    user: {
      findFirst: async () => null
    },
    session: {
      create: async () => {
        calls.push("create");
        return sessionRecord({
          id: "01900000-0000-7000-8000-000000000104",
          familyId: CURRENT_FAMILY_ID
        });
      }
    }
  } as unknown as Prisma.TransactionClient;
  const service = sessionService({ transaction, events: [] });

  await assert.rejects(
    service.issue(
      transaction,
      { id: USER_ID, version: 1 },
      REQUEST,
      CURRENT_FAMILY_ID
    ),
    (error: unknown) =>
      error instanceof DomainError && error.code === "UNAUTHENTICATED"
  );
  assert.deepEqual(calls, ["lock"]);
});

test("refresh-token reuse re-reads under lock, commits revoke/outbox, then fails", async () => {
  const replacementId = "01900000-0000-7000-8000-000000000102";
  const current = sessionRecord({
    id: "01900000-0000-7000-8000-000000000101",
    familyId: CURRENT_FAMILY_ID,
    revokedAt: new Date("2026-07-29T10:00:00.000Z"),
    replacedBySessionId: replacementId,
    expiresAt: new Date("2099-01-01T00:00:00.000Z")
  });
  const replacement = mutableSession(
    replacementId,
    USER_ID,
    CURRENT_FAMILY_ID
  );
  const calls: string[] = [];
  const events: RecordedOutboxEvent[] = [];
  let committed = false;
  const transaction = fakeSessionStore([replacement], calls).transaction;
  const transactionSession = transaction.session as unknown as {
    findFirst: () => Promise<Session & { user: User }>;
  };
  transactionSession.findFirst = async () => {
    calls.push("locked-reread");
    return { ...current, user: userRecord() };
  };
  const prisma = {
    session: {
      findUnique: async () => ({
        id: current.id,
        userId: current.userId
      })
    },
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>
    ) => {
      const result = await callback(transaction);
      committed = true;
      calls.push("commit");
      return result;
    }
  } as unknown as PrismaService;
  const service = sessionService({ prisma, transaction, events });

  await assert.rejects(
    service.rotate("reused-refresh", undefined, undefined, REQUEST),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "UNAUTHENTICATED" &&
      committed
  );

  assert.ok(replacement.revokedAt);
  assert.equal(events.length, 1);
  assert.ok(calls.indexOf("lock") < calls.indexOf("locked-reread"));
  assert.ok(calls.indexOf("locked-reread") < calls.indexOf("commit"));
});

test("full refresh expiry commits terminal family revoke before auth failure", async () => {
  const expired = sessionRecord({
    id: "01900000-0000-7000-8000-000000000103",
    familyId: OTHER_FAMILY_ID,
    expiresAt: new Date("2020-01-01T00:00:00.000Z")
  });
  const mutableExpired = mutableSession(
    expired.id,
    USER_ID,
    OTHER_FAMILY_ID,
    expired.expiresAt
  );
  const events: RecordedOutboxEvent[] = [];
  let committed = false;
  const transaction = fakeSessionStore([mutableExpired]).transaction;
  const transactionSession = transaction.session as unknown as {
    findFirst: () => Promise<Session & { user: User }>;
  };
  transactionSession.findFirst = async () => ({
    ...expired,
    user: userRecord()
  });
  const prisma = {
    session: {
      findUnique: async () => ({
        id: expired.id,
        userId: expired.userId
      })
    },
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>
    ) => {
      const result = await callback(transaction);
      committed = true;
      return result;
    }
  } as unknown as PrismaService;
  const service = sessionService({ prisma, transaction, events });

  await assert.rejects(
    service.rotate("expired-refresh", undefined, undefined, REQUEST),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "UNAUTHENTICATED" &&
      committed
  );
  assert.ok(mutableExpired.revokedAt);
  assert.equal(events.length, 1);
});

test("inactive account refresh lazily commits terminal family revoke", async () => {
  const current = sessionRecord({
    id: "01900000-0000-7000-8000-000000000105",
    familyId: OTHER_FAMILY_ID
  });
  const mutableCurrent = mutableSession(
    current.id,
    USER_ID,
    OTHER_FAMILY_ID
  );
  const events: RecordedOutboxEvent[] = [];
  let committed = false;
  const transaction = fakeSessionStore([mutableCurrent]).transaction;
  const transactionSession = transaction.session as unknown as {
    findFirst: () => Promise<Session & { user: User }>;
  };
  transactionSession.findFirst = async () => ({
    ...current,
    user: { ...userRecord(), status: "SUSPENDED" }
  });
  const prisma = {
    session: {
      findUnique: async () => ({
        id: current.id,
        userId: current.userId
      })
    },
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>
    ) => {
      const result = await callback(transaction);
      committed = true;
      return result;
    }
  } as unknown as PrismaService;
  const service = sessionService({ prisma, transaction, events });

  await assert.rejects(
    service.rotate("inactive-user-refresh", undefined, undefined, REQUEST),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "UNAUTHENTICATED" &&
      committed
  );
  assert.ok(mutableCurrent.revokedAt);
  assert.equal(events.length, 1);
});

test("successful refresh rotation stays in-family without a terminal event", async () => {
  const familyExpiresAt = new Date(Date.now() + 5 * 60 * 1_000);
  const current = sessionRecord({
    id: "01900000-0000-7000-8000-000000000106",
    familyId: CURRENT_FAMILY_ID,
    expiresAt: familyExpiresAt
  });
  const replacement = sessionRecord({
    id: "01900000-0000-7000-8000-000000000107",
    familyId: CURRENT_FAMILY_ID
  });
  const mutableCurrent = mutableSession(
    current.id,
    USER_ID,
    CURRENT_FAMILY_ID
  );
  const events: RecordedOutboxEvent[] = [];
  const transaction = fakeSessionStore([mutableCurrent]).transaction;
  const transactionSession = transaction.session as unknown as {
    findFirst: () => Promise<Session & { user: User }>;
    create: (args: Prisma.SessionCreateArgs) => Promise<Session>;
  };
  let replacementCreateData: Prisma.SessionCreateArgs["data"] | undefined;
  transactionSession.findFirst = async () => ({
    ...current,
    user: userRecord()
  });
  transactionSession.create = async (args) => {
    replacementCreateData = args.data;
    return {
      ...replacement,
      authenticatedAt: args.data.authenticatedAt as Date,
      accessExpiresAt: args.data.accessExpiresAt as Date,
      expiresAt: args.data.expiresAt as Date
    };
  };
  const prisma = {
    session: {
      findUnique: async () => ({
        id: current.id,
        userId: current.userId
      })
    },
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>
    ) => callback(transaction)
  } as unknown as PrismaService;
  const service = sessionService({ prisma, transaction, events });

  const result = await service.rotate("refresh", "csrf", "csrf", REQUEST);

  assert.ok(result.response.session);
  assert.equal(result.response.session.id, replacement.id);
  assert.equal(
    result.response.session.authenticatedAt,
    current.authenticatedAt.toISOString()
  );
  assert.equal(
    result.response.session.expiresAt,
    current.expiresAt.toISOString()
  );
  assert.equal(
    result.response.session.accessExpiresAt,
    familyExpiresAt.toISOString()
  );
  assert.ok(replacementCreateData);
  assert.equal(
    replacementCreateData.authenticatedAt,
    current.authenticatedAt
  );
  assert.equal(replacementCreateData.expiresAt, current.expiresAt);
  assert.equal(
    (replacementCreateData.accessExpiresAt as Date).getTime(),
    familyExpiresAt.getTime()
  );
  assert.ok(mutableCurrent.revokedAt);
  assert.equal(events.length, 0);
});

test("lists every active session through a stable encrypted family keyset", async () => {
  const first = sessionRecord({
    id: "01900000-0000-7000-8000-000000000201",
    familyId: "01900000-0000-7000-8000-000000000030"
  });
  const second = sessionRecord({
    id: "01900000-0000-7000-8000-000000000202",
    familyId: OTHER_FAMILY_ID
  });
  const third = sessionRecord({
    id: "01900000-0000-7000-8000-000000000203",
    familyId: CURRENT_FAMILY_ID
  });
  const calls: Prisma.SessionFindManyArgs[] = [];
  let callIndex = 0;
  const prisma = {
    session: {
      findMany: async (args: Prisma.SessionFindManyArgs) => {
        calls.push(args);
        callIndex += 1;
        return callIndex === 1 ? [first, second, third] : [third];
      }
    }
  } as unknown as PrismaService;
  const service = sessionService({
    prisma,
    transaction: fakeSessionStore([]).transaction,
    events: []
  });
  const principal = {
    ...principalFor(first.familyId),
    sessionId: first.id
  };

  const firstPage = await service.list(principal, { limit: 2 });
  assert.deepEqual(
    firstPage.data.map(({ id }) => id),
    [first.id, second.id]
  );
  assert.equal(firstPage.data[0]?.current, true);
  assert.equal(firstPage.page.hasNext, true);
  assert.ok(firstPage.page.nextCursor);

  const secondPage = await service.list(principal, {
    limit: 2,
    cursor: firstPage.page.nextCursor
  });
  assert.deepEqual(
    secondPage.data.map(({ id }) => id),
    [third.id]
  );
  assert.deepEqual(secondPage.page, { hasNext: false });
  assert.equal(calls[0]?.take, 3);
  assert.deepEqual(calls[0]?.orderBy, [
    { familyId: "desc" },
    { id: "desc" }
  ]);
  assert.deepEqual(calls[1]?.where?.OR, [
    { familyId: { lt: second.familyId } },
    { familyId: second.familyId, id: { lt: second.id } }
  ]);
  await assert.rejects(
    service.list(
      { ...principal, userId: OTHER_USER_ID },
      { limit: 2, cursor: firstPage.page.nextCursor }
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "INVALID_CURSOR"
  );
  assert.equal(calls.length, 2);
});

test("rejects a malformed session cursor before querying PostgreSQL", async () => {
  let queried = false;
  const prisma = {
    session: {
      findMany: async () => {
        queried = true;
        return [];
      }
    }
  } as unknown as PrismaService;
  const service = sessionService({
    prisma,
    transaction: fakeSessionStore([]).transaction,
    events: []
  });

  await assert.rejects(
    service.list(principalFor(CURRENT_FAMILY_ID), {
      limit: 100,
      cursor: "aaaaaaaa"
    }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED" &&
      error.fieldErrors?.[0]?.code === "INVALID_CURSOR"
  );
  assert.equal(queried, false);
});

test("outbox failures are propagated so the surrounding transaction can roll back", async () => {
  const store = fakeSessionStore([
    mutableSession("session-outbox", USER_ID, CURRENT_FAMILY_ID)
  ]);
  let committed = false;
  const prisma = {
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>
    ) => {
      const result = await callback(store.transaction);
      committed = true;
      return result;
    }
  } as unknown as PrismaService;
  const service = sessionService({
    prisma,
    transaction: store.transaction,
    events: [],
    outboxError: new Error("outbox unavailable")
  });

  await assert.rejects(
    prisma.$transaction((transaction) =>
      service.revokeFamilies(transaction, {
        userId: USER_ID,
        familyIds: [CURRENT_FAMILY_ID],
        requestId: REQUEST.requestId
      })
    ),
    { message: "outbox unavailable" }
  );
  assert.equal(committed, false);
});

function sessionService(input: {
  readonly transaction: Prisma.TransactionClient;
  readonly events: RecordedOutboxEvent[];
  readonly prisma?: PrismaService;
  readonly outboxError?: Error;
}): SessionService {
  const prisma =
    input.prisma ??
    ({
      $transaction: async <T>(
        callback: (client: Prisma.TransactionClient) => Promise<T>
      ) => callback(input.transaction)
    } as unknown as PrismaService);
  const crypto = {
    randomFamilyId: () => CURRENT_FAMILY_ID,
    randomToken: () => "opaque-token",
    hashOpaqueToken: (value: string) => `hash:${value}`,
    tokensEqual: (left: string, right: string) => left === right,
    sealSessionListCursor: (payload: string) =>
      Buffer.from(payload, "utf8").toString("base64url"),
    openSessionListCursor: (cursor: string) =>
      Buffer.from(cursor, "base64url").toString("utf8")
  } as unknown as AuthCryptoService;
  const audit = {
    record: async () => undefined
  } as unknown as AuditService;
  const outbox = {
    event: async (
      _transaction: Prisma.TransactionClient,
      event: RecordedOutboxEvent
    ) => {
      if (input.outboxError) throw input.outboxError;
      input.events.push(event);
    }
  } as unknown as OutboxService;
  return new SessionService(
    prisma,
    crypto,
    audit,
    outbox,
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test"
    })
  );
}

function fakeSessionStore(
  sessions: MutableSession[],
  calls: string[] = []
): FakeSessionStore {
  const transaction = {
    $queryRaw: async () => {
      calls.push("lock");
      return [];
    },
    user: {
      findFirst: async () => ({ id: USER_ID })
    },
    session: {
      findMany: async (args: {
        where: {
          userId: string;
          revokedAt: null;
          familyId?: {
            in?: readonly string[];
            notIn?: readonly string[];
          };
        };
      }) =>
        sessions
          .filter(
            (session) =>
              session.userId === args.where.userId &&
              session.revokedAt === null &&
              (args.where.familyId?.in === undefined ||
                args.where.familyId.in.includes(session.familyId)) &&
              (args.where.familyId?.notIn === undefined ||
                !args.where.familyId.notIn.includes(session.familyId))
          )
          .map(({ familyId }) => ({ familyId })),
      findFirst: async (args: {
        where: {
          id: string;
          userId: string;
          familyId?: string;
          revokedAt?: null;
          expiresAt?: { gt: Date };
        };
      }) => {
        const session = sessions.find(
          (candidate) =>
            candidate.id === args.where.id &&
            candidate.userId === args.where.userId &&
            (args.where.familyId === undefined ||
              candidate.familyId === args.where.familyId) &&
            (args.where.revokedAt === undefined ||
              candidate.revokedAt === args.where.revokedAt) &&
            (args.where.expiresAt === undefined ||
              (candidate.expiresAt ?? new Date(0)) >
                args.where.expiresAt.gt)
        );
        return session ? { familyId: session.familyId } : null;
      },
      updateMany: async (args: {
        where: {
          id?: string;
          userId: string;
          familyId?: string;
          revokedAt: null;
        };
        data: { revokedAt: Date };
      }) => {
        const matching = sessions.filter(
          (session) =>
            (args.where.id === undefined ||
              session.id === args.where.id) &&
            session.userId === args.where.userId &&
            (args.where.familyId === undefined ||
              session.familyId === args.where.familyId) &&
            session.revokedAt === null
        );
        for (const session of matching) {
          session.revokedAt = args.data.revokedAt;
        }
        return { count: matching.length };
      }
    }
  } as unknown as Prisma.TransactionClient;
  return { transaction, sessions, calls };
}

function mutableSession(
  id: string,
  userId: string,
  familyId: string,
  expiresAt = new Date("2099-01-01T00:00:00.000Z")
): MutableSession {
  return {
    id,
    userId,
    familyId,
    revokedAt: null,
    replacedBySessionId: null,
    expiresAt
  };
}

function sessionRecord(
  overrides: Partial<Session> & Pick<Session, "id" | "familyId">
): Session {
  const { id, familyId, ...remainingOverrides } = overrides;
  return {
    id,
    userId: USER_ID,
    accessTokenHash: "access-hash",
    refreshTokenHash: "refresh-hash",
    csrfTokenHash: "hash:csrf",
    familyId,
    replacedBySessionId: null,
    userAgent: null,
    ipAddress: null,
    authenticatedAt: new Date("2026-07-29T10:00:00.000Z"),
    accessExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    lastUsedAt: new Date("2026-07-29T10:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-07-29T10:00:00.000Z"),
    ...remainingOverrides
  };
}

function userRecord(): User {
  return {
    id: USER_ID,
    emailNormalized: "user@example.com",
    emailDisplay: "user@example.com",
    emailVerifiedAt: new Date("2026-07-01T00:00:00.000Z"),
    passwordHash: "password-hash",
    displayName: "User",
    locale: "en",
    timezone: "UTC",
    country: null,
    avatarMimeType: null,
    avatarData: null,
    avatarUpdatedAt: null,
    status: "ACTIVE",
    version: 1,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    deletedAt: null
  };
}

function principalFor(sessionFamilyId: string): AuthenticatedPrincipal {
  return {
    userId: USER_ID,
    sessionId: "current",
    sessionFamilyId,
    authenticatedAt: new Date("2026-07-29T10:00:00.000Z"),
    expiresAt: new Date("2099-01-01T00:00:00.000Z")
  };
}
