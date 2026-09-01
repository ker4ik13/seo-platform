import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalCreateRankEstimateInput,
  InternalCreateRankRunInput,
  InternalDispatchRankAutomationRunReceipt
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import type { AuthorizedProjectTenant } from "../authorization/project-tenant.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { DomainError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { CrawlAutomationDispatchGuard } from "../crawls/crawl-automation-dispatch.guard.js";
import { requiredDispatchHeaders } from "../crawls/crawl-automation-dispatch.input.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { TenantService } from "../tenants/tenant.service.js";
import { rankAutomationDispatchInput } from "./rank-automation-dispatch.input.js";

@Controller(
  "internal/v1/workspaces/:workspaceId/projects/:projectId/rank-automation-runs"
)
@UseGuards(CrawlAutomationDispatchGuard)
export class RankAutomationDispatchController {
  private readonly logger = new Logger(
    RankAutomationDispatchController.name
  );

  public constructor(
    private readonly authorization: AuthorizationService,
    private readonly billing: BillingEntitlementService,
    private readonly tenants: TenantService,
    private readonly jobs: JobsClient,
    private readonly audit: AuditService
  ) {}

  @Post("dispatch")
  @HttpCode(HttpStatus.CREATED)
  public async dispatch(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalDispatchRankAutomationRunReceipt>> {
    const input = rankAutomationDispatchInput(body);
    const headers = requiredDispatchHeaders(request);
    if (
      assertUuid(workspaceId, "workspaceId") !== input.workspaceId ||
      assertUuid(projectId, "projectId") !== input.projectId ||
      headers.workspaceId !== input.workspaceId ||
      headers.projectId !== input.projectId ||
      headers.actorId !== input.actorId ||
      headers.idempotencyKey !== input.idempotencyKey ||
      headers.requestId !== request.id
    ) {
      throw new BadRequestException(
        "Route, trusted headers and rank automation command do not match"
      );
    }

    const authorization = await this.authorization.forProject(
      input.actorId,
      input.projectId,
      "ranking.run"
    );
    const membershipId = authorization.membershipId;
    const membershipVersion = authorization.membershipVersion;
    if (
      authorization.workspaceId !== input.workspaceId ||
      authorization.projectId !== input.projectId ||
      authorization.workspaceStatus !== "ACTIVE" ||
      authorization.projectStatus !== "ACTIVE" ||
      !membershipId ||
      !Number.isSafeInteger(membershipVersion) ||
      Number(membershipVersion) < 1
    ) {
      scopeConflict("Rank automation execution scope is no longer active");
    }
    const tenant = authorization as AuthorizedProjectTenant;
    const [workspace, project, runAccess, jobCapacity] = await Promise.all([
      this.tenants.getWorkspace(input.actorId, input.workspaceId),
      this.tenants.getProject(input.projectId),
      this.billing.rankProviderRunAccess(input.workspaceId),
      this.billing.jobCapacity(input.workspaceId)
    ]);
    if (
      workspace.id !== input.workspaceId ||
      workspace.status !== "ACTIVE" ||
      project.id !== input.projectId ||
      project.workspaceId !== input.workspaceId ||
      project.status !== "ACTIVE"
    ) {
      scopeConflict("Rank automation tenant snapshot changed");
    }

    const context = {
      tenant,
      actorId: input.actorId,
      requestId: request.id
    };
    const projectSnapshot = {
      id: project.id,
      workspaceId: project.workspaceId,
      domain: project.domain,
      status: "ACTIVE" as const,
      version: project.version
    };
    const estimateCommand: InternalCreateRankEstimateInput = {
      trackingContextId: input.trackingContextId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      project: projectSnapshot,
      access: {
        workspaceStatus: "ACTIVE",
        canRunRanking: true,
        entitlementStatus: runAccess.entitlementStatus
      },
      billingCurrency: workspace.billingCurrency,
      quota: runAccess.quota
    };

    await this.audit.record({
      actorId: input.actorId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      action: "ranking.automation.dispatch_requested",
      resourceType: "rank_tracking_automation_run",
      resourceId: input.runId,
      outcome: "REQUESTED",
      requestId: request.id
    });
    const estimate = await this.jobs.createRankEstimate(
      context,
      estimateCommand,
      `automation-estimate-${input.runId}`
    );
    if (estimate.status !== "READY" || !estimate.executionAllowed) {
      throw new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "Rank automation estimate is blocked",
        details: {
          blocker: estimate.blockers[0]?.code ?? "ESTIMATE_BLOCKED"
        }
      });
    }
    if (
      BigInt(estimate.platformChargeMicro) >
      BigInt(input.maxPlatformChargeMicro)
    ) {
      throw new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "Rank automation platform charge exceeds its per-run limit",
        details: {
          chargeMicro: estimate.platformChargeMicro,
          limitMicro: input.maxPlatformChargeMicro
        }
      });
    }

    const runCommand: Omit<
      InternalCreateRankRunInput,
      "providerPricesMinor"
    > = {
      estimateId: estimate.id,
      confirmedPlatformChargeMicro: estimate.platformChargeMicro,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      project: projectSnapshot,
      access: {
        workspaceStatus: "ACTIVE",
        membershipId,
        membershipVersion: Number(membershipVersion),
        canRunRanking: true,
        entitlementStatus: runAccess.entitlementStatus,
        quota: runAccess.quota
      },
      billingCurrency: workspace.billingCurrency,
      jobCapacity
    };
    const job = await this.jobs.createRankRun(
      context,
      runCommand,
      `automation-rank-${input.runId}`
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: input.actorId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      action: "ranking.automation.dispatched",
      resourceType: "rank_tracking_automation_run",
      resourceId: input.runId,
      outcome: "SUCCESS",
      requestId: request.id
    });
    return {
      data: { estimateId: estimate.id, jobId: job.id },
      meta: { requestId: request.id }
    };
  }
}

function scopeConflict(message: string): never {
  throw new DomainError({
    statusCode: 409,
    code: "RESOURCE_STATE_CONFLICT",
    message
  });
}
