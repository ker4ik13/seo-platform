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
  Put,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticCustomColumn,
  SemanticKeywordCustomValue
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
  createSemanticCustomColumnInput,
  setSemanticKeywordCustomValueInput,
  updateSemanticCustomColumnInput
} from "./semantic-custom-column-input.js";

@Controller("api/v1/projects/:projectId")
export class SemanticCustomColumnController {
  private readonly logger = new Logger(SemanticCustomColumnController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Get("semantic-custom-columns")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly SemanticCustomColumn[]>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listSemanticCustomColumns(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Post("semantic-custom-columns")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("semantic.manage_custom_columns")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticCustomColumn>> {
    const tenant = requiredMutableProjectTenant(request);
    const input = createSemanticCustomColumnInput(body);
    await this.requestedAudit(request, principal, "create");
    const result = await this.seoData.createSemanticCustomColumn(
      internalProjectContext(request, principal, tenant),
      input
    );
    await this.committedAudit(
      request,
      principal,
      result.id,
      "created"
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Patch("semantic-custom-columns/:columnId")
  @RequirePermission("semantic.manage_custom_columns")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("columnId") columnId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticCustomColumn>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalColumnId = assertUuid(columnId, "columnId");
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = updateSemanticCustomColumnInput(body);
    await this.requestedAudit(request, principal, "update", canonicalColumnId);
    const result = await this.seoData.updateSemanticCustomColumn(
      internalProjectContext(request, principal, tenant),
      canonicalColumnId,
      input,
      version
    );
    await this.committedAudit(
      request,
      principal,
      canonicalColumnId,
      "updated"
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Delete("semantic-custom-columns/:columnId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission("semantic.manage_custom_columns")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async delete(
    @Param("columnId") columnId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalColumnId = assertUuid(columnId, "columnId");
    const version = requiredVersion(headerValue(request, "if-match"));
    await this.requestedAudit(request, principal, "delete", canonicalColumnId);
    await this.seoData.deleteSemanticCustomColumn(
      internalProjectContext(request, principal, tenant),
      canonicalColumnId,
      version
    );
    await this.committedAudit(
      request,
      principal,
      canonicalColumnId,
      "deleted"
    );
  }

  @Put("keywords/:keywordId/custom-values/:columnId")
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async setKeywordValue(
    @Param("keywordId") keywordId: string,
    @Param("columnId") columnId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordCustomValue>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    const canonicalColumnId = assertUuid(columnId, "columnId");
    const input = setSemanticKeywordCustomValueInput(body);
    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.custom_value.set_requested",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.setSemanticKeywordCustomValue(
      internalProjectContext(request, principal, tenant),
      canonicalKeywordId,
      canonicalColumnId,
      input
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.custom_value.set",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Delete("keywords/:keywordId/custom-values/:columnId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async deleteKeywordValue(
    @Param("keywordId") keywordId: string,
    @Param("columnId") columnId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    const canonicalColumnId = assertUuid(columnId, "columnId");
    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.custom_value.delete_requested",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    await this.seoData.deleteSemanticKeywordCustomValue(
      internalProjectContext(request, principal, tenant),
      canonicalKeywordId,
      canonicalColumnId,
      requiredVersion(headerValue(request, "if-match"))
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.custom_value.deleted",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
  }

  private async requestedAudit(
    request: TenantRequest,
    principal: AuthenticatedPrincipal,
    action: "create" | "update" | "delete",
    resourceId?: string
  ): Promise<void> {
    const tenant = requiredProjectTenant(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: `semantic.custom_column.${action}_requested`,
      resourceType: "semantic_custom_column",
      ...(resourceId ? { resourceId } : {}),
      outcome: "REQUESTED",
      requestId: requestContext(request).requestId
    });
  }

  private async committedAudit(
    request: TenantRequest,
    principal: AuthenticatedPrincipal,
    resourceId: string,
    action: "created" | "updated" | "deleted"
  ): Promise<void> {
    const tenant = requiredProjectTenant(request);
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: `semantic.custom_column.${action}`,
      resourceType: "semantic_custom_column",
      resourceId,
      outcome: "SUCCESS",
      requestId: requestContext(request).requestId
    });
  }
}
