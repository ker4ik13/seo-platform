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
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  SemanticKeywordListItem,
  SemanticKeywordInsights
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { RequirePermission } from "../authorization/require-permission.js";
import type {
  TenantRequest
} from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
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
  createSemanticKeywordInput,
  updateSemanticKeywordInput
} from "./keyword-input.js";
import { keywordListQuery } from "./keyword-query.js";

@Controller("api/v1/projects/:projectId/keywords")
export class KeywordController {
  private readonly logger = new Logger(KeywordController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService,
    private readonly billingEntitlements: BillingEntitlementService
  ) {}

  @Get()
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Query() query: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const context = requestContext(request);
    const tenant = requiredProjectTenant(request);
    const result = await this.seoData.listKeywords(
      internalProjectContext(request, principal, tenant),
      keywordListQuery(query)
    );
    return {
      data: result.data,
      page: result.page,
      meta: { requestId: context.requestId }
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("semantic.create")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordListItem>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = createSemanticKeywordInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword.create_requested",
      resourceType: "semantic_keyword",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.createKeyword(
      internalProjectContext(request, principal, tenant),
      input,
      await this.billingEntitlements.semanticCapacity(
        tenant.workspaceId
      )
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword.created",
      resourceType: "semantic_keyword",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Get(":keywordId/insights")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async insights(
    @Param("keywordId") keywordId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordInsights>> {
    const tenant = requiredProjectTenant(request);
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    return apiResponse(
      request,
      await this.seoData.keywordInsights(
        internalProjectContext(request, principal, tenant),
        canonicalKeywordId
      )
    );
  }

  @Patch(":keywordId")
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("keywordId") keywordId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordListItem>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = updateSemanticKeywordInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword.update_requested",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.updateKeyword(
      internalProjectContext(request, principal, tenant),
      canonicalKeywordId,
      input,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword.updated",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Delete(":keywordId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission("semantic.delete")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async delete(
    @Param("keywordId") keywordId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword.delete_requested",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    await this.seoData.deleteKeyword(
      internalProjectContext(request, principal, tenant),
      canonicalKeywordId,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword.deleted",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
  }
}
