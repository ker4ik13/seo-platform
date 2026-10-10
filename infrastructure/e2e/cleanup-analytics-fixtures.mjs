import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { loadAppConfig } from "../../backend-core/modules/api/dist/config/app-config.js";
import { PrismaService } from "../../backend-core/modules/api/dist/database/prisma.service.js";

assert.equal(process.env.SEO_PLATFORM_E2E_CONFIRM, "CREATE_TEST_DATA");
const path = process.env.SEO_PLATFORM_SESSION_FIXTURES;
assert.ok(
  path?.startsWith("/home/dev/.local/share/seo-platform-runtime/tmp/e2e."),
);
const fixtures = JSON.parse(await readFile(path, "utf8"));
assert.ok(
  Array.isArray(fixtures) &&
    fixtures.length === 4 &&
    fixtures.every((row) =>
      /^e2e-analytics-[0-9a-f-]+@example\.invalid$/u.test(row.email),
    ),
);
const env = parseEnv(
  await readFile(
    "/home/dev/.local/share/seo-platform-runtime/runtime.env",
    "utf8",
  ),
);
assert.ok(
  ["144.31.221.28", "localhost", "127.0.0.1"].includes(
    new URL(env.SEO_PLATFORM_PUBLIC_URL).hostname,
  ),
);
const config = loadAppConfig({
    ...env,
    NODE_ENV: "test",
    WEB_PUBLIC_URL: env.SEO_PLATFORM_PUBLIC_URL,
    DATABASE_URL: `postgresql://platform_owner:${encodeURIComponent(env.PLATFORM_DATABASE_OWNER_PASSWORD)}@127.0.0.1:5432/platform_db`,
  }),
  prisma = new PrismaService(config);
try {
  for (const fixture of fixtures) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.userId },
    });
    assert.equal(user.emailNormalized, fixture.email);
  }
  const ids = fixtures.map((row) => row.userId),
    now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { userId: { in: ids }, revokedAt: null },
      data: { revokedAt: now },
    });
    const actorId = fixtures.find((row) => row.role === "SUPER_ADMIN").userId;
    const roles = await tx.platformStaffRoleAssignment.findMany({
      where: { userId: { in: ids }, revokedAt: null },
    });
    for (const role of roles) {
      await tx.platformStaffRoleAssignment.update({
        where: { id: role.id },
        data: {
          revokedAt: now,
          revokedBy: actorId,
          revokeReason: "Local analytics E2E completed",
          version: { increment: 1 },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId,
          action: "platform_admin.staff_role.revoked",
          resourceType: "platform_staff_role_assignment",
          resourceId: role.id,
          outcome: "SUCCESS",
          reason: "Local analytics E2E completed",
          requestId: `analytics-cleanup-${role.id}`,
        },
      });
    }
    await tx.mfaMethod.updateMany({
      where: { userId: { in: ids }, disabledAt: null },
      data: { status: "DISABLED", disabledAt: now },
    });
  });
  console.log("analytics-fixtures privileged sessions and roles revoked");
} finally {
  await prisma.$disconnect();
}
