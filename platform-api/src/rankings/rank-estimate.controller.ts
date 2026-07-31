import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalCreateRankEstimateInput,
  RankEstimate
} from "@seo-platform/contracts";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { hasEffectiveProjectPermission } from "../authorization/permissions.js";
import {
  internalProjectContext,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { apiResponse } from "../common/api-response.js";
import { DomainError } from "../common/domain-error.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import {
  CsrfSessionGuard,
  headerValue
} from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { TenantService } from "../tenants/tenant.service.js";
import { createRankEstimateInput } from "./rank-estimate-input.js";

@Controller("api/v1/projects/:projectId/rank-estimates")
export class RankEstimateController {
  public constructor(
    private readonly jobs: JobsClient,
    private readonly tenants: TenantService,
    private readonly billingEntitlements: BillingEntitlementService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("ranking.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankEstimate>> {
    const tenant = requiredProjectTenant(request);
    const input = createRankEstimateInput(body);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const [workspace, project, entitlementStatus] = await Promise.all([
      this.tenants.getWorkspace(principal.userId, tenant.workspaceId),
      this.tenants.getProject(tenant.projectId),
      this.billingEntitlements.rankProviderAccess(tenant.workspaceId)
    ]);
    if (
      project.id !== tenant.projectId ||
      project.workspaceId !== tenant.workspaceId ||
      workspace.id !== tenant.workspaceId
    ) {
      throw invalidTenantSnapshot();
    }

    const command: InternalCreateRankEstimateInput = {
      trackingContextId: input.trackingContextId,
      workspaceId: workspace.id,
      projectId: project.id,
      actorId: principal.userId,
      project: {
        id: project.id,
        workspaceId: project.workspaceId,
        domain: project.domain,
        status: project.status,
        version: project.version
      },
      access: {
        workspaceStatus: workspace.status,
        canRunRanking: hasEffectiveProjectPermission(
          workspace.roleCode,
          tenant.projectAccessLevel,
          "ranking.run"
        ),
        entitlementStatus
      },
      billingCurrency: workspace.billingCurrency,
      quota: { status: "NOT_AVAILABLE" }
    };
    const result = await this.jobs.createRankEstimate(
      internalProjectContext(request, principal, tenant),
      command,
      idempotencyKey
    );
    return apiResponse(request, result);
  }
}

function invalidTenantSnapshot(): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "RESOURCE_STATE_CONFLICT",
    message: "Project tenant context changed; refresh and try again"
  });
}
