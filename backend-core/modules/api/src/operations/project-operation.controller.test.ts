import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type {
  AuditRecord,
  AuditService
} from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import type { JobsClient } from "../jobs/jobs.client.js";
import { ProjectOperationController } from "./project-operation.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const operationId = "01900000-0000-7000-8000-000000000004";
const dismissedAt = "2026-09-11T12:45:00.000Z";

const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000005",
  sessionFamilyId: "01900000-0000-7000-8000-000000000006",
  authenticatedAt: new Date("2026-09-11T12:00:00.000Z"),
  expiresAt: new Date("2026-09-11T14:00:00.000Z")
};

test("exposes one CSRF-protected task.manage dismissal route", () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, ProjectOperationController),
    "api/v1/projects/:projectId/operations"
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, ProjectOperationController.prototype.dismiss),
    ":operationId"
  );
  assert.equal(
    Reflect.getMetadata(REQUIRED_PERMISSION, ProjectOperationController.prototype.dismiss),
    "task.manage"
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, ProjectOperationController.prototype.dismiss),
    [CsrfSessionGuard, TenantPermissionGuard]
  );
});

test("dismisses the tenant operation and records requested and committed audit", async () => {
  const records: AuditRecord[] = [];
  const controller = new ProjectOperationController(
    {
      dismissProjectOperation: async (_context: unknown, id: string) => {
        assert.equal(id, operationId);
        return { operationId, dismissedAt };
      }
    } as unknown as JobsClient,
    {
      record: async (record: AuditRecord) => {
        records.push(record);
      }
    } as unknown as AuditService
  );

  assert.deepEqual(
    await controller.dismiss(operationId, request(), principal),
    {
      data: { operationId, dismissedAt },
      meta: { requestId: "request-operation-dismiss-001" }
    }
  );
  assert.deepEqual(records.map(({ action, outcome, resourceId }) => ({
    action,
    outcome,
    resourceId
  })), [
    {
      action: "operation.dismiss_requested",
      outcome: "REQUESTED",
      resourceId: operationId
    },
    {
      action: "operation.dismissed",
      outcome: "SUCCESS",
      resourceId: operationId
    }
  ]);
});

function request(): TenantRequest {
  return {
    id: "request-operation-dismiss-001",
    headers: {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "SEO_SPECIALIST",
      membershipId: "01900000-0000-7000-8000-000000000007",
      membershipVersion: 2,
      projectAccessLevel: "MEMBER"
    }
  } as TenantRequest;
}
