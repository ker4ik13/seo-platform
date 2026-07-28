import assert from "node:assert/strict";
import test from "node:test";
import type {
  IntegrationCredentialSummary
} from "@seo-platform/contracts";
import type { AuditRecord } from "../audit/audit.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { RecentAuthenticationService } from "../identity/recent-authentication.service.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { IntegrationController } from "./integration.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const credentialId = "01900000-0000-7000-8000-000000000002";
const principal: AuthenticatedPrincipal = {
  userId: "01900000-0000-7000-8000-000000000003",
  sessionId: "01900000-0000-7000-8000-000000000004",
  sessionFamilyId: "01900000-0000-7000-8000-000000000005",
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 15 * 60 * 1_000)
};
const credential: IntegrationCredentialSummary = {
  id: credentialId,
  workspaceId,
  provider: "KEYS_SO",
  label: "Primary",
  mode: "BYOK_API_KEY",
  status: "PENDING_VERIFICATION",
  displayHint: "••••-key",
  capabilities: ["KEYWORD_RESEARCH", "COMPETITOR_RESEARCH"],
  version: 1,
  createdAt: "2026-07-29T09:00:00.000Z",
  updatedAt: "2026-07-29T09:00:00.000Z"
};

test("guards every credential mutation and records successful outcomes", async () => {
  const auditRecords: AuditRecord[] = [];
  const jobCalls: Array<{
    readonly method: string;
    readonly args: readonly unknown[];
  }> = [];
  let recentChecks = 0;
  const controller = new IntegrationController(
    {
      createIntegrationCredential: async (...args: unknown[]) => {
        jobCalls.push({ method: "create", args });
        return credential;
      },
      updateIntegrationCredential: async (...args: unknown[]) => {
        jobCalls.push({ method: "update", args });
        return { ...credential, version: 2 };
      },
      revokeIntegrationCredential: async (...args: unknown[]) => {
        jobCalls.push({ method: "revoke", args });
      }
    } as unknown as JobsClient,
    {
      record: async (record: AuditRecord) => {
        auditRecords.push(record);
      }
    } as unknown as AuditService,
    {
      assert: (candidate: AuthenticatedPrincipal) => {
        assert.equal(candidate.userId, principal.userId);
        recentChecks += 1;
      }
    } as unknown as RecentAuthenticationService
  );
  const request = tenantRequest({
    "idempotency-key": "credential-create-001",
    "if-match": "\"v1\""
  });

  await controller.create(
    {
      provider: "KEYS_SO",
      label: "Primary",
      apiKey: "test-api-key"
    },
    request,
    principal
  );
  await controller.update(
    credentialId,
    { label: "Renamed" },
    request,
    principal
  );
  await controller.revoke(credentialId, request, principal);

  assert.equal(recentChecks, 3);
  assert.equal(jobCalls[0]?.method, "create");
  assert.equal(jobCalls[0]?.args[2], "credential-create-001");
  assert.deepEqual(
    auditRecords.map((record) => [record.action, record.outcome]),
    [
      ["integration.credential.connect_requested", "REQUESTED"],
      ["integration.credential.connected", "SUCCESS"],
      ["integration.credential.update_requested", "REQUESTED"],
      ["integration.credential.updated", "SUCCESS"],
      ["integration.credential.revoke_requested", "REQUESTED"],
      ["integration.credential.revoked", "SUCCESS"]
    ]
  );
  assert.equal(auditRecords[1]?.resourceId, credentialId);
});

test("does not call dependencies when recent authentication is required", async () => {
  let dependencyCalled = false;
  const controller = new IntegrationController(
    {
      createIntegrationCredential: async () => {
        dependencyCalled = true;
        return credential;
      }
    } as unknown as JobsClient,
    {
      record: async () => {
        dependencyCalled = true;
      }
    } as unknown as AuditService,
    {
      assert: () => {
        throw new DomainError({
          statusCode: 401,
          code: "REAUTHENTICATION_REQUIRED",
          message: "Recent authentication is required"
        });
      }
    } as unknown as RecentAuthenticationService
  );

  await assert.rejects(
    controller.create(
      {
        provider: "KEYS_SO",
        label: "Primary",
        apiKey: "test-api-key"
      },
      tenantRequest({ "idempotency-key": "credential-create-002" }),
      principal
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "REAUTHENTICATION_REQUIRED"
  );
  assert.equal(dependencyCalled, false);
});

function tenantRequest(
  headers: Readonly<Record<string, string>>
): TenantRequest {
  return {
    id: "request-integration-001",
    headers,
    tenantAuthorization: {
      workspaceId,
      roleCode: "OWNER"
    }
  } as unknown as TenantRequest;
}
