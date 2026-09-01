import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { DomainError } from "../common/domain-error.js";
import type { ApiTokenAuthenticationService } from "./api-token-authentication.service.js";
import type { AuthenticatedRequest } from "./identity.types.js";
import type { SessionCookieService } from "./session-cookie.service.js";
import type { SessionService } from "./session.service.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "./session-auth.guard.js";

const principal = {
  userId: "01900000-0000-7000-8000-000000000001",
  sessionId: "01900000-0000-7000-8000-000000000002",
  sessionFamilyId: "01900000-0000-7000-8000-000000000002",
  authenticatedAt: new Date("2026-09-01T10:00:00.000Z"),
  expiresAt: new Date("2027-09-01T10:00:00.000Z")
};
const authorization = {
  tokenId: principal.sessionId,
  workspaceId: "01900000-0000-7000-8000-000000000003",
  name: "Agent",
  scopes: ["positions:read" as const],
  allProjects: true,
  projectIds: []
};

test("authenticates Bearer on tenant routes without reading cookies or CSRF", async () => {
  let sessionCalls = 0;
  let apiCalls = 0;
  const request = authenticatedRequest();
  const guard = new CsrfSessionGuard(
    {
      authenticate: async () => {
        sessionCalls += 1;
        throw new Error("cookie auth must not run");
      }
    } as unknown as SessionService,
    {} as SessionCookieService,
    reflector("ranking.view"),
    {
      authenticate: async () => {
        apiCalls += 1;
        return { principal, authorization };
      }
    } as unknown as ApiTokenAuthenticationService
  );

  assert.equal(await guard.canActivate(context(request)), true);
  assert.equal(apiCalls, 1);
  assert.equal(sessionCalls, 0);
  assert.equal(request.principal, principal);
  assert.equal(request.apiTokenAuthorization, authorization);
});

test("fails closed for Bearer on session-only routes", async () => {
  let apiCalls = 0;
  const guard = new SessionAuthGuard(
    {} as SessionService,
    {} as SessionCookieService,
    reflector(undefined),
    {
      authenticate: async () => {
        apiCalls += 1;
        return { principal, authorization };
      }
    } as unknown as ApiTokenAuthenticationService
  );

  await assert.rejects(
    guard.canActivate(context(authenticatedRequest())),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "FORBIDDEN" &&
      error.statusCode === 403
  );
  assert.equal(apiCalls, 0);
});

function authenticatedRequest(): AuthenticatedRequest {
  return {
    headers: { authorization: `Bearer seo_pat_${"a".repeat(43)}` },
    cookies: {}
  } as unknown as AuthenticatedRequest;
}

function reflector(permission: string | undefined) {
  return {
    getAllAndOverride: () => permission
  } as never;
}

function context(request: AuthenticatedRequest): ExecutionContext {
  function handler() {}
  Reflect.defineMetadata(GUARDS_METADATA, [TenantPermissionGuard], handler);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class Controller {}
  } as unknown as ExecutionContext;
}
