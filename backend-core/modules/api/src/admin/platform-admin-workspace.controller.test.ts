import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  MODULE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { PlatformAdminModule } from "./platform-admin.module.js";
import {
  PlatformAdminBillingPlanController,
  PlatformAdminWorkspaceController
} from "./platform-admin-workspace.controller.js";
import { PLATFORM_ROLES_METADATA } from "./platform-role.js";
import { PlatformRoleGuard } from "./platform-role.guard.js";

test("workspace admin routes keep exact platform-role and CSRF boundaries", () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, PlatformAdminWorkspaceController),
    "admin-api/v1/workspaces"
  );
  assert.deepEqual(
    Reflect.getMetadata(
      PLATFORM_ROLES_METADATA,
      PlatformAdminWorkspaceController
    ),
    ["FINANCE", "SUPPORT", "OPERATIONS"]
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, PlatformAdminWorkspaceController),
    [SessionAuthGuard, PlatformRoleGuard]
  );

  const grant = PlatformAdminWorkspaceController.prototype.grantSubscription;
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, grant),
    ":workspaceId/subscription-grants"
  );
  assert.deepEqual(Reflect.getMetadata(PLATFORM_ROLES_METADATA, grant), [
    "FINANCE"
  ]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, grant), [
    CsrfSessionGuard,
    PlatformRoleGuard
  ]);
});

test("billing plan catalog is finance-only and registered with admin module", () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, PlatformAdminBillingPlanController),
    "admin-api/v1/billing/plans"
  );
  assert.deepEqual(
    Reflect.getMetadata(
      PLATFORM_ROLES_METADATA,
      PlatformAdminBillingPlanController
    ),
    ["FINANCE"]
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, PlatformAdminBillingPlanController),
    [SessionAuthGuard, PlatformRoleGuard]
  );
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    PlatformAdminModule
  ) as readonly unknown[];
  assert.ok(controllers.includes(PlatformAdminWorkspaceController));
  assert.ok(controllers.includes(PlatformAdminBillingPlanController));
});
