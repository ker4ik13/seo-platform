import { Module } from "@nestjs/common";
import { PlatformAdminControlController } from "./platform-admin-control.controller.js";
import { PlatformAdminControlService } from "./platform-admin-control.service.js";
import { PlatformUsageReviewController } from "./platform-usage-review.controller.js";
import { PlatformRefundController } from "./platform-refund.controller.js";
import { PlatformProviderController } from "./platform-provider.controller.js";
import { PlatformOverviewService } from "./platform-overview.service.js";
import { PlatformOverviewController } from "./platform-overview.controller.js";
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
import { PlatformAdminWorkerNodeController } from "./platform-admin-worker-nodes.controller.js";
import { PlatformAdminWorkerNodeService } from "./platform-admin-worker-nodes.service.js";
import { ProductAnalyticsModule } from "../analytics/product-analytics.module.js";
import { PlatformAnalyticsController } from "./platform-analytics.controller.js";
import { PlatformAnalyticsService } from "./platform-analytics.service.js";

@Module({
  imports: [AuditModule, BillingModule, IdentityModule, JobsModule, SeoDataModule,ProductAnalyticsModule],
  controllers: [
    PlatformAdminControlController,
    PlatformAnalyticsController,
    PlatformUsageReviewController,
    PlatformOverviewController,
    PlatformProviderController,
    PlatformRefundController,
    PlatformAdminProfileController,
    PlatformAdminNpdController,
    PlatformAdminStaffRoleController,
    PlatformAdminWorkspaceController,
    PlatformAdminBillingPlanController,
    PlatformAdminProjectController,
    PlatformAdminOperationController,
    PlatformAdminWorkerNodeController
  ],
  providers: [
    PlatformAdminControlService,
    PlatformAnalyticsService,
    PlatformOverviewService,
    PlatformAdminService,
    PlatformAdminWorkspaceService,
    PlatformAdminReadService,
    PlatformAdminWorkerNodeService,
    PlatformRoleGuard
  ]
})
export class PlatformAdminModule {}
