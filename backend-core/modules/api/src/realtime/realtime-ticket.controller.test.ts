import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { RealtimeProjectTicket } from "@seo-platform/contracts";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { RealtimeClient } from "./realtime.client.js";
import { RealtimeTicketController } from "./realtime-ticket.controller.js";

const ID = "0198f258-8cc7-7abc-8def-1234567890ab";
const issuedAt = new Date("2026-07-30T12:00:00.000Z");
const ticket: RealtimeProjectTicket = {
  ticket: randomBytes(32).toString("base64url"),
  namespace: "/collaboration",
  issuedAt: issuedAt.toISOString(),
  expiresAt: new Date(issuedAt.getTime() + 30_000).toISOString(),
  authorizationExpiresAt: new Date(
    issuedAt.getTime() + 60_000
  ).toISOString()
};

test("requires CSRF, current tenant permission and injects trusted scope", async () => {
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      RealtimeTicketController.prototype.issue
    ),
    [CsrfSessionGuard, TenantPermissionGuard]
  );
  let captured: readonly unknown[] | undefined;
  const controller = new RealtimeTicketController({
    issueProjectTicket: async (...args: unknown[]) => {
      captured = args;
      return ticket;
    }
  } as unknown as RealtimeClient);

  const response = await controller.issue(
    { clientInstanceId: ID },
    request("https://app.example.test"),
    principal()
  );

  assert.deepEqual(response.data, ticket);
  assert.deepEqual(captured?.[0], {
    tenant: request("https://app.example.test").tenantAuthorization,
    actorId: ID,
    requestId: "request-realtime-001"
  });
  assert.deepEqual(captured?.[1], {
    sessionId: "0198f258-8cc7-7abc-8def-1234567890ac",
    sessionFamilyId: "0198f258-8cc7-7abc-8def-1234567890ad",
    sessionExpiresAt: "2026-08-30T12:00:00.000Z"
  });
  assert.deepEqual(captured?.[2], { clientInstanceId: ID });
  assert.equal(captured?.[3], "https://app.example.test");
});

test("rejects a missing or non-canonical Origin before issuing a ticket", async () => {
  let calls = 0;
  const controller = new RealtimeTicketController({
    issueProjectTicket: async () => {
      calls += 1;
      return ticket;
    }
  } as unknown as RealtimeClient);

  for (const origin of [undefined, "https://app.example.test/path"]) {
    await assert.rejects(
      controller.issue(
        { clientInstanceId: ID },
        request(origin),
        principal()
      ),
      (error: unknown) =>
        error instanceof DomainError && error.statusCode === 403
    );
  }
  assert.equal(calls, 0);
});

function principal(): AuthenticatedPrincipal {
  return {
    userId: ID,
    sessionId: "0198f258-8cc7-7abc-8def-1234567890ac",
    sessionFamilyId: "0198f258-8cc7-7abc-8def-1234567890ad",
    authenticatedAt: new Date("2026-07-30T11:00:00.000Z"),
    expiresAt: new Date("2026-08-30T12:00:00.000Z")
  };
}

function request(origin: string | undefined): TenantRequest {
  return {
    id: "request-realtime-001",
    headers: origin ? { origin } : {},
    tenantAuthorization: {
      workspaceId: "0198f258-8cc7-7abc-8def-1234567890ae",
      workspaceStatus: "ACTIVE",
      projectId: "0198f258-8cc7-7abc-8def-1234567890af",
      projectStatus: "ACTIVE",
      roleCode: "SEO_SPECIALIST",
      membershipId: "0198f258-8cc7-7abc-8def-1234567890b0",
      membershipVersion: 4
    }
  } as unknown as TenantRequest;
}
