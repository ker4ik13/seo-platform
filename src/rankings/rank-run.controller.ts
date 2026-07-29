import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalCreateRankRunInput,
  ProjectSummary,
  RankJobSummary,
  WorkspaceSummary
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { hasEffectiveProjectPermission } from "../authorization/permissions.js";
import {
  internalProjectContext,
  requiredProjectTenant,
  type AuthorizedProjectTenant
} from "../authorization/project-tenant.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { DomainError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { TenantService } from "../tenants/tenant.service.js";
import {
  assertEmptyRankJobCancelInput,
  createRankRunInput,
  requiredRankRunIdempotencyKey
} from "./rank-run-input.js";

@Controller("api/v1/projects/:projectId")
export class RankRunController {
  private readonly logger = new Logger(RankRunController.name);

  public constructor(
    private readonly jobs: JobsClient,
    private readonly tenants: TenantService,
    private readonly audit: AuditService
  ) {}

  @Post("rank-runs")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission("ranking.run")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankJobSummary>> {
    const input = createRankRunInput(body);
    const idempotencyKey = requiredRankRunIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const tenant = requiredProjectTenant(request);
    const membership = requiredMembershipSnapshot(tenant);
    const [workspace, project] = await Promise.all([
      this.tenants.getWorkspace(principal.userId, tenant.workspaceId),
      this.tenants.getProject(tenant.projectId)
    ]);
    assertTenantSnapshot(tenant, workspace, project);
    assertRankRunAllowed(tenant, workspace, project);

    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.rank_run.create_requested",
      resourceType: "rank_job",
      outcome: "REQUESTED",
      requestId: context.requestId
    });

    const command: InternalCreateRankRunInput = {
      estimateId: input.estimateId,
      workspaceId: workspace.id,
      projectId: project.id,
      actorId: principal.userId,
      project: {
        id: project.id,
        workspaceId: project.workspaceId,
        domain: project.domain,
        status: "ACTIVE",
        version: project.version
      },
      access: {
        workspaceStatus: "ACTIVE",
        membershipId: membership.id,
        membershipVersion: membership.version,
        canRunRanking: true,
        entitlementStatus: "NOT_AVAILABLE",
        quota: { status: "NOT_AVAILABLE" }
      },
      billingCurrency: workspace.billingCurrency
    };
    const job = await this.jobs.createRankRun(
      internalProjectContext(request, principal, tenant),
      command,
      idempotencyKey
    );

    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.rank_run.created",
      resourceType: "rank_job",
      resourceId: job.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    reply.header(
      "Location",
      `/api/v1/projects/${encodeURIComponent(
        tenant.projectId
      )}/jobs/${encodeURIComponent(job.id)}`
    );
    return apiResponse(request, job);
  }

  @Get("jobs/:jobId")
  @RequirePermission("ranking.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("jobId") jobId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankJobSummary>> {
    const tenant = requiredProjectTenant(request);
    const canonicalJobId = assertUuid(jobId, "jobId");
    const job = await this.jobs.getRankJob(
      internalProjectContext(request, principal, tenant),
      canonicalJobId
    );
    return apiResponse(request, job);
  }

  @Post("jobs/:jobId/cancel")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("collector.cancel")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async cancel(
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankJobSummary>> {
    const canonicalJobId = assertUuid(jobId, "jobId");
    assertEmptyRankJobCancelInput(body);
    const tenant = requiredProjectTenant(request);
    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.rank_job.cancel_requested",
      resourceType: "rank_job",
      resourceId: canonicalJobId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });

    const job = await this.jobs.cancelRankJob(
      internalProjectContext(request, principal, tenant),
      canonicalJobId
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "ranking.rank_job.cancel_resolved",
      resourceType: "rank_job",
      resourceId: canonicalJobId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, job);
  }
}

function requiredMembershipSnapshot(
  tenant: AuthorizedProjectTenant
): { readonly id: string; readonly version: number } {
  if (
    !tenant.membershipId ||
    !Number.isSafeInteger(tenant.membershipVersion) ||
    Number(tenant.membershipVersion) < 1
  ) {
    throw invalidTenantSnapshot();
  }
  return {
    id: tenant.membershipId,
    version: Number(tenant.membershipVersion)
  };
}

function assertTenantSnapshot(
  tenant: AuthorizedProjectTenant,
  workspace: WorkspaceSummary,
  project: ProjectSummary
): void {
  if (
    workspace.id !== tenant.workspaceId ||
    project.id !== tenant.projectId ||
    project.workspaceId !== tenant.workspaceId
  ) {
    throw invalidTenantSnapshot();
  }
}

function assertRankRunAllowed(
  tenant: AuthorizedProjectTenant,
  workspace: WorkspaceSummary,
  project: ProjectSummary
): void {
  if (workspace.status === "READ_ONLY") {
    throw new DomainError({
      statusCode: 402,
      code: "PAYMENT_REQUIRED",
      message: "Workspace is read-only; existing results remain available",
      details: {
        permission: "ranking.run",
        workspaceStatus: workspace.status
      }
    });
  }
  if (workspace.status === "SUSPENDED") {
    throw new DomainError({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Workspace access is suspended"
    });
  }
  if (project.status !== "ACTIVE") {
    throw new DomainError({
      statusCode: 409,
      code: "RESOURCE_STATE_CONFLICT",
      message: "Only an active project can start a manual rank Job",
      details: { projectStatus: project.status }
    });
  }
  if (
    !hasEffectiveProjectPermission(
      workspace.roleCode,
      tenant.projectAccessLevel,
      "ranking.run"
    )
  ) {
    throw new DomainError({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Required permission is missing",
      details: { permission: "ranking.run" }
    });
  }
}

function invalidTenantSnapshot(): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "RESOURCE_STATE_CONFLICT",
    message: "Project tenant context changed; refresh and try again"
  });
}
