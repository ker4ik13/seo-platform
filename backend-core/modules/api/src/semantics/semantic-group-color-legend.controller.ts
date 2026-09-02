import {
  Body,
  Controller,
  Get,
  Logger,
  Patch,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticGroupColorLegend
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import {
  hasEffectiveProjectPermission
} from "../authorization/permissions.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant,
  type AuthorizedProjectTenant
} from "../authorization/project-tenant.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { setEntityVersion } from "../common/entity-version.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import {
  markSemanticGroupColorLegendSeenInput,
  requiredSemanticGroupColorLegendVersion,
  updateSemanticGroupColorLegendInput
} from "./semantic-group-color-legend-input.js";

@Controller("api/v1/projects/:projectId/semantic-group-color-legend")
export class SemanticGroupColorLegendController {
  private readonly logger = new Logger(SemanticGroupColorLegendController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Get()
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticGroupColorLegend>> {
    const tenant = requiredProjectTenant(request);
    const state = await this.seoData.getSemanticGroupColorLegend(
      internalProjectContext(request, principal, tenant)
    );
    const result = legend(state, canManage(tenant));
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Patch()
  @RequirePermission("semantic.manage_group_color_legend")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticGroupColorLegend>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const version = requiredSemanticGroupColorLegendVersion(
      headerValue(request, "if-match")
    );
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group_color_legend.update_requested",
      resourceType: "semantic_group_color_legend",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const state = await this.seoData.updateSemanticGroupColorLegend(
      internalProjectContext(request, principal, tenant),
      updateSemanticGroupColorLegendInput(body),
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group_color_legend.updated",
      resourceType: "semantic_group_color_legend",
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    const result = legend(state, true);
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post("seen")
  @RequirePermission("semantic.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async markSeen(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticGroupColorLegend>> {
    const tenant = requiredProjectTenant(request);
    const { version } = markSemanticGroupColorLegendSeenInput(body);
    const state = await this.seoData.markSemanticGroupColorLegendSeen(
      internalProjectContext(request, principal, tenant),
      version
    );
    const result = legend(state, canManage(tenant));
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }
}

function canManage(tenant: AuthorizedProjectTenant): boolean {
  return hasEffectiveProjectPermission(
    tenant.roleCode,
    tenant.projectAccessLevel,
    "semantic.manage_group_color_legend"
  );
}

function legend(
  state: Omit<SemanticGroupColorLegend, "access">,
  canManageLegend: boolean
): SemanticGroupColorLegend {
  return {
    ...state,
    access: { canManage: canManageLegend }
  };
}
