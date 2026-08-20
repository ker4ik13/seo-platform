import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { ProjectPresenceController } from "./project-presence.controller.js";
import type { ProjectPresenceService } from "./project-presence.service.js";

test("project presence profiles require session and presence permission scope", async () => {
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      ProjectPresenceController.prototype.members
    ),
    [SessionAuthGuard, TenantPermissionGuard]
  );
  let scope: readonly string[] | undefined;
  const controller = new ProjectPresenceController({
    listMembers: async (...args: string[]) => {
      scope = args;
      return [
        {
          userId: "0198f258-8cc7-7abc-8def-1234567890ab",
          displayName: "Анна"
        }
      ];
    }
  } as unknown as ProjectPresenceService);

  const response = await controller.members(request());

  assert.deepEqual(scope, [
    "0198f258-8cc7-7abc-8def-1234567890ae",
    "0198f258-8cc7-7abc-8def-1234567890af"
  ]);
  assert.equal(response.data[0]?.displayName, "Анна");
});

function request(): TenantRequest {
  return {
    id: "presence-request-001",
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
