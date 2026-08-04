import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  AutomationRunCollection,
  AutomationRunSummary,
  AutomationExecutionAccessSnapshot,
  InternalAutomationStatusInput,
  InternalCreateRankTrackingAutomationInput,
  InternalRankEstimateProjectSnapshot,
  InternalRunRankTrackingAutomationInput,
  InternalUpdateRankTrackingAutomationInput,
  RankTrackingAutomationSettings,
  RankTrackingAutomationSummary
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
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { DomainError } from "../common/domain-error.js";
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
import { JobsClient } from "../jobs/jobs.client.js";
import { TenantService } from "../tenants/tenant.service.js";
import {
  assertEmptyAutomationStatusInput,
  createAutomationInput,
  updateAutomationInput
} from "./automation-input.js";

@Controller("api/v1/projects/:projectId/automations")
export class AutomationController {
  private readonly logger = new Logger(AutomationController.name);

  public constructor(
    private readonly jobs: JobsClient,
    private readonly tenants: TenantService,
    private readonly billing: BillingEntitlementService,
    private readonly audit: AuditService
  ) {}

  @Get()
  @RequirePermission("automation.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankTrackingAutomationSettings>> {
    const tenant = requiredProjectTenant(request);
    const entitlement = await this.billing.automationCapacityForRead(
      tenant.workspaceId
    );
    const collection = await this.jobs.listAutomations(
      internalProjectContext(request, principal, tenant),
      entitlement.scheduledAutomations
    );
    return apiResponse(request, {
      ...collection,
      access: automationAccess(tenant)
    });
  }

