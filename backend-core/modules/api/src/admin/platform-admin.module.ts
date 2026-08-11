import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
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
import {
  PlatformAdminOperationController,
  PlatformAdminProjectController
} from "./platform-admin-read.controller.js";
import { PlatformAdminReadService } from "./platform-admin-read.service.js";

@Module({
  imports: [AuditModule, BillingModule, IdentityModule, JobsModule, SeoDataModule],
  controllers: [
    PlatformAdminProfileController,
    PlatformAdminNpdController,
    PlatformAdminStaffRoleController,
    PlatformAdminWorkspaceController,
    PlatformAdminBillingPlanController,
    PlatformAdminProjectController,
    PlatformAdminOperationController
  ],
  providers: [
    PlatformAdminService,
    PlatformAdminWorkspaceService,
    PlatformAdminReadService,
    PlatformRoleGuard
  ]
})
export class PlatformAdminModule {}
