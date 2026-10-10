import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { loadAppConfig } from "../../backend-core/modules/api/dist/config/app-config.js";
import { PrismaService } from "../../backend-core/modules/api/dist/database/prisma.service.js";
import { AuthCryptoService } from "../../backend-core/modules/api/dist/identity/auth-crypto.service.js";
import { SessionService } from "../../backend-core/modules/api/dist/identity/session.service.js";
import { AuditService } from "../../backend-core/modules/api/dist/audit/audit.service.js";
import { OutboxService } from "../../backend-core/modules/api/dist/outbox/outbox.service.js";

assert.equal(process.env.SEO_PLATFORM_E2E_CONFIRM, "CREATE_TEST_DATA");
const output = process.env.SEO_PLATFORM_SESSION_FIXTURES;
assert.ok(
  output?.startsWith("/home/dev/.local/share/seo-platform-runtime/tmp/e2e."),
);
const env = parseEnv(
    await readFile(
      "/home/dev/.local/share/seo-platform-runtime/runtime.env",
      "utf8",
    ),
  ),
  base = new URL(env.SEO_PLATFORM_PUBLIC_URL);
assert.ok(
  ["144.31.221.28", "localhost", "127.0.0.1"].includes(base.hostname),
  "Local test stand only",
);
const config = loadAppConfig({
  ...env,
  NODE_ENV: "test",
  WEB_PUBLIC_URL: base.origin,
  DATABASE_URL: `postgresql://platform_owner:${encodeURIComponent(env.PLATFORM_DATABASE_OWNER_PASSWORD)}@127.0.0.1:5432/platform_db`,
  AUTH_ACCESS_TOKEN_TTL_MINUTES: "60",
});
const prisma = new PrismaService(config),
  crypto = new AuthCryptoService(config),
  audit = new AuditService(prisma),
  sessions = new SessionService(
    prisma,
    crypto,
    audit,
    new OutboxService(),
    config,
  );
const fixtures = [];
await writeFile(output, "[]", { mode: 0o600, flag: "wx" });
try {
  for (const role of ["USER", "ANALYST", "SUPER_ADMIN", "USER"]) {
    const fixture = await prisma.$transaction(async (tx) => {
      const email = `e2e-analytics-${randomUUID()}@example.invalid`,
        now = new Date();
      const user = await tx.user.create({
        data: {
          emailNormalized: email,
          emailDisplay: email,
          displayName: `Analytics fixture ${role}`,
          emailVerifiedAt: now,
          status: "ACTIVE",
          locale: "ru",
        },
      });
      if (role !== "USER") {
        const secret = [...randomBytes(32)]
          .map((value) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[value % 32])
          .join("");
        await tx.mfaMethod.create({
          data: {
            userId: user.id,
            type: "TOTP",
            status: "ACTIVE",
            confirmedAt: new Date(now.getTime() - 1000),
            secretEncrypted: crypto.encryptMfaSecret(secret),
          },
        });
        await tx.platformStaffRoleAssignment.create({
          data: {
            userId: user.id,
            roleCode: role,
            reason: "Local product analytics browser test",
          },
        });
      }
      const issue = await sessions.issue(
        tx,
        user,
        {
          requestId: `analytics-fixture-${randomUUID()}`,
          userAgent: "Local analytics E2E fixture",
        },
        undefined,
        {
          authenticatedAt: now,
          expiresAt: new Date(now.getTime() + 3_600_000),
        },
      );
      return {
        role,
        userId: user.id,
        email,
        storageState: {
          origins: [],
          cookies: [
            {
              name: config.auth.accessCookieName,
              value: issue.credentials.accessToken,
              httpOnly: true,
            },
            {
              name: config.auth.sessionCookieName,
              value: issue.credentials.refreshToken,
              httpOnly: true,
            },
            {
              name: config.auth.csrfCookieName,
              value: issue.credentials.csrfToken,
              httpOnly: false,
            },
          ].map((cookie) => ({
            ...cookie,
            domain: base.hostname,
            path: "/",
            secure: true,
            sameSite: "Lax",
            expires: Math.floor(Date.now() / 1000) + 3600,
          })),
        },
      };
    });
    fixtures.push(fixture);
  }
  await writeFile(output, JSON.stringify(fixtures), { mode: 0o600 });
  console.log(`analytics-fixtures accounts=4 staff=2 output=${output}`);
} finally {
  await prisma.$disconnect();
}
