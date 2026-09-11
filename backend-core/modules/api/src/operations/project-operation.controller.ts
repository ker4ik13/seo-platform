import {
  Controller,
  Delete,
  Logger,
  Param,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  ProjectOperationDismissal
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant
} from "../authorization/project-tenant.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { assertUuid } from "../common/identifier.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";

@Controller("api/v1/projects/:projectId/operations")
export class ProjectOperationController {
  private readonly logger = new Logger(ProjectOperationController.name);

  public constructor(
    private readonly jobs: JobsClient,
    private readonly audit: AuditService
  ) {}

  @Delete(":operationId")
  @RequirePermission("task.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async dismiss(
    @Param("operationId") operationId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectOperationDismissal>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalOperationId = assertUuid(operationId, "operationId");
    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "operation.dismiss_requested",
      resourceType: "operation",
      resourceId: canonicalOperationId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.dismissProjectOperation(
      internalProjectContext(request, principal, tenant),
      canonicalOperationId
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "operation.dismissed",
      resourceType: "operation",
      resourceId: canonicalOperationId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }
}
