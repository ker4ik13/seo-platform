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
  KeywordResearchAccess,
  KeywordResearchCollection,
  KeywordResearchRunSummary
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
  assertEmptyKeywordResearchCancelInput,
  confirmKeywordResearchRunInput,
  createKeywordResearchRunInput
} from "./keyword-research.input.js";

@Controller("api/v1/projects/:projectId/keyword-research-runs")
export class KeywordResearchController {
  private readonly logger = new Logger(KeywordResearchController.name);

  public constructor(
    private readonly jobs: JobsClient,
    private readonly billing: BillingEntitlementService,
    private readonly audit: AuditService
  ) {}

  @Get()
  @RequirePermission("competitor.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<KeywordResearchCollection>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(request, {
      runs: await this.jobs.listKeywordResearchRuns(
        internalProjectContext(request, principal, tenant)
      ),
      access: access(tenant)
    });
  }

  @Get(":runId")
  @RequirePermission("competitor.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("runId") runId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<KeywordResearchRunSummary>> {
    const tenant = requiredProjectTenant(request);
    const run = await this.jobs.getKeywordResearchRun(
      internalProjectContext(request, principal, tenant),
      assertUuid(runId, "runId")
    );
    setEntityVersion(reply, run.version);
    return apiResponse(request, run, run.version);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission("collector.run")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<KeywordResearchRunSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    await this.billing.semanticCapacity(tenant.workspaceId);
    const run = await this.jobs.createKeywordResearchRun(
      internalProjectContext(request, principal, tenant),
      createKeywordResearchRunInput(body),
      idempotencyKey
    );
    await committed(
      this.audit,
      this.logger,
      tenant,
      principal.userId,
      context.requestId,
      "keyword_research.created",
      run.id
    );
    setEntityVersion(reply, run.version);
    return apiResponse(request, run, run.version);
  }

  @Post(":runId/confirm")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission("competitor.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async confirm(
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<KeywordResearchRunSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const id = assertUuid(runId, "runId");
    const run = await this.jobs.confirmKeywordResearchRun(
      internalProjectContext(request, principal, tenant),
      id,
      confirmKeywordResearchRunInput(body),
      requiredVersion(headerValue(request, "if-match")),
      await this.billing.semanticCapacity(tenant.workspaceId)
    );
    await committed(
      this.audit,
      this.logger,
      tenant,
      principal.userId,
      requestContext(request).requestId,
      "keyword_research.import_confirmed",
      id
    );
    setEntityVersion(reply, run.version);
    return apiResponse(request, run, run.version);
  }

  @Post(":runId/cancel")
  @RequirePermission("collector.cancel")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async cancel(
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<KeywordResearchRunSummary>> {
    assertEmptyKeywordResearchCancelInput(body);
    const tenant = requiredProjectTenant(request);
    const id = assertUuid(runId, "runId");
    const run = await this.jobs.cancelKeywordResearchRun(
      internalProjectContext(request, principal, tenant),
      id,
      requiredVersion(headerValue(request, "if-match"))
    );
    setEntityVersion(reply, run.version);
    return apiResponse(request, run, run.version);
  }
}

function access(tenant: AuthorizedProjectTenant): KeywordResearchAccess {
  const lifecycle =
    tenant.workspaceStatus === "READ_ONLY"
      ? "WORKSPACE_READ_ONLY"
      : tenant.projectStatus === "ARCHIVED"
        ? "PROJECT_ARCHIVED"
        : "NONE";
  const canRun =
    lifecycle === "NONE" &&
    hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "collector.run"
    );
  const canImport =
    lifecycle === "NONE" &&
    hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "competitor.manage"
    );
  return {
    canRun,
    canImport,
    canCancel: hasEffectiveProjectPermission(
      tenant.roleCode,
      tenant.projectAccessLevel,
      "collector.cancel"
    ),
    mutationRestriction:
      lifecycle !== "NONE"
        ? lifecycle
        : canRun
          ? "NONE"
          : "MISSING_PERMISSION"
  };
}

function committed(
  audit: AuditService,
  logger: Logger,
  tenant: AuthorizedProjectTenant,
  actorId: string,
  requestId: string,
  action: string,
  resourceId: string
): Promise<void> {
  return recordCommittedAudit(audit, logger, {
    actorId,
    workspaceId: tenant.workspaceId,
    projectId: tenant.projectId,
    action,
    resourceType: "keyword_research_run",
    resourceId,
    outcome: "SUCCESS",
    requestId
  });
}
