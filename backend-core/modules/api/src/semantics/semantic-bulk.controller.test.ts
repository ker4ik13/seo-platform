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
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { SemanticBulkController } from "./semantic-bulk.controller.js";

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

test("protects cleaner preview and apply with bulk permission and CSRF", () => {
  const prototype = SemanticBulkController.prototype;
  for (const [method, path] of [
    [prototype.previewCleaning, "clean-preview"],
    [prototype.clean, "clean"]
  ] as const) {
    assert.equal(Reflect.getMetadata(PATH_METADATA, method), path);
    assert.equal(
      Reflect.getMetadata(REQUIRED_PERMISSION, method),
      "semantic.bulk_edit"
    );
    assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, method), 200);
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
      CsrfSessionGuard,
      TenantPermissionGuard
    ]);
  }
});

test("forwards normalized cleaner input and audits partial apply", async () => {
  const calls: Array<{ method: string; args: readonly unknown[] }> = [];
  const audits: AuditRecord[] = [];
  const controller = new SemanticBulkController(
    {
      previewSemanticKeywordCleaning: async (...args: unknown[]) => {
        calls.push({ method: "preview", args });
        return {
          selected: 1,
          applicable: 1,
          unchanged: 0,
          conflicted: 0,
          failed: 0,
          changes: []
        };
      },
      cleanSemanticKeywords: async (...args: unknown[]) => {
        calls.push({ method: "apply", args });
        return {
          selected: 1,
          changed: 0,
          unchanged: 0,
          conflicted: 1,
          failed: 0,
          updatedItems: [],
          unchangedIds: [],
          conflictedIds: [keywordId],
          failedIds: []
        };
      }
    } as unknown as SeoDataClient,
    {
      record: async (record: AuditRecord) => {
        audits.push(record);
      }
    } as unknown as AuditService
  );
  const body = {
    items: [{ id: keywordId.toUpperCase(), version: 3 }],
    rules: {
      collapseWhitespace: true,
      normalizeYo: false,
      letterCase: "LOWER"
    }
  };

  await controller.previewCleaning(body, request(), principal);
  await controller.clean(body, request(), principal);

  const expectedInput = {
    items: [{ id: keywordId, version: 3 }],
    rules: {
      collapseWhitespace: true,
      normalizeYo: false,
      letterCase: "LOWER"
    }
  };
  assert.deepEqual(calls.map(({ method, args }) => ({ method, input: args[1] })), [
    { method: "preview", input: expectedInput },
    { method: "apply", input: expectedInput }
  ]);
  assert.deepEqual(
    audits.map(({ action, outcome }) => ({ action, outcome })),
    [
      { action: "semantic.cleaning.requested", outcome: "REQUESTED" },
      { action: "semantic.cleaning.completed", outcome: "PARTIAL" }
    ]
  );
});

function request(): TenantRequest {
  return {
    id: "request-semantic-cleaning-001",
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
