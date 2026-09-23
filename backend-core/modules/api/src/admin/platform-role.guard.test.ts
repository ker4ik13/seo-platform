import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { DomainError } from "../common/domain-error.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import type { RecentAuthenticationService } from "../identity/recent-authentication.service.js";
import { PlatformRoleGuard } from "./platform-role.guard.js";

const principal: AuthenticatedPrincipal = {
  userId: "01900000-0000-7000-8000-000000000001",
  sessionId: "01900000-0000-7000-8000-000000000002",
  sessionFamilyId: "01900000-0000-7000-8000-000000000003",
  authenticatedAt: new Date("2026-07-30T12:00:00.000Z"),
  expiresAt: new Date("2026-07-30T13:00:00.000Z")
};

test("requires active MFA confirmed before the current admin session", async () => {
  const request: {
    principal: AuthenticatedPrincipal;
    platformRoles?: readonly string[];
  } = { principal };
  const guard = makeGuard({
    status: "ACTIVE",
    emailVerifiedAt: new Date(),
    mfaMethods: [{ confirmedAt: new Date("2026-07-30T11:00:00.000Z") }],
    platformRoles: [{ roleCode: "FINANCE" }]
  });
  assert.equal(await guard.canActivate(context(request)), true);
  assert.deepEqual(request.platformRoles, ["FINANCE"]);

  const withoutMfa = makeGuard({
    status: "ACTIVE",
    emailVerifiedAt: new Date(),
    mfaMethods: [],
    platformRoles: [{ roleCode: "FINANCE" }]
  });
  await assert.rejects(
    () => withoutMfa.canActivate(context({ principal })),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "FORBIDDEN"
  );
});

test("keeps cookie-backed admin reads alive while retaining recent auth for mutations", async () => {
  let recentChecks = 0;
  const guard = makeGuard(user("FINANCE"), () => {
    recentChecks += 1;
  });
  assert.equal(
    await guard.canActivate(context({ principal }, "GET")),
    true
  );
  assert.equal(recentChecks, 0);
  assert.equal(
    await guard.canActivate(context({ principal }, "POST")),
    true
  );
  assert.equal(recentChecks, 1);
});

test("super admin satisfies role requirements while unrelated staff does not", async () => {
  const superAdmin = makeGuard(user("SUPER_ADMIN"));
  assert.equal(
    await superAdmin.canActivate(context({ principal })),
    true
  );

  const support = makeGuard(user("SUPPORT"));
  await assert.rejects(
    () => support.canActivate(context({ principal })),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "FORBIDDEN"
  );
});

function makeGuard(
  userResult: unknown,
  assertRecent: () => void = () => undefined
): PlatformRoleGuard {
  return new PlatformRoleGuard(
    {
      getAllAndOverride: () => ["FINANCE"]
    } as unknown as Reflector,
    {
      user: {
        findUnique: async () => userResult
      }
    } as unknown as PrismaService,
    {
      assert: assertRecent
    } as unknown as RecentAuthenticationService
  );
}

function user(roleCode: string): unknown {
  return {
    status: "ACTIVE",
    emailVerifiedAt: new Date(),
    mfaMethods: [{ confirmedAt: new Date("2026-07-30T11:00:00.000Z") }],
    platformRoles: [{ roleCode }]
  };
}

function context(request: object, method = "GET"): ExecutionContext {
  const routedRequest = Object.assign(request, { method });
  return {
    switchToHttp: () => ({
      getRequest: () => routedRequest
    }),
    getHandler: () => class Handler {},
    getClass: () => class Controller {}
  } as unknown as ExecutionContext;
}
