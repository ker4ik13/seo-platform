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
  CrawlAutomationRunCollection,
  CrawlAutomationRunSummary,
  CrawlAutomationSettings,
  CrawlAutomationSummary,
  InternalCreateCrawlAutomationInput,
  InternalCrawlAutomationStatusInput,
  InternalRunCrawlAutomationInput,
  InternalUpdateCrawlAutomationInput
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
import {
  assertEmptyCrawlAutomationInput,
  createCrawlAutomationInput,
  updateCrawlAutomationInput
} from "./crawl-automation.input.js";

@Controller("api/v1/projects/:projectId/crawl-automations")
export class CrawlAutomationController {
  private readonly logger = new Logger(CrawlAutomationController.name);

  public constructor(
    private readonly jobs: JobsClient,
    private readonly billing: BillingEntitlementService,
    private readonly audit: AuditService
  ) {}

  @Get()
  @RequirePermission("automation.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CrawlAutomationSettings>> {
    const tenant = requiredProjectTenant(request);
    const entitlement = await this.billing.automationCapacityForRead(
      tenant.workspaceId
    );
    const collection = await this.jobs.listCrawlAutomations(
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
  ): Promise<ApiResponse<CrawlAutomationRunCollection>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.jobs.listCrawlAutomationRuns(
        internalProjectContext(request, principal, tenant),
        assertUuid(automationId, "automationId")
      )
    );
  }

  @Post()
  @RequirePermission("automation.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CrawlAutomationSummary>> {
    const input = createCrawlAutomationInput(body);
    const tenant = requiredMutableProjectTenant(request);
    if (input.enabled) assertCanExecute(tenant);
    const command: InternalCreateCrawlAutomationInput = {
      ...input,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      actorId: principal.userId,
      idempotencyKey: requiredIdempotencyKey(
        headerValue(request, "idempotency-key")
      ),
      entitlement: await this.billing.automationCapacity(
        tenant.workspaceId
      )
    };
    await this.requested(request, principal.userId, tenant, "create");
    const result = await this.jobs.createCrawlAutomation(
      internalProjectContext(request, principal, tenant),
      command
    );
    await this.committed(
      request,
      principal.userId,
      tenant,
      "created",
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
  ): Promise<ApiResponse<CrawlAutomationSummary>> {
    const input = updateCrawlAutomationInput(body);
    const tenant = requiredMutableProjectTenant(request);
    if (input.enabled) assertCanExecute(tenant);
    const command: InternalUpdateCrawlAutomationInput = {
      ...input,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      actorId: principal.userId,
      automationId: assertUuid(automationId, "automationId"),
      expectedVersion: requiredVersion(headerValue(request, "if-match")),
      entitlement: await this.billing.automationCapacity(
        tenant.workspaceId
      )
    };
    await this.requested(
      request,
      principal.userId,
      tenant,
      "update",
      command.automationId
    );
    const result = await this.jobs.updateCrawlAutomation(
      internalProjectContext(request, principal, tenant),
      command
    );
    await this.committed(
      request,
      principal.userId,
      tenant,
      "updated",
      result.id
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post(":automationId/pause")
  @HttpCode(200)
  @RequirePermission("automation.enable")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public pause(
    @Param("automationId") automationId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CrawlAutomationSummary>> {
    assertEmptyCrawlAutomationInput(body);
    return this.setStatus(
      automationId,
      "pause",
      request,
      reply,
      principal
    );
  }

  @Post(":automationId/resume")
  @HttpCode(200)
  @RequirePermission("automation.enable")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public resume(
    @Param("automationId") automationId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CrawlAutomationSummary>> {
    assertEmptyCrawlAutomationInput(body);
    return this.setStatus(
      automationId,
      "resume",
      request,
      reply,
      principal
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
  ): Promise<ApiResponse<CrawlAutomationRunSummary>> {
    assertEmptyCrawlAutomationInput(body);
    const tenant = requiredMutableProjectTenant(request);
    assertCanExecute(tenant);
    // Manual runs are paid execution too, even when the saved schedule is
    // paused. Do not rely on the entitlement snapshot from creation time.
    await this.billing.automationCapacity(tenant.workspaceId);
    const command: InternalRunCrawlAutomationInput = {
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      actorId: principal.userId,
      automationId: assertUuid(automationId, "automationId"),
      expectedVersion: requiredVersion(headerValue(request, "if-match")),
      idempotencyKey: requiredIdempotencyKey(
        headerValue(request, "idempotency-key")
      )
    };
    await this.requested(
      request,
      principal.userId,
      tenant,
      "run",
      command.automationId
    );
    const result = await this.jobs.runCrawlAutomation(
      internalProjectContext(request, principal, tenant),
      command
    );
    await this.committed(
      request,
      principal.userId,
      tenant,
      "run_created",
      result.id,
      "crawl_automation_run"
    );
    return apiResponse(request, result);
  }

  private async setStatus(
    automationId: string,
    action: "pause" | "resume",
    request: TenantRequest,
    reply: FastifyReply,
    principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CrawlAutomationSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    if (action === "resume") assertCanExecute(tenant);
    const command: InternalCrawlAutomationStatusInput = {
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      actorId: principal.userId,
      automationId: assertUuid(automationId, "automationId"),
      expectedVersion: requiredVersion(headerValue(request, "if-match")),
      entitlement: await this.billing.automationCapacity(
        tenant.workspaceId
      )
    };
    await this.requested(
      request,
      principal.userId,
      tenant,
      action,
      command.automationId
    );
    const result = await this.jobs.setCrawlAutomationStatus(
      internalProjectContext(request, principal, tenant),
      command,
      action
    );
    await this.committed(
      request,
      principal.userId,
      tenant,
      action === "pause" ? "paused" : "resumed",
      result.id
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  private requested(
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
      action: `crawl.automation.${action}_requested`,
      resourceType: "crawl_automation",
      ...(resourceId ? { resourceId } : {}),
      outcome: "REQUESTED",
      requestId: requestContext(request).requestId
    });
  }

  private committed(
    request: TenantRequest,
    actorId: string,
    tenant: AuthorizedProjectTenant,
    action: string,
    resourceId: string,
    resourceType = "crawl_automation"
  ): Promise<void> {
    return recordCommittedAudit(this.audit, this.logger, {
      actorId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: `crawl.automation.${action}`,
      resourceType,
      resourceId,
      outcome: "SUCCESS",
      requestId: requestContext(request).requestId
    });
  }
}

function assertCanExecute(tenant: AuthorizedProjectTenant): void {
  if (
    hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "automation.enable"
    ) &&
    hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "page.manage"
    )
  ) {
    return;
  }
  throw new DomainError({
    statusCode: 403,
    code: "FORBIDDEN",
    message: "Automation enable and page manage permissions are required"
  });
}

function automationAccess(
  tenant: AuthorizedProjectTenant
): CrawlAutomationSettings["access"] {
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
    ) &&
    hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "page.manage"
    );
  return {
    canManage,
    canEnable,
    mutationRestriction:
      tenant.projectStatus === "ARCHIVED"
        ? "PROJECT_ARCHIVED"
        : tenant.workspaceStatus !== "ACTIVE"
          ? "WORKSPACE_READ_ONLY"
          : canManage
            ? "NONE"
            : "MISSING_PERMISSION"
  };
}
