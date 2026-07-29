import {
  Body,
  Controller,
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
  type TenantAuthorization,
  type TenantRequest
} from "../authorization/authorization.types.js";
import { hasEffectiveProjectPermission } from "../authorization/permissions.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { DomainError } from "../common/domain-error.js";
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
      internalContext(request, principal, tenant)
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
      internalContext(request, principal, tenant),
      input,
      idempotencyKey
    );
    await this.recordSuccessfulMutation({
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
      internalContext(request, principal, tenant),
      canonicalBindingId,
      input,
      version
    );
    await this.recordSuccessfulMutation({
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

  private async recordSuccessfulMutation(
    input: Parameters<AuditService["record"]>[0]
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch {
      // The Jobs service has already committed the mutation and its
      // transactional outbox event. Returning an error here would make a
      // successful CAS update look failed and an exact retry impossible.
      this.logger.error(
        `Unable to persist success audit event action=${input.action} requestId=${input.requestId}`
      );
    }
  }
}

function projectConnectorSettingsAccess(
  tenant: TenantAuthorization & {
    readonly projectId: string;
    readonly projectStatus: NonNullable<
      TenantAuthorization["projectStatus"]
    >;
  }
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
  tenant: TenantAuthorization & {
    readonly projectStatus: NonNullable<
      TenantAuthorization["projectStatus"]
    >;
  }
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

function internalContext(
  request: TenantRequest,
  principal: AuthenticatedPrincipal,
  tenant: TenantAuthorization
): {
  readonly tenant: TenantAuthorization;
  readonly actorId: string;
  readonly requestId: string;
} {
  return {
    tenant,
    actorId: principal.userId,
    requestId: requestContext(request).requestId
  };
}

function requiredProjectTenant(
  request: TenantRequest
): TenantAuthorization & {
  readonly projectId: string;
  readonly projectStatus: NonNullable<
    TenantAuthorization["projectStatus"]
  >;
} {
  const tenant = request.tenantAuthorization;
  if (!tenant?.projectId || !tenant.projectStatus) {
    throw new Error("Project authorization is missing");
  }
  return tenant as TenantAuthorization & {
    readonly projectId: string;
    readonly projectStatus: NonNullable<
      TenantAuthorization["projectStatus"]
    >;
  };
}

function requiredMutableProjectTenant(
  request: TenantRequest
): ReturnType<typeof requiredProjectTenant> {
  const tenant = requiredProjectTenant(request);
  if (tenant.projectStatus === "ARCHIVED") {
    throw new DomainError({
      statusCode: 409,
      code: "RESOURCE_STATE_CONFLICT",
      message: "Archived projects cannot be changed",
      details: { projectStatus: tenant.projectStatus }
    });
  }
  return tenant;
}

function setEntityVersion(reply: FastifyReply, version: number): void {
  reply.header("ETag", `"v${version}"`);
}
