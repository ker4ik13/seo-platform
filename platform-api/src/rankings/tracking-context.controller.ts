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
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  TrackingContextAccess,
  TrackingContextKeywordAssignmentItem,
  TrackingContextKeywordAssignmentState,
  TrackingContextKeywordReplacementResult,
  TrackingContextSettings,
  TrackingContextSummary
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { hasEffectiveProjectPermission } from "../authorization/permissions.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant,
  type AuthorizedProjectTenant
} from "../authorization/project-tenant.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { setEntityVersion } from "../common/entity-version.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
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
  createTrackingContextInput,
  replaceTrackingContextKeywordsInput,
  trackingContextKeywordQuery,
  updateTrackingContextInput
} from "./tracking-context-input.js";

@Controller("api/v1/projects/:projectId/tracking-contexts")
export class TrackingContextController {
  private readonly logger = new Logger(TrackingContextController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService,
    private readonly billingEntitlements: BillingEntitlementService
  ) {}

  @Get()
  @RequirePermission("ranking.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextSettings>> {
    const tenant = requiredProjectTenant(request);
    const collection = await this.seoData.listTrackingContexts(
      internalProjectContext(request, principal, tenant)
    );
    return apiResponse(request, {
      ...collection,
      access: trackingContextAccess(tenant)
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("ranking.configure")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const input = createTrackingContextInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.tracking_context.create_requested",
      resourceType: "tracking_context",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.createTrackingContext(
      internalProjectContext(request, principal, tenant),
      input,
      idempotencyKey
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.tracking_context.created",
      resourceType: "tracking_context",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Get(":contextId")
  @RequirePermission("ranking.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("contextId") contextId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextSummary>> {
    const tenant = requiredProjectTenant(request);
    const canonicalContextId = assertUuid(contextId, "contextId");
    const result = await this.seoData.getTrackingContext(
      internalProjectContext(request, principal, tenant),
      canonicalContextId
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Patch(":contextId")
  @RequirePermission("ranking.configure")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("contextId") contextId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalContextId = assertUuid(contextId, "contextId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = updateTrackingContextInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.tracking_context.update_requested",
      resourceType: "tracking_context",
      resourceId: canonicalContextId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.updateTrackingContext(
      internalProjectContext(request, principal, tenant),
      canonicalContextId,
      input,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.tracking_context.updated",
      resourceType: "tracking_context",
      resourceId: canonicalContextId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post(":contextId/archive")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("ranking.configure")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public archive(
    @Param("contextId") contextId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextSummary>> {
    return this.changeStatus(
      "archive",
      contextId,
      request,
      reply,
      principal
    );
  }

  @Post(":contextId/restore")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("ranking.configure")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public restore(
    @Param("contextId") contextId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextSummary>> {
    return this.changeStatus(
      "restore",
      contextId,
      request,
      reply,
      principal
    );
  }

  @Get(":contextId/keywords")
  @RequirePermission("ranking.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async listKeywords(
    @Param("contextId") contextId: string,
    @Query() query: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<
    ApiCollectionResponse<TrackingContextKeywordAssignmentItem>
  > {
    const tenant = requiredProjectTenant(request);
    const canonicalContextId = assertUuid(contextId, "contextId");
    const context = requestContext(request);
    const result = await this.seoData.listTrackingContextKeywords(
      internalProjectContext(request, principal, tenant),
      canonicalContextId,
      trackingContextKeywordQuery(query)
    );
    return {
      data: result.data,
      page: result.page,
      meta: { requestId: context.requestId }
    };
  }

  @Put(":contextId/keywords")
  @RequirePermission("ranking.configure")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async replaceKeywords(
    @Param("contextId") contextId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextKeywordReplacementResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalContextId = assertUuid(contextId, "contextId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const input = replaceTrackingContextKeywordsInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.tracking_context.keywords_replace_requested",
      resourceType: "tracking_context_keyword_assignments",
      resourceId: canonicalContextId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.replaceTrackingContextKeywords(
      internalProjectContext(request, principal, tenant),
      canonicalContextId,
      input,
      version,
      idempotencyKey,
      await this.billingEntitlements.semanticCapacity(tenant.workspaceId)
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.tracking_context.keywords_replaced",
      resourceType: "tracking_context_keyword_assignments",
      resourceId: canonicalContextId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Put(":contextId/keywords/:keywordId")
  @RequirePermission("ranking.configure")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public assignKeyword(
    @Param("contextId") contextId: string,
    @Param("keywordId") keywordId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextKeywordAssignmentState>> {
    return this.changeKeyword(
      true,
      contextId,
      keywordId,
      request,
      principal
    );
  }

  @Delete(":contextId/keywords/:keywordId")
  @RequirePermission("ranking.configure")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public removeKeyword(
    @Param("contextId") contextId: string,
    @Param("keywordId") keywordId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextKeywordAssignmentState>> {
    return this.changeKeyword(
      false,
      contextId,
      keywordId,
      request,
      principal
    );
  }

  private async changeStatus(
    operation: "archive" | "restore",
    contextId: string,
    request: TenantRequest,
    reply: FastifyReply,
    principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalContextId = assertUuid(contextId, "contextId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: `ranking.tracking_context.${operation}_requested`,
      resourceType: "tracking_context",
      resourceId: canonicalContextId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.changeTrackingContextStatus(
      internalProjectContext(request, principal, tenant),
      canonicalContextId,
      operation,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action:
        operation === "archive"
          ? "ranking.tracking_context.archived"
          : "ranking.tracking_context.restored",
      resourceType: "tracking_context",
      resourceId: canonicalContextId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  private async changeKeyword(
    assigned: boolean,
    contextId: string,
    keywordId: string,
    request: TenantRequest,
    principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TrackingContextKeywordAssignmentState>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalContextId = assertUuid(contextId, "contextId");
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    const context = requestContext(request);
    const operation = assigned ? "assign" : "remove";
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action:
        `ranking.tracking_context.keyword_${operation}_requested`,
      resourceType: "tracking_context_keyword_assignment",
      resourceId: canonicalKeywordId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.changeTrackingContextKeyword(
      internalProjectContext(request, principal, tenant),
      canonicalContextId,
      canonicalKeywordId,
      assigned,
      await this.billingEntitlements.semanticCapacity(
        tenant.workspaceId
      )
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: assigned
        ? "ranking.tracking_context.keyword_assigned"
        : "ranking.tracking_context.keyword_removed",
      resourceType: "tracking_context_keyword_assignment",
      resourceId: canonicalKeywordId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }
}

function trackingContextAccess(
  tenant: AuthorizedProjectTenant
): TrackingContextAccess {
  const mutationRestriction =
    trackingContextMutationRestriction(tenant);
  return {
    canConfigure: mutationRestriction === "NONE",
    mutationRestriction
  };
}

function trackingContextMutationRestriction(
  tenant: AuthorizedProjectTenant
): TrackingContextAccess["mutationRestriction"] {
  if (tenant.workspaceStatus === "READ_ONLY") {
    return "WORKSPACE_READ_ONLY";
  }
  if (
    !hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "ranking.configure"
    )
  ) {
    return "MISSING_PERMISSION";
  }
  if (tenant.projectStatus === "ARCHIVED") {
    return "PROJECT_ARCHIVED";
  }
  return "NONE";
}
