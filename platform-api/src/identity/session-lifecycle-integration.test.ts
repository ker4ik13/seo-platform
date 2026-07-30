import assert from "node:assert/strict";
import test from "node:test";
import type {
  MfaMethod,
  Prisma,
  Session,
  User
} from "../generated/prisma/client.js";
import type { AuditService } from "../audit/audit.service.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import type { AuthCryptoService } from "./auth-crypto.service.js";
import type { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { IdentityService } from "./identity.service.js";
import { MfaService } from "./mfa.service.js";
import type { RecentAuthenticationService } from "./recent-authentication.service.js";
import { SessionService } from "./session.service.js";
import { encodeBase32, totpCode } from "./totp.js";

const USER_ID = "01900000-0000-7000-8000-000000000001";
const CURRENT_FAMILY_ID = "01900000-0000-7000-8000-000000000010";
const REQUEST = { requestId: "request-session-integration" };
const sessionDatabaseUrl =
  process.env.PLATFORM_API_SESSION_TEST_DATABASE_URL;

test(
  "Prisma PostgreSQL adapter acquires the session advisory lock",
  { skip: sessionDatabaseUrl === undefined, timeout: 10_000 },
  async () => {
    assert.ok(sessionDatabaseUrl);
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: sessionDatabaseUrl
    });
    const prisma = new PrismaService(config);
    const service = new SessionService(
      prisma,
      {} as AuthCryptoService,
      {} as AuditService,
      {} as OutboxService,
      config
    );

    try {
      await prisma.$transaction((transaction) =>
        service.lockUserSessionLifecycle(transaction, USER_ID)
      );
    } finally {
      await prisma.$disconnect();
    }
  }
);

test("password reset locks lifecycle, invalidates MFA challenges, revokes old families and only then issues a new family", async () => {
  const calls: string[] = [];
  const previousUser = userRecord(1);
  const updatedUser = userRecord(2);
  const createdSession = sessionRecord();
  const transaction = {
    oneTimeToken: {
      updateMany: async () => {
        calls.push(
          calls.includes("consume-reset-token")
            ? "invalidate-reset-tokens"
            : "consume-reset-token"
        );
        return { count: 1 };
      }
    },
    user: {
      update: async () => {
        calls.push("update-password");
        return updatedUser;
      }
    },
    mfaChallenge: {
      updateMany: async () => {
        calls.push("invalidate-mfa-challenges");
        return { count: 2 };
      }
    }
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    oneTimeToken: {
      findUnique: async () => ({
        id: "01900000-0000-7000-8000-000000000100",
        userId: USER_ID,
        purpose: "PASSWORD_RESET",
        tokenHash: "token-hash",
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
        consumedAt: null,
        createdAt: new Date("2026-07-29T00:00:00.000Z"),
        user: previousUser
      })
    },
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>
    ) => callback(transaction)
  } as unknown as PrismaService;
  const crypto = {
    hashOpaqueToken: () => "token-hash",
    hashPassword: async () => "new-password-hash"
  } as unknown as AuthCryptoService;
  const sessions = {
    lockUserSessionLifecycle: async () => {
      calls.push("lock");
    },
    revokeFamilies: async (
      _transaction: Prisma.TransactionClient,
      input: { userId: string; requestId: string }
    ) => {
      calls.push("revoke-families");
      assert.deepEqual(input, {
        userId: USER_ID,
        requestId: REQUEST.requestId
      });
      return {
        revokedSessionCount: 3,
        revokedFamilyIds: [
          "01900000-0000-7000-8000-000000000020",
          "01900000-0000-7000-8000-000000000030"
        ]
      };
    },
    issue: async (
      _transaction: Prisma.TransactionClient,
      user: Pick<User, "id" | "version">,
      _context: typeof REQUEST,
      familyId?: string
    ) => {
      calls.push("issue-new-family");
      assert.deepEqual(user, updatedUser);
      assert.equal(familyId, undefined);
      return {
        session: createdSession,
        credentials: {
          accessToken: "access",
          refreshToken: "refresh",
          csrfToken: "csrf"
        }
      };
    }
  } as unknown as SessionService;
  const identity = new IdentityService(
    prisma,
    crypto,
    {
      consume: async () => undefined
    } as unknown as AuthRateLimitService,
    {} as MfaService,
    sessions,
    {
      record: async () => {
        calls.push("audit-password-change");
      }
    } as unknown as AuditService,
    {
      userEvent: async () => {
        calls.push("password-changed-event");
      }
    } as unknown as OutboxService,
    testConfig()
  );

  const result = await identity.resetPassword(
    {
      token: "opaque-reset-token",
      password: "new correct horse battery staple"
    },
    REQUEST
  );

  assert.equal(result.response.user.id, USER_ID);
  assert.deepEqual(calls, [
    "lock",
    "consume-reset-token",
    "update-password",
    "invalidate-reset-tokens",
    "invalidate-mfa-challenges",
    "revoke-families",
    "audit-password-change",
    "password-changed-event",
    "issue-new-family"
  ]);
});

