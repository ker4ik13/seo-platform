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
  ProjectPositionHistory,
  ProjectPositionSummary,
  SemanticKeywordBulkCreatePreviewResult,
  SemanticKeywordBulkCreateResult,
  SemanticKeywordListItem,
  SemanticKeywordInsights,
  SemanticKeywordMergeResult,
  SemanticKeywordMergeSuggestion,
  SemanticOperationScopeKeyword,
  SemanticKeywordTagDeleteResult,
  SemanticKeywordTagOption,
  SemanticAiAnswerDetail,
  SemanticAiAnswerHistoryItem
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
import { parseSemanticRankDimensionKey } from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
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
  deleteSemanticKeywordInput,
  semanticKeywordBulkCreateInput,
  semanticKeywordBulkCreatePreviewInput,
  semanticKeywordMergeInput,
  updateSemanticKeywordInput
} from "./keyword-input.js";
import { semanticFrequencyContextRoute } from "./frequency-collection-input.js";
import { aiAnswerHistoryQuery } from "./ai-answer-history-query.js";
import {
  keywordListQuery,
  keywordBodyListInput,
  keywordOperationScopeInput,
  keywordMultiSearchInput,
  keywordTagOptionsQuery,
  projectPositionHistoryQuery
} from "./keyword-query.js";

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

  @Post("search")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async multiSearch(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const context = requestContext(request);
    const tenant = requiredProjectTenant(request);
    const result = await this.seoData.listKeywords(
      internalProjectContext(request, principal, tenant),
      keywordMultiSearchInput(body)
    );
    return {
      data: result.data,
      page: result.page,
      meta: { requestId: context.requestId }
    };
  }

  @Post("merge")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async merge(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordMergeResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const result = await this.seoData.mergeKeywords(
      internalProjectContext(request, principal, tenant),
      semanticKeywordMergeInput(body)
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword.merged",
      resourceType: "semantic_keyword",
      resourceId: result.keeperKeywordId,
      outcome: "SUCCESS",
      requestId: requestContext(request).requestId
    });
    return apiResponse(request, result);
  }

  @Post("list")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, CsrfSessionGuard, TenantPermissionGuard)
  public async bodyList(@Body() body: unknown, @Req() request: TenantRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const context = requestContext(request), tenant = requiredProjectTenant(request);
    const result = await this.seoData.listKeywords(internalProjectContext(request, principal, tenant), keywordBodyListInput(body));
    return { data: result.data, page: result.page, meta: { requestId: context.requestId } };
  }

  @Post("operation-scope")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async operationScope(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<SemanticOperationScopeKeyword>> {
    const context = requestContext(request);
    const tenant = requiredProjectTenant(request);
    const result = await this.seoData.listOperationScope(
      internalProjectContext(request, principal, tenant),
      keywordOperationScopeInput(body)
    );
    return {
      data: result.data,
      page: result.page,
      meta: { requestId: context.requestId }
    };
  }

  @Get("tag-options")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async tagOptions(
    @Query() query: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly string[]>> {
    const tenant = requiredProjectTenant(request);
    const { search } = keywordTagOptionsQuery(query);
    return apiResponse(
      request,
      await this.seoData.listKeywordTagOptions(
        internalProjectContext(request, principal, tenant),
        search
      )
    );
  }

  @Get("tags")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async tagManagementOptions(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly SemanticKeywordTagOption[]>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listKeywordTags(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Delete("tags/:tagId")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async deleteTag(
    @Param("tagId") tagId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordTagDeleteResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalTagId = assertUuid(tagId, "tagId");
    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.tag.delete_requested",
      resourceType: "semantic_tag",
      resourceId: canonicalTagId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.deleteKeywordTag(
      internalProjectContext(request, principal, tenant),
      canonicalTagId
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.tag.deleted",
      resourceType: "semantic_tag",
      resourceId: canonicalTagId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }

  @Get("merge-suggestions")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async mergeSuggestions(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly SemanticKeywordMergeSuggestion[]>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.keywordMergeSuggestions(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Get("position-summary")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async positionSummary(
    @Query() query: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectPositionSummary>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.projectPositionSummary(
        internalProjectContext(request, principal, tenant),
        projectPositionHistoryQuery(query)
      )
    );
  }

  @Get("position-history")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async positionHistory(
    @Query() query: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectPositionHistory>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.projectPositionHistory(
        internalProjectContext(request, principal, tenant),
        projectPositionHistoryQuery(query)
      )
    );
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
      action:
        result.createOutcome === "RESTORED"
          ? "semantic.keyword.restored"
          : result.createOutcome === "LINKED_EXISTING"
            ? "semantic.keyword.group_linked"
          : result.createOutcome === "SKIPPED_EXISTING"
            ? "semantic.keyword.create_skipped"
            : "semantic.keyword.created",
      resourceType: "semantic_keyword",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post("bulk")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.create")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async bulkCreate(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordBulkCreateResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = semanticKeywordBulkCreateInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword.bulk_create_requested",
      resourceType: "semantic_keyword",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.bulkCreateKeywords(
      internalProjectContext(request, principal, tenant),
      input,
      await this.billingEntitlements.semanticCapacity(tenant.workspaceId)
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword.bulk_create_completed",
      resourceType: "semantic_keyword",
      outcome:
        result.failed > 0 || result.rejected > 0 ? "PARTIAL" : "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }

  @Post("bulk-preview")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.create")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async previewBulkCreate(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordBulkCreatePreviewResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const input = semanticKeywordBulkCreatePreviewInput(body);
    return apiResponse(
      request,
      await this.seoData.previewBulkCreateKeywords(
        internalProjectContext(request, principal, tenant),
        input
      )
    );
  }

  @Get(":keywordId/insights")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async insights(
    @Param("keywordId") keywordId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query("dimensionKey") dimensionKey?: unknown,
    @Query("snapshotId") snapshotId?: unknown
  ): Promise<ApiResponse<SemanticKeywordInsights>> {
    const tenant = requiredProjectTenant(request);
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    if (dimensionKey !== undefined && !parseSemanticRankDimensionKey(dimensionKey)) throw validationError("dimensionKey", "INVALID_DIMENSION", "Choose a valid rank dimension");
    if (snapshotId !== undefined && typeof snapshotId !== "string") {
      throw validationError(
        "snapshotId",
        "INVALID_SNAPSHOT",
        "Choose a valid rank snapshot"
      );
    }
    const canonicalSnapshotId = snapshotId === undefined
      ? undefined
      : assertUuid(snapshotId as string, "snapshotId");
    return apiResponse(
      request,
      await this.seoData.keywordInsights(
        internalProjectContext(request, principal, tenant),
        canonicalKeywordId,
        dimensionKey as string | undefined,
        canonicalSnapshotId
      )
    );
  }

  @Get(":keywordId/ai-answers")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async aiAnswers(
    @Param("keywordId") keywordId: string,
    @Query("dimensionKey") dimensionKey: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly SemanticAiAnswerDetail[]>> {
    const tenant = requiredProjectTenant(request);
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    return apiResponse(
      request,
      await this.seoData.keywordAiAnswers(
        internalProjectContext(request, principal, tenant),
        canonicalKeywordId,
        typeof dimensionKey === "string" ? dimensionKey : undefined
      )
    );
  }

  @Get(":keywordId/ai-answers/history")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async aiAnswerHistory(
    @Param("keywordId") keywordId: string,
    @Query() query: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<SemanticAiAnswerHistoryItem>> {
    const tenant = requiredProjectTenant(request);
    const context = internalProjectContext(request, principal, tenant);
    const result = await this.seoData.keywordAiAnswerHistory(
      context,
      assertUuid(keywordId, "keywordId"),
      aiAnswerHistoryQuery(query)
    );
    return {
      data: result.data,
      page: result.page,
      meta: { requestId: context.requestId }
    };
  }

  @Delete(":keywordId/frequencies/:type/:device")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async deleteFrequencyContext(
    @Param("keywordId") keywordId: string,
    @Param("type") type: string,
    @Param("device") device: string,
    @Query("regionCode") regionCode: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    const frequency = semanticFrequencyContextRoute(type, regionCode, device);
    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword_frequency.delete_requested",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    await this.seoData.deleteKeywordFrequencyContext(
      internalProjectContext(request, principal, tenant),
      canonicalKeywordId,
      frequency.type,
      frequency.regionCode,
      frequency.device
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.keyword_frequency.deleted",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
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
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalKeywordId = assertUuid(keywordId, "keywordId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = deleteSemanticKeywordInput(body);
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
      version,
      input.permanent === true
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: input.permanent === true
        ? "semantic.keyword.permanently_deleted"
        : "semantic.keyword.trashed",
      resourceType: "semantic_keyword",
      resourceId: canonicalKeywordId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
  }
}