  @Get(":automationId/runs")
  @RequirePermission("automation.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async listRuns(
    @Param("automationId") automationId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<AutomationRunCollection>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.jobs.listAutomationRuns(
        internalProjectContext(request, principal, tenant),
        assertUuid(automationId, "automationId")
      )
    );
  }

  @Post(":automationId/runs")
  @HttpCode(202)
  @RequirePermission("automation.enable")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async run(
    @Param("automationId") automationId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<AutomationRunSummary>> {
    assertEmptyAutomationStatusInput(body);
    const tenant = requiredMutableProjectTenant(request);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const { entitlement: _entitlement, ...snapshot } =
      await this.executionSnapshot(tenant, principal.userId);
    assertExecutableSnapshot(snapshot);
    const command: InternalRunRankTrackingAutomationInput = {
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      actorId: principal.userId,
      automationId: assertUuid(automationId, "automationId"),
      expectedVersion: requiredVersion(
        headerValue(request, "if-match")
      ),
      idempotencyKey,
      ...snapshot
    };
    await this.recordRequested(
      request,
      principal.userId,
      tenant,
      "ranking.automation.run_requested",
      command.automationId
    );
    const result = await this.jobs.runAutomation(
      internalProjectContext(request, principal, tenant),
      command
    );
    await this.recordSuccess(
      request,
      principal.userId,
      tenant,
      "ranking.automation.run_created",
      result.id,
      "rank_tracking_automation_run"
    );
    return apiResponse(request, result);
  }

  @Post()
  @RequirePermission("automation.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankTrackingAutomationSummary>> {
    const input = createAutomationInput(body);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const tenant = requiredMutableProjectTenant(request);
    if (input.enabled) assertCanEnable(tenant);
    const snapshot = await this.executionSnapshot(
      tenant,
      principal.userId
    );
    if (input.enabled) assertExecutableSnapshot(snapshot);
    const command: InternalCreateRankTrackingAutomationInput = {
      ...input,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      actorId: principal.userId,
      idempotencyKey,
      ...snapshot
    };
    await this.recordRequested(
      request,
      principal.userId,
      tenant,
      "ranking.automation.create_requested"
    );
    const result = await this.jobs.createAutomation(
      internalProjectContext(request, principal, tenant),
      command
    );
    await this.recordSuccess(
      request,
      principal.userId,
      tenant,
      "ranking.automation.created",
      result.id
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Patch(":automationId")
  @RequirePermission("automation.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("automationId") automationId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankTrackingAutomationSummary>> {
    const input = updateAutomationInput(body);
    const tenant = requiredMutableProjectTenant(request);
    if (input.enabled) assertCanEnable(tenant);
    const snapshot = await this.executionSnapshot(
      tenant,
      principal.userId
    );
    if (input.enabled) assertExecutableSnapshot(snapshot);
    const command: InternalUpdateRankTrackingAutomationInput = {
      ...input,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      actorId: principal.userId,
      automationId: assertUuid(automationId, "automationId"),
      expectedVersion: requiredVersion(
        headerValue(request, "if-match")
      ),
      ...snapshot
    };
    await this.recordRequested(
      request,
      principal.userId,
      tenant,
      "ranking.automation.update_requested",
      command.automationId
    );
    const result = await this.jobs.updateAutomation(
      internalProjectContext(request, principal, tenant),
      command
    );
    await this.recordSuccess(
      request,
      principal.userId,
      tenant,
      "ranking.automation.updated",
      result.id
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post(":automationId/pause")
  @HttpCode(200)
  @RequirePermission("automation.enable")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async pause(
    @Param("automationId") automationId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankTrackingAutomationSummary>> {
    assertEmptyAutomationStatusInput(body);
    const tenant = requiredMutableProjectTenant(request);
    const command = await this.statusCommand(
      automationId,
      request,
      tenant,
      principal.userId
    );
    await this.recordRequested(
      request,
      principal.userId,
      tenant,
      "ranking.automation.pause_requested",
      command.automationId
    );
    const result = await this.jobs.setAutomationStatus(
      internalProjectContext(request, principal, tenant),
      command,
      "pause"
    );
    await this.recordSuccess(
      request,
      principal.userId,
      tenant,
      "ranking.automation.paused",
      result.id
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post(":automationId/resume")
  @HttpCode(200)
  @RequirePermission("automation.enable")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async resume(
    @Param("automationId") automationId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RankTrackingAutomationSummary>> {
    assertEmptyAutomationStatusInput(body);
    const tenant = requiredMutableProjectTenant(request);
    assertCanEnable(tenant);
    const command = await this.statusCommand(
      automationId,
      request,
      tenant,
      principal.userId
    );
    assertExecutableSnapshot(command);
    await this.recordRequested(
      request,
      principal.userId,
      tenant,
      "ranking.automation.resume_requested",
      command.automationId
    );
    const result = await this.jobs.setAutomationStatus(
      internalProjectContext(request, principal, tenant),
      command,
      "resume"
    );
    await this.recordSuccess(
      request,
      principal.userId,
      tenant,
      "ranking.automation.resumed",
      result.id
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  private recordRequested(
    request: TenantRequest,
    actorId: string,
    tenant: AuthorizedProjectTenant,
    action: string,
    resourceId?: string
  ): Promise<void> {
    return this.audit.record({
      actorId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action,
      resourceType: "rank_tracking_automation",
      ...(resourceId ? { resourceId } : {}),
      outcome: "REQUESTED",
      requestId: requestContext(request).requestId
    });
  }

  private recordSuccess(
    request: TenantRequest,
    actorId: string,
    tenant: AuthorizedProjectTenant,
    action: string,
    resourceId: string,
    resourceType = "rank_tracking_automation"
  ): Promise<void> {
    return recordCommittedAudit(this.audit, this.logger, {
      actorId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action,
      resourceType,
      resourceId,
      outcome: "SUCCESS",
      requestId: requestContext(request).requestId
    });
  }

  private async statusCommand(
    automationId: string,
    request: TenantRequest,
    tenant: AuthorizedProjectTenant,
    actorId: string
  ): Promise<InternalAutomationStatusInput> {
    return {
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      actorId,
      automationId: assertUuid(automationId, "automationId"),
      expectedVersion: requiredVersion(
        headerValue(request, "if-match")
      ),
      ...(await this.executionSnapshot(tenant, actorId))
    };
  }

  private async executionSnapshot(
    tenant: AuthorizedProjectTenant,
    actorId: string
  ): Promise<{
    readonly project: InternalRankEstimateProjectSnapshot;
    readonly access: AutomationExecutionAccessSnapshot;
    readonly billingCurrency: string;
    readonly entitlement: Awaited<
      ReturnType<BillingEntitlementService["automationCapacity"]>
    >;
    readonly jobCapacity: Awaited<
      ReturnType<BillingEntitlementService["jobCapacity"]>
    >;
  }> {
    const membershipId = tenant.membershipId;
    const membershipVersion = tenant.membershipVersion;
    if (
      !membershipId ||
      !Number.isSafeInteger(membershipVersion) ||
      Number(membershipVersion) < 1
    ) {
      throw tenantChanged();
    }
    const [
      workspace,
      project,
      entitlementStatus,
      entitlement,
      jobCapacity
    ] =
      await Promise.all([
        this.tenants.getWorkspace(actorId, tenant.workspaceId),
        this.tenants.getProject(tenant.projectId),
        this.billing.rankProviderAccess(tenant.workspaceId),
        this.billing.automationCapacity(tenant.workspaceId),
        this.billing.jobCapacity(tenant.workspaceId)
      ]);
    if (
      workspace.id !== tenant.workspaceId ||
      project.id !== tenant.projectId ||
      project.workspaceId !== tenant.workspaceId
    ) {
      throw tenantChanged();
    }
    return {
      project: {
        id: project.id,
        workspaceId: project.workspaceId,
        domain: project.domain,
        status: project.status,
        version: project.version
      },
      access: {
        workspaceStatus: workspace.status,
        membershipId,
        membershipVersion: Number(membershipVersion),
        canRunRanking: hasEffectiveProjectPermission(
          workspace.roleCode,
          tenant.projectAccessLevel,
          "ranking.run"
        ),
        entitlementStatus
      },
      billingCurrency: workspace.billingCurrency,
      entitlement,
      jobCapacity
    };
  }
}

function assertCanEnable(tenant: AuthorizedProjectTenant): void {
  if (
    hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "automation.enable"
    )
  ) {
    return;
  }
  throw new DomainError({
    statusCode: 403,
    code: "FORBIDDEN",
    message: "Automation enable permission is required"
  });
}

function automationAccess(
  tenant: AuthorizedProjectTenant
): RankTrackingAutomationSettings["access"] {
  const mutable =
    tenant.workspaceStatus === "ACTIVE" &&
    tenant.projectStatus !== "ARCHIVED";
  const canManage =
    mutable &&
    hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "automation.manage"
    );
  const canEnable =
    mutable &&
    hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "automation.enable"
    );
  return {
    canManage,
    canEnable,
    mutationRestriction:
      tenant.workspaceStatus !== "ACTIVE"
        ? "WORKSPACE_READ_ONLY"
        : tenant.projectStatus === "ARCHIVED"
          ? "PROJECT_ARCHIVED"
          : canManage || canEnable
            ? "NONE"
            : "MISSING_PERMISSION"
  };
}

function assertExecutableSnapshot(input: {
  readonly project: InternalRankEstimateProjectSnapshot;
  readonly access: AutomationExecutionAccessSnapshot;
}): void {
  if (
    input.project.status === "ACTIVE" &&
    input.access.workspaceStatus === "ACTIVE" &&
    input.access.canRunRanking &&
    input.access.entitlementStatus === "ALLOWED"
  ) {
    return;
  }
  throw new DomainError({
    statusCode:
      input.access.entitlementStatus === "ALLOWED" ? 409 : 402,
    code:
      input.access.entitlementStatus === "ALLOWED"
        ? "RESOURCE_STATE_CONFLICT"
        : "PAYMENT_REQUIRED",
    message:
      "The current project, access and plan state does not allow scheduling rank checks"
  });
}

function tenantChanged(): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "RESOURCE_STATE_CONFLICT",
    message: "Project tenant context changed; refresh and try again"
  });
}