test("MFA disable validates the locked user version and excludes the entire current family", async () => {
  const calls: string[] = [];
  const user = userRecord(1);
  const updatedUser = userRecord(2);
  const principal = {
    userId: USER_ID,
    sessionId: "01900000-0000-7000-8000-000000000011",
    sessionFamilyId: CURRENT_FAMILY_ID,
    authenticatedAt: new Date(),
    expiresAt: new Date("2099-01-01T00:00:00.000Z")
  };
  const transaction = {
    recoveryCode: {
      updateMany: async () => {
        calls.push("consume-second-factor");
        return { count: 1 };
      },
      deleteMany: async () => {
        calls.push("delete-recovery-codes");
        return { count: 1 };
      }
    },
    mfaMethod: {
      updateMany: async () => {
        calls.push("disable-totp");
        return { count: 1 };
      }
    },
    user: {
      update: async () => {
        calls.push("increment-user-version");
        return updatedUser;
      }
    }
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    user: {
      findUnique: async () => user
    },
    recoveryCode: {
      findUnique: async () => ({
        id: "01900000-0000-7000-8000-000000000200",
        userId: USER_ID,
        codeHash: "recovery-code-hash",
        usedAt: null,
        createdAt: new Date()
      })
    },
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>
    ) => callback(transaction)
  } as unknown as PrismaService;
  const sessions = {
    assertSessionLifecyclePrincipal: async (
      _transaction: Prisma.TransactionClient,
      expectedPrincipal: typeof principal,
      expectedUser: Pick<User, "id" | "version">
    ) => {
      calls.push("lock-and-recheck-user");
      assert.equal(expectedUser.version, 1);
      assert.equal(expectedPrincipal.sessionFamilyId, CURRENT_FAMILY_ID);
    },
    revokeFamilies: async (
      _transaction: Prisma.TransactionClient,
      input: {
        userId: string;
        excludeFamilyIds: readonly string[];
        requestId: string;
      }
    ) => {
      calls.push("revoke-other-families");
      assert.deepEqual(input, {
        userId: USER_ID,
        excludeFamilyIds: [CURRENT_FAMILY_ID],
        requestId: REQUEST.requestId
      });
      return {
        revokedSessionCount: 2,
        revokedFamilyIds: [
          "01900000-0000-7000-8000-000000000020"
        ]
      };
    }
  } as unknown as SessionService;
  const mfa = new MfaService(
    prisma,
    {
      verifyPassword: async () => true,
      hashOpaqueToken: () => "recovery-code-hash"
    } as unknown as AuthCryptoService,
    {} as AuthRateLimitService,
    sessions,
    {
      record: async () => {
        calls.push("audit-mfa-disabled");
      }
    } as unknown as AuditService,
    {
      userEvent: async () => {
        calls.push("mfa-disabled-event");
      }
    } as unknown as OutboxService,
    {
      assert: () => undefined
    } as unknown as RecentAuthenticationService,
    testConfig()
  );

  assert.deepEqual(
    await mfa.disableTotp(
      principal,
      {
        password: "current correct horse battery staple",
        code: "ABCD-EFGH-IJKL-MNPQ"
      },
      REQUEST
    ),
    { disabled: true }
  );
  assert.deepEqual(calls, [
    "lock-and-recheck-user",
    "consume-second-factor",
    "disable-totp",
    "delete-recovery-codes",
    "revoke-other-families",
    "increment-user-version",
    "audit-mfa-disabled",
    "mfa-disabled-event"
  ]);
});

