import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import {
  PlatformAdminNpdController,
  PlatformAdminProfileController,
  PlatformAdminStaffRoleController
} from "./platform-admin.controller.js";
import { PlatformAdminService } from "./platform-admin.service.js";
import {
  PlatformAdminBillingPlanController,
  PlatformAdminWorkspaceController
} from "./platform-admin-workspace.controller.js";
import { PlatformAdminWorkspaceService } from "./platform-admin-workspace.service.js";
import { PlatformRoleGuard } from "./platform-role.guard.js";

@Module({
  imports: [AuditModule, BillingModule, IdentityModule],
  controllers: [
    PlatformAdminProfileController,
    PlatformAdminNpdController,
    PlatformAdminStaffRoleController,
    PlatformAdminWorkspaceController,
    PlatformAdminBillingPlanController
  ],
  providers: [
    PlatformAdminService,
    PlatformAdminWorkspaceService,
    PlatformRoleGuard
  ]
})
export class PlatformAdminModule {}
