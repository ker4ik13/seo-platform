import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  ClusteringOperationResult,
  ClusteringProposalApplyResult,
  ClusteringProposalSectionResult,
  ClusteringProposalSummary,
  ClusteringRunSummary
} from "@seo-platform/contracts";
import {
  arsenkinClusteringKeywordLimit,
  clusteringProposalUnclusteredSectionId
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { assertUuid } from "../common/identifier.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import { CsrfSessionGuard, SessionAuthGuard } from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { operationResultPageQuery } from "../operation-results/operation-result-query.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import {
  applyClusteringProposalInput,
  clusteringCancelInput,
  clusteringIdempotencyKey,
  clusteringProposalRejectInput,
  createClusteringRunInput
} from "./clustering-run-input.js";

@Controller("api/v1/projects/:projectId/clustering-runs")
export class ClusteringRunController {
  private readonly logger = new Logger(ClusteringRunController.name);

  public constructor(
    private readonly jobs: JobsClient,
    private readonly billing: BillingEntitlementService,
    private readonly audit: AuditService,
    private readonly seoData?: SeoDataClient
  ) {}

  @Get()
  @RequirePermission("collector.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<{ readonly runs: readonly ClusteringRunSummary[] }>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(request, {
      runs: await this.jobs.listClusteringRuns(
        internalProjectContext(request, principal, tenant)
      )
    });
  }

  @Get(":jobId/result/sections/:sectionId")
  @RequirePermission("collector.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async sectionResult(
    @Param("jobId") jobId: string,
    @Param("sectionId") sectionId: string,
    @Query("limit") limitValue: unknown,
    @Query("cursor") cursorValue: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ClusteringProposalSectionResult>> {
    const tenant = requiredProjectTenant(request);
    const context = internalProjectContext(request, principal, tenant);
    const canonicalJobId = assertUuid(jobId, "jobId");
    const canonicalSectionId =
      sectionId === clusteringProposalUnclusteredSectionId
        ? clusteringProposalUnclusteredSectionId
        : assertUuid(sectionId, "sectionId");
    const page = operationResultPageQuery(
      limitValue,
      cursorValue,
      arsenkinClusteringKeywordLimit - 1
    );
    if (!this.seoData) throw new Error("SEO data client is not available");
    const result = await this.seoData.clusteringProposalSectionResult(
      context,
      canonicalJobId,
      canonicalSectionId,
      page.limit,
      page.cursor
    );
    return apiResponse(request, {
      sectionId: result.sectionId,
      rows: result.rows,
      page: result.page
    });
  }

  @Get(":jobId/result")
  @RequirePermission("collector.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async result(
    @Param("jobId") jobId: string,
    @Query("limit") limitValue: unknown,
    @Query("cursor") cursorValue: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ClusteringOperationResult>> {
    const tenant = requiredProjectTenant(request);
    const context = internalProjectContext(request, principal, tenant);
    const canonicalJobId = assertUuid(jobId, "jobId");
    const page = operationResultPageQuery(
      limitValue,
      cursorValue,
      arsenkinClusteringKeywordLimit - 1
    );
    if (!this.seoData) throw new Error("SEO data client is not available");
    const [run, proposal] = await Promise.all([
      this.jobs.getClusteringRun(context, canonicalJobId),
      this.seoData.clusteringProposalResult(
        context,
        canonicalJobId,
        page.limit,
        page.cursor
      )
    ]);
    return apiResponse(request, {
      run,
      ...(proposal.proposal ? { proposal: proposal.proposal } : {}),
      clusters: proposal.clusters,
      rows: proposal.rows,
      page: proposal.page
    });
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission("collector.run")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ClusteringRunSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const canonicalIdempotencyKey = clusteringIdempotencyKey(idempotencyKey);
    const [, jobCapacity] = await Promise.all([
      this.billing.semanticCapacity(tenant.workspaceId),
      this.billing.jobCapacity(tenant.workspaceId)
    ]);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.clustering_run.create_requested",
      resourceType: "clustering_run",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.createClusteringRun(
      internalProjectContext(request, principal, tenant),
      createClusteringRunInput(body),
      canonicalIdempotencyKey,
      jobCapacity
    );
    await committed(this.audit, this.logger, principal, tenant, context.requestId, "semantic.clustering_run.created", result.id);
    return apiResponse(request, result, result.version);
  }

  @Get(":jobId")
  @RequirePermission("collector.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("jobId") jobId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ClusteringRunSummary>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(request, await this.jobs.getClusteringRun(
      internalProjectContext(request, principal, tenant),
      assertUuid(jobId, "jobId")
    ));
  }

  @Post(":jobId/cancel")
  @RequirePermission("collector.cancel")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async cancel(
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ClusteringRunSummary>> {
    const tenant = requiredProjectTenant(request);
    const context = requestContext(request);
    const canonicalJobId = assertUuid(jobId, "jobId");
    clusteringCancelInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.clustering_run.cancel_requested",
      resourceType: "clustering_run",
      resourceId: canonicalJobId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.cancelClusteringRun(
      internalProjectContext(request, principal, tenant),
      canonicalJobId
    );
    await committed(this.audit, this.logger, principal, tenant, context.requestId, "semantic.clustering_run.cancelled", result.id);
    return apiResponse(request, result, result.version);
  }

  @Post(":jobId/apply")
  @RequirePermission("semantic.cluster")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async apply(
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ClusteringProposalApplyResult>> {
    const tenant = requiredMutableProjectTenant(request);
    if (!this.seoData) throw new Error("SEO data client is not available");
    const canonicalJobId = assertUuid(jobId, "jobId");
    const context = requestContext(request);
    const entitlement = await this.billing.semanticCapacity(tenant.workspaceId);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.clustering_proposal.apply_requested",
      resourceType: "clustering_run",
      resourceId: canonicalJobId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.applyClusteringProposal(
      internalProjectContext(request, principal, tenant),
      canonicalJobId,
      applyClusteringProposalInput(body),
      entitlement
    );
    await committed(this.audit, this.logger, principal, tenant, context.requestId, "semantic.clustering_proposal.applied", canonicalJobId);
    return apiResponse(request, result, result.proposal.version);
  }

  @Post(":jobId/reject")
  @RequirePermission("semantic.cluster")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async reject(
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ClusteringProposalSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    if (!this.seoData) throw new Error("SEO data client is not available");
    const canonicalJobId = assertUuid(jobId, "jobId");
    const input = clusteringProposalRejectInput(body);
    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.clustering_proposal.reject_requested",
      resourceType: "clustering_run",
      resourceId: canonicalJobId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.rejectClusteringProposal(
      internalProjectContext(request, principal, tenant),
      canonicalJobId,
      input.proposalVersion
    );
    await committed(this.audit, this.logger, principal, tenant, context.requestId, "semantic.clustering_proposal.rejected", canonicalJobId);
    return apiResponse(request, result, result.version);
  }
}

function committed(
  audit: AuditService,
  logger: Logger,
  principal: AuthenticatedPrincipal,
  tenant: ReturnType<typeof requiredProjectTenant>,
  requestId: string,
  action: string,
  resourceId: string
): Promise<void> {
  return recordCommittedAudit(audit, logger, {
    actorId: principal.userId,
    workspaceId: tenant.workspaceId,
    projectId: tenant.projectId,
    action,
    resourceType: "clustering_run",
    resourceId,
    outcome: "SUCCESS",
    requestId
  });
}
