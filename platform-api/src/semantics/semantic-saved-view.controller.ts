import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticSavedView
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { setEntityVersion } from "../common/entity-version.js";
import { assertUuid } from "../common/identifier.js";
import { requiredVersion } from "../common/version-precondition.js";
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
  createSemanticSavedViewInput,
  updateSemanticSavedViewInput
} from "./semantic-saved-view-input.js";

@Controller("api/v1/projects/:projectId/semantic-saved-views")
export class SemanticSavedViewController {
  private readonly logger = new Logger(SemanticSavedViewController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Get()
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly SemanticSavedView[]>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listSemanticSavedViews(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticSavedView>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = createSemanticSavedViewInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.saved_view.create_requested",
      resourceType: "semantic_saved_view",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.createSemanticSavedView(
      internalProjectContext(request, principal, tenant),
      input
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.saved_view.created",
      resourceType: "semantic_saved_view",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Patch(":viewId")
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("viewId") viewId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticSavedView>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalViewId = assertUuid(viewId, "viewId");
    const context = requestContext(request);
    const input = updateSemanticSavedViewInput(body);
    const version = requiredVersion(headerValue(request, "if-match"));
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.saved_view.update_requested",
      resourceType: "semantic_saved_view",
      resourceId: canonicalViewId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.updateSemanticSavedView(
      internalProjectContext(request, principal, tenant),
      canonicalViewId,
      input,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.saved_view.updated",
      resourceType: "semantic_saved_view",
      resourceId: canonicalViewId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Delete(":viewId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async delete(
    @Param("viewId") viewId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalViewId = assertUuid(viewId, "viewId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.saved_view.delete_requested",
      resourceType: "semantic_saved_view",
      resourceId: canonicalViewId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    await this.seoData.deleteSemanticSavedView(
      internalProjectContext(request, principal, tenant),
      canonicalViewId,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.saved_view.deleted",
      resourceType: "semantic_saved_view",
      resourceId: canonicalViewId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
  }
}
