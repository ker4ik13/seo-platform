import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type { AuditRecord } from "../audit/audit.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { KeywordController } from "./keyword.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000005",
  sessionFamilyId: "01900000-0000-7000-8000-000000000006",
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 900_000)
};

test("protects keyword frequency deletion with update permission and CSRF", () => {
  const method = KeywordController.prototype.deleteFrequencyContext;
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, method),
    ":keywordId/frequencies/:type/:device"
  );
  assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, method), "semantic.update");
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, method), 204);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
    CsrfSessionGuard,
    TenantPermissionGuard
  ]);
});

test("forwards an exact tenant-scoped frequency context and audits deletion", async () => {
  const calls: unknown[][] = [];
  const audits: AuditRecord[] = [];
  const controller = new KeywordController(
    {
      deleteKeywordFrequencyContext: async (...args: unknown[]) => {
        calls.push(args);
      }
    } as unknown as SeoDataClient,
    {
      record: async (record: AuditRecord) => {
        audits.push(record);
      }
    } as unknown as AuditService,
    {} as BillingEntitlementService
  );

  await controller.deleteFrequencyContext(
    keywordId.toUpperCase(),
    "EXACT",
    "MOBILE",
    "213",
    request(),
    principal
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(1), [keywordId, "EXACT", "213", "MOBILE"]);
  assert.deepEqual(
    audits.map(({ action, outcome, resourceId }) => ({
      action,
      outcome,
      resourceId
    })),
    [
      {
        action: "semantic.keyword_frequency.delete_requested",
        outcome: "REQUESTED",
        resourceId: keywordId
      },
      {
        action: "semantic.keyword_frequency.deleted",
        outcome: "SUCCESS",
        resourceId: keywordId
      }
    ]
  );
});

function request(): TenantRequest {
  return {
    id: "request-frequency-delete-001",
    headers: {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "OWNER"
    }
  } as TenantRequest;
}
