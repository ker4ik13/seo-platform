import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
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
  ProjectConnectorBinding,
  ProjectConnectorSettings,
  ProjectConnectorSettingsAccess,
  ProjectConnectorSettingsMutationRestriction
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import {
  type TenantRequest
} from "../authorization/authorization.types.js";
import { hasEffectiveProjectPermission, hasSystemPermission } from "../authorization/permissions.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant,
  type AuthorizedProjectTenant
} from "../authorization/project-tenant.js";
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
import { JobsClient } from "../jobs/jobs.client.js";
import {
  createProjectConnectorBindingInput,
  updateProjectConnectorBindingInput
} from "./project-integration-input.js";

@Controller("api/v1/projects/:projectId/integration-settings")
export class ProjectIntegrationController {
  private readonly logger = new Logger(
    ProjectIntegrationController.name
  );

  public constructor(
    private readonly jobs: JobsClient,
    private readonly audit: AuditService
  ) {}

  @Get()
  @RequirePermission("integration.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectConnectorSettings>> {
    const tenant = requiredProjectTenant(request);
    const aggregate = await this.jobs.projectConnectorBindings(
      internalProjectContext(request, principal, tenant)
    );
    return apiResponse(request, {
      ...aggregate,
      access: projectConnectorSettingsAccess(tenant)
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("integration.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectConnectorBinding>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const input = createProjectConnectorBindingInput(body);
    assertCanUseWorkspaceCredentials(tenant);
    assertCanManageFallback(tenant, input);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action:
        "integration.project_connector_binding.create_requested",
      resourceType: "project_connector_binding",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.createProjectConnectorBinding(
      internalProjectContext(request, principal, tenant),
      input,
      idempotencyKey
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "integration.project_connector_binding.created",
      resourceType: "project_connector_binding",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post("prepare-system")
  @RequirePermission("integration.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async prepareSystem(@Req() request: TenantRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const tenant = requiredMutableProjectTenant(request);
    assertCanUseWorkspaceCredentials(tenant);
    if (!hasSystemPermission(tenant.roleCode, "integration.update")) throw new ForbiddenException("Workspace integration management is required");
    return apiResponse(request, await this.jobs.prepareSystemConnectors(internalProjectContext(request, principal, tenant)));
  }

  @Patch(":bindingId")
  @RequirePermission("integration.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("bindingId") bindingId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectConnectorBinding>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalBindingId = assertUuid(bindingId, "bindingId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = updateProjectConnectorBindingInput(body);
    assertCanUseWorkspaceCredentials(tenant);
    assertCanManageFallback(tenant, input);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action:
        "integration.project_connector_binding.update_requested",
      resourceType: "project_connector_binding",
      resourceId: canonicalBindingId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.updateProjectConnectorBinding(
      internalProjectContext(request, principal, tenant),
      canonicalBindingId,
      input,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "integration.project_connector_binding.updated",
      resourceType: "project_connector_binding",
      resourceId: canonicalBindingId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post(":bindingId/inherit")
  @RequirePermission("integration.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async inheritWorkspaceRoute(
    @Param("bindingId") bindingId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectConnectorBinding>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalBindingId = assertUuid(bindingId, "bindingId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    assertCanUseWorkspaceCredentials(tenant);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "integration.project_connector_binding.inherit_requested",
      resourceType: "project_connector_binding",
      resourceId: canonicalBindingId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.inheritProjectConnectorBinding(
      internalProjectContext(request, principal, tenant),
      canonicalBindingId,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "integration.project_connector_binding.inherited",
      resourceType: "project_connector_binding",
      resourceId: canonicalBindingId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }
}

function assertCanUseWorkspaceCredentials(
  tenant: AuthorizedProjectTenant
): void {
  if (
    !hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "integration.use_system_credentials"
    )
  ) {
    throw new ForbiddenException({
      code: "FORBIDDEN",
      message:
        "Workspace credentials require integration.use_system_credentials"
    });
  }
}

function assertCanManageFallback(
  tenant: AuthorizedProjectTenant,
  input: {
    readonly fallbackRoutes?: readonly unknown[];
    readonly fallbackPolicy: { readonly mode: string };
  }
): void {
  if (
    (input.fallbackRoutes?.length ?? 0) === 0 &&
    input.fallbackPolicy.mode === "NONE"
  ) {
    return;
  }
  if (
    !hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "integration.manage_fallback"
    )
  ) {
    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "Fallback routing requires integration.manage_fallback"
    });
  }
}

function projectConnectorSettingsAccess(
  tenant: AuthorizedProjectTenant
): ProjectConnectorSettingsAccess {
  const restriction = mutationRestriction(tenant);
  const canUpdateBindings = restriction === "NONE";
  return {
    canUpdateBindings,
    canUseSystemCredentials:
      canUpdateBindings &&
      hasEffectiveProjectPermission(
        tenant.roleCode,
        tenant.projectAccessLevel,
        "integration.use_system_credentials"
      ),
    canManageFallback:
      canUpdateBindings &&
      hasEffectiveProjectPermission(
        tenant.roleCode,
        tenant.projectAccessLevel,
        "integration.manage_fallback"
      ),
    canSetBudgets:
      canUpdateBindings &&
      hasEffectiveProjectPermission(
        tenant.roleCode,
        tenant.projectAccessLevel,
        "billing.set_budgets"
      ),
    mutationRestriction: restriction
  };
}

function mutationRestriction(
  tenant: AuthorizedProjectTenant
): ProjectConnectorSettingsMutationRestriction {
  if (tenant.workspaceStatus === "READ_ONLY") {
    return "WORKSPACE_READ_ONLY";
  }
  if (
    !hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "integration.update"
    )
  ) {
    return "MISSING_PERMISSION";
  }
  if (tenant.projectStatus === "ARCHIVED") {
    return "PROJECT_ARCHIVED";
  }
  return "NONE";
}
