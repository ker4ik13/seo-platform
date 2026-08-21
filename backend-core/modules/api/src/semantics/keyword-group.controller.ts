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
  SemanticKeywordGroup
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
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
  createSemanticKeywordGroupInput,
  deleteSemanticKeywordGroupInput,
  duplicateSemanticKeywordGroupInput,
  updateSemanticKeywordGroupInput
} from "./keyword-group-input.js";

@Controller("api/v1/projects/:projectId/keyword-groups")
export class KeywordGroupController {
  private readonly logger = new Logger(KeywordGroupController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService,
    private readonly billingEntitlements: BillingEntitlementService
  ) {}

  @Get()
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly SemanticKeywordGroup[]>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listKeywordGroups(
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
  ): Promise<ApiResponse<SemanticKeywordGroup>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = createSemanticKeywordGroupInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group.create_requested",
      resourceType: "semantic_group",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.createKeywordGroup(
      internalProjectContext(request, principal, tenant),
      input,
      await this.billingEntitlements.semanticCapacity(tenant.workspaceId)
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group.created",
      resourceType: "semantic_group",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post(":groupId/duplicate")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async duplicate(
    @Param("groupId") groupId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordGroup>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalGroupId = assertUuid(groupId, "groupId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = duplicateSemanticKeywordGroupInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group.duplicate_requested",
      resourceType: "semantic_group",
      resourceId: canonicalGroupId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.duplicateKeywordGroup(
      internalProjectContext(request, principal, tenant),
      canonicalGroupId,
      input,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group.duplicated",
      resourceType: "semantic_group",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Patch(":groupId")
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("groupId") groupId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordGroup>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalGroupId = assertUuid(groupId, "groupId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = updateSemanticKeywordGroupInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group.update_requested",
      resourceType: "semantic_group",
      resourceId: canonicalGroupId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.updateKeywordGroup(
      internalProjectContext(request, principal, tenant),
      canonicalGroupId,
      input,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group.updated",
      resourceType: "semantic_group",
      resourceId: canonicalGroupId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Delete(":groupId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async delete(
    @Param("groupId") groupId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalGroupId = assertUuid(groupId, "groupId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = deleteSemanticKeywordGroupInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group.delete_requested",
      resourceType: "semantic_group",
      resourceId: canonicalGroupId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    await this.seoData.deleteKeywordGroup(
      internalProjectContext(request, principal, tenant),
      canonicalGroupId,
      version,
      input.deleteKeywords,
      input.promoteChildren
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.group.deleted",
      resourceType: "semantic_group",
      resourceId: canonicalGroupId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
  }
}