test("MFA activation revalidates the principal and user version under the lifecycle lock before becoming ACTIVE", async () => {
  const calls: string[] = [];
  const user = userRecord(1);
  const updatedUser = userRecord(2);
  const principal = {
    userId: USER_ID,
    sessionId: "01900000-0000-7000-8000-000000000011",
    sessionFamilyId: CURRENT_FAMILY_ID,
    authenticatedAt: new Date(),
    expiresAt: new Date("2099-01-01T00:00:00.000Z")
  };
  const secret = encodeBase32(
    Buffer.from("12345678901234567890", "ascii")
  );
  const method: MfaMethod = {
    id: "01900000-0000-7000-8000-000000000400",
    userId: USER_ID,
    type: "TOTP",
    status: "PENDING",
    secretEncrypted: "encrypted-secret",
    lastUsedCounter: null,
    confirmedAt: null,
    lastUsedAt: null,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const transaction = {
    mfaMethod: {
      updateMany: async (args: {
        where: { status: "ACTIVE" | "PENDING" };
      }) => {
        calls.push(
          args.where.status === "ACTIVE"
            ? "disable-previous-active"
            : "activate-totp"
        );
        return { count: args.where.status === "PENDING" ? 1 : 0 };
      }
    },
    recoveryCode: {
      deleteMany: async () => {
        calls.push("replace-recovery-codes");
        return { count: 0 };
      },
      createMany: async () => {
        calls.push("create-recovery-codes");
        return { count: 10 };
      }
    },
    user: {
      update: async () => {
        calls.push("increment-user-version");
        return updatedUser;
      }
    }
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    user: {
      findUnique: async () => user
    },
    mfaMethod: {
      findFirst: async () => method
    },
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>
    ) => callback(transaction)
  } as unknown as PrismaService;
  const sessions = {
    assertSessionLifecyclePrincipal: async (
      _transaction: Prisma.TransactionClient,
      expectedPrincipal: typeof principal,
      expectedUser: Pick<User, "id" | "version">
    ) => {
      calls.push("lock-and-recheck-principal");
      assert.equal(expectedPrincipal.sessionId, principal.sessionId);
      assert.equal(expectedUser.version, 1);
    }
  } as unknown as SessionService;
  const mfa = new MfaService(
    prisma,
    {
      decryptMfaSecret: () => secret,
      hashOpaqueToken: (value: string) => `hash:${value}`
    } as unknown as AuthCryptoService,
    {} as AuthRateLimitService,
    sessions,
    {
      record: async () => {
        calls.push("audit-mfa-enabled");
      }
    } as unknown as AuditService,
    {
      userEvent: async () => {
        calls.push("mfa-enabled-event");
      }
    } as unknown as OutboxService,
    {
      assert: () => undefined
    } as unknown as RecentAuthenticationService,
    testConfig()
  );

  const result = await mfa.confirmTotp(
    principal,
    {
      methodId: method.id,
      code: totpCode(secret, Date.now())
    },
    REQUEST
  );

  assert.equal(result.enabled, true);
  assert.equal(result.recoveryCodes.length, 10);
  assert.deepEqual(calls, [
    "lock-and-recheck-principal",
    "disable-previous-active",
    "activate-totp",
    "replace-recovery-codes",
    "create-recovery-codes",
    "increment-user-version",
    "audit-mfa-enabled",
    "mfa-enabled-event"
  ]);
});

function userRecord(version: number): User {
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
    status: "ACTIVE",
    version,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    deletedAt: null
  };
}

function sessionRecord(): Session {
  return {
    id: "01900000-0000-7000-8000-000000000300",
    userId: USER_ID,
    accessTokenHash: "access-hash",
    refreshTokenHash: "refresh-hash",
    csrfTokenHash: "csrf-hash",
    familyId: "01900000-0000-7000-8000-000000000301",
    replacedBySessionId: null,
    userAgent: null,
    ipAddress: null,
    authenticatedAt: new Date("2026-07-29T10:00:00.000Z"),
    accessExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    lastUsedAt: new Date("2026-07-29T10:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-07-29T10:00:00.000Z")
  };
}

function testConfig() {
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test"
  });
}
