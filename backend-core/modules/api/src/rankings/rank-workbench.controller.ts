import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  parseCreateRankDimensionMergeInput,
  parseDeleteRankDimensionHistoryInput,
  parseRankPositionReportInput,
  parseSerpWorkbenchInput,
  type ApiResponse,
  type RankDimensionMergeSettings,
  type RankDimensionMergeSummary,
  type RankDimensionHistoryDeletion,
  type RankPositionReport,
  type SerpWorkbenchReport
} from "@seo-platform/contracts";
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
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import { requiredVersion } from "../common/version-precondition.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";

@Controller("api/v1/projects/:projectId/rank-workbench")
export class RankWorkbenchController {
  private readonly logger = new Logger(RankWorkbenchController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Get("dimension-merges")
  @RequirePermission("ranking.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async mergeSettings(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankDimensionMergeSettings>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.rankDimensionMergeSettings(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Post("dimension-merges")
  @RequirePermission("ranking.configure")
  @UseGuards(SessionAuthGuard, CsrfSessionGuard, TenantPermissionGuard)
  public async createMerge(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyHeader: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankDimensionMergeSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = publicInput(parseCreateRankDimensionMergeInput, body);
    const idempotencyKey = requiredIdempotencyKey(
      typeof idempotencyHeader === "string" ? idempotencyHeader : undefined
    );
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.dimension_merge.requested",
      resourceType: "rank_dimension_merge",
      outcome: "REQUESTED",
      requestId: context.requestId,
      redactedChanges: {
        sourceDimensionKey: input.sourceDimensionKey,
        targetDimensionKey: input.targetDimensionKey
      }
    });
    const result = await this.seoData.createRankDimensionMerge(
      internalProjectContext(request, principal, tenant),
      input,
      idempotencyKey
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.dimension_merge.created",
      resourceType: "rank_dimension_merge",
      resourceId: result.id,
      outcome: "SUCCEEDED",
      requestId: context.requestId,
      redactedChanges: {
        sourceDimensionKey: input.sourceDimensionKey,
        targetDimensionKey: input.targetDimensionKey
      }
    });
    return apiResponse(request, result);
  }

  @Post("dimension-merges/:mergeId/remove")
  @HttpCode(200)
  @RequirePermission("ranking.configure")
  @UseGuards(SessionAuthGuard, CsrfSessionGuard, TenantPermissionGuard)
  public async removeMerge(
    @Param("mergeId") mergeId: string,
    @Headers("if-match") ifMatch: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<Readonly<{ id: string; removed: true }>>> {
    assertUuid(mergeId, "mergeId");
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const result = await this.seoData.removeRankDimensionMerge(
      internalProjectContext(request, principal, tenant),
      mergeId,
      requiredVersion(typeof ifMatch === "string" ? ifMatch : undefined)
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.dimension_merge.removed",
      resourceType: "rank_dimension_merge",
      resourceId: mergeId,
      outcome: "SUCCEEDED",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }

  @Post("positions")
  @HttpCode(200)
  @RequirePermission("ranking.view")
  @UseGuards(SessionAuthGuard, CsrfSessionGuard, TenantPermissionGuard)
  public async positions(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankPositionReport>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.rankPositionReport(
        internalProjectContext(request, principal, tenant),
        publicInput(parseRankPositionReportInput, body)
      )
    );
  }

  @Post("serp")
  @HttpCode(200)
  @RequirePermission("ranking.view")
  @UseGuards(SessionAuthGuard, CsrfSessionGuard, TenantPermissionGuard)
  public async serp(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SerpWorkbenchReport>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.serpWorkbenchReport(
        internalProjectContext(request, principal, tenant),
        publicInput(parseSerpWorkbenchInput, body)
      )
    );
  }

  @Post("delete-dimension-history")
  @HttpCode(200)
  @RequirePermission("ranking.configure")
  @UseGuards(SessionAuthGuard, CsrfSessionGuard, TenantPermissionGuard)
  public async deleteDimensionHistory(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyHeader: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankDimensionHistoryDeletion>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = publicInput(parseDeleteRankDimensionHistoryInput, body);
    const idempotencyKey = requiredIdempotencyKey(
      typeof idempotencyHeader === "string" ? idempotencyHeader : undefined
    );
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.dimension_history.delete_requested",
      resourceType: "rank_dimension_history",
      outcome: "REQUESTED",
      requestId: context.requestId,
      redactedChanges: { dimensionKey: input.dimensionKey }
    });
    const result = await this.seoData.deleteRankDimensionHistory(
      internalProjectContext(request, principal, tenant),
      input,
      idempotencyKey
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.dimension_history.deleted",
      resourceType: "rank_dimension_history",
      resourceId: result.id,
      outcome: "SUCCEEDED",
      requestId: context.requestId,
      redactedChanges: {
        dimensionKey: input.dimensionKey,
        excludedThrough: result.excludedThrough,
        affectedSnapshots: result.affectedSnapshots
      }
    });
    return apiResponse(request, result);
  }
}

function publicInput<Input>(
  parser: (value: unknown) => Input,
  value: unknown
): Input {
  try {
    return parser(value);
  } catch {
    throw validationError(
      "body",
      "INVALID_RANK_WORKBENCH_INPUT",
      "Choose a valid rank report scope"
    );
  }
}
