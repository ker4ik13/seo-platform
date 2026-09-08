// Local browser/load fixtures only. Does not relax authentication rate limits
// or grant staff access. Real registration is exercised by runtime.test.mjs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const fixtureCount = Number(process.env.SEO_PLATFORM_SESSION_FIXTURE_COUNT ?? 16);
assert.ok(Number.isInteger(fixtureCount) && fixtureCount >= 1 && fixtureCount <= 16);
assert.ok(output?.startsWith("/home/dev/.local/share/seo-platform-runtime/tmp/e2e."));
const env = parseEnv(await readFile("/home/dev/.local/share/seo-platform-runtime/runtime.env", "utf8"));
const previous = process.env.SEO_PLATFORM_REISSUE_SESSION_FIXTURES ? JSON.parse(await readFile(process.env.SEO_PLATFORM_REISSUE_SESSION_FIXTURES, "utf8")) : undefined;
if (previous) assert.ok(previous.length >= fixtureCount && previous.every(fixture => /^e2e-load-[0-9a-f-]+@example\.invalid$/u.test(fixture.email)));
const base = new URL(env.SEO_PLATFORM_PUBLIC_URL);
assert.equal(base.protocol, "https:");
const config = loadAppConfig({ ...env, NODE_ENV: "test", AUTH_ACCESS_TOKEN_TTL_MINUTES: "60", WEB_PUBLIC_URL: base.origin, DATABASE_URL: `postgresql://platform_owner:${encodeURIComponent(env.PLATFORM_DATABASE_OWNER_PASSWORD)}@127.0.0.1:5432/platform_db` });
const prisma = new PrismaService(config), audit = new AuditService(prisma);
const sessions = new SessionService(prisma, new AuthCryptoService(config), audit, new OutboxService(), config);
const fixtures = [], expiresAt = new Date(Date.now() + 3_600_000);
// Reserve the output path before creating any account. Never overwrite sessions.
await writeFile(output, "[]\n", { mode: 0o600, flag: "wx" });
try {
  for (let i = 0; i < fixtureCount; i++) {
    const fixture = await prisma.$transaction(async tx => {
      const email = previous?.[i]?.email ?? `e2e-load-${randomUUID()}@example.invalid`;
      const user = previous ? await tx.user.findUniqueOrThrow({ where: { id: previous[i].userId, emailNormalized: email } }) : await tx.user.create({ data: { emailNormalized: email, emailDisplay: email, emailVerifiedAt: new Date(), displayName: `MVP test fixture ${i}`, status: "ACTIVE", locale: "en" } });
      assert.equal(await tx.platformStaffRoleAssignment.count({ where: { userId: user.id, revokedAt: null } }), 0, "Session fixtures must never hold staff privileges");
      const context = { requestId: `fixture-${randomUUID()}`, userAgent: "MVP local browser fixture" };
      const issue = await sessions.issue(tx, user, context, undefined, { expiresAt, authenticatedAt: new Date() });
      await audit.record({ actorId: user.id, action: "test.session_fixture.created", resourceType: "session", resourceId: issue.session.id, requestId: context.requestId }, tx);
      return { email, userId: user.id, sessionId: issue.session.id, storageState: { origins: [], cookies: [
        { name: config.auth.accessCookieName, value: issue.credentials.accessToken, httpOnly: true },
        { name: config.auth.sessionCookieName, value: issue.credentials.refreshToken, httpOnly: true },
        { name: config.auth.csrfCookieName, value: issue.credentials.csrfToken, httpOnly: false }
      ].map(cookie => ({ ...cookie, domain: base.hostname, path: "/", secure: true, sameSite: "Lax", expires: Math.floor(expiresAt.getTime() / 1000) })) } };
    });
    fixtures.push(fixture);
    await writeFile(output, `${JSON.stringify(fixtures)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`session-fixtures accounts=${fixtures.length} staffRoles=0 output=${output}\n`);
} finally { await prisma.$disconnect(); }
