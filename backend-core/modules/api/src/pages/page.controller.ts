import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
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
  ApiResponse,
  ProjectPageAccess,
  ProjectPageSettings,
  ProjectPageSummary
} from "@seo-platform/contracts";
import { parseProjectPageStatisticsQuery, parseProjectPagePanelQuery, type ProjectPageStatisticsCollection, type ProjectPagePanel } from "@seo-platform/contracts";
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
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import {
  createProjectPageInput,
  projectPageQuery,
  updateProjectPageInput
} from "./page-input.js";

@Controller("api/v1/projects/:projectId/pages")
export class PageController {
  private readonly logger = new Logger(PageController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Get("rank-statistics")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async statistics(@Query() query: unknown, @Req() request: TenantRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<ApiResponse<ProjectPageStatisticsCollection>> {
    const tenant = requiredProjectTenant(request);
    assertRelatedRead(request, "positions:read");
    return apiResponse(request, await this.seoData.projectPageStatistics(internalProjectContext(request, principal, tenant), readInput(parseProjectPageStatisticsQuery, query)));
  }

  @Get("by-keyword/:keywordId")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async targetPage(@Param("keywordId") keywordId: string, @Req() request: TenantRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<ApiResponse<{ page?: ProjectPageSummary }>> {
    const tenant = requiredProjectTenant(request);
    assertRelatedRead(request, "semantics:read");
    return apiResponse(request, await this.seoData.projectKeywordTargetPage(internalProjectContext(request, principal, tenant), assertUuid(keywordId, "keywordId")));
  }

  @Get(":pageId/panel")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async panel(@Param("pageId") pageId: string, @Query() query: unknown, @Req() request: TenantRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<ApiResponse<ProjectPagePanel>> {
    const tenant = requiredProjectTenant(request), input = readInput(parseProjectPagePanelQuery, query);
    if (input.section === "SEMANTICS") assertRelatedRead(request, "semantics:read");
    if (input.dimensionKey) assertRelatedRead(request, "positions:read");
    return apiResponse(request, await this.seoData.projectPagePanel(internalProjectContext(request, principal, tenant), assertUuid(pageId, "pageId"), input));
  }

  @Get()
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Query() query: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectPageSettings>> {
    const tenant = requiredProjectTenant(request);
    const input = projectPageQuery(query);
    if (input.dimensionKey) assertRelatedRead(request, "positions:read");
    const collection = await this.seoData.listProjectPages(
      internalProjectContext(request, principal, tenant),
      input
    );
    return apiResponse(request, {
      ...collection,
      access: pageAccess(tenant)
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("page.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectPageSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const input = createProjectPageInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "page.create_requested",
      resourceType: "page",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.createProjectPage(
      internalProjectContext(request, principal, tenant),
      input,
      idempotencyKey
    );
    await committedAudit(
      this.audit,
      this.logger,
      tenant,
      principal.userId,
      context.requestId,
      "page.created",
      result.id
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Get(":pageId")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("pageId") pageId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectPageSummary>> {
    const tenant = requiredProjectTenant(request);
    const canonicalPageId = assertUuid(pageId, "pageId");
    const result = await this.seoData.getProjectPage(
      internalProjectContext(request, principal, tenant),
      canonicalPageId
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Patch(":pageId")
  @RequirePermission("page.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("pageId") pageId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectPageSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalPageId = assertUuid(pageId, "pageId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = updateProjectPageInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "page.update_requested",
      resourceType: "page",
      resourceId: canonicalPageId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.updateProjectPage(
      internalProjectContext(request, principal, tenant),
      canonicalPageId,
      input,
      version
    );
    await committedAudit(
      this.audit,
      this.logger,
      tenant,
      principal.userId,
      context.requestId,
      "page.updated",
      canonicalPageId
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post(":pageId/archive")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("page.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public archive(
    @Param("pageId") pageId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectPageSummary>> {
    return this.changeStatus(
      "archive",
      pageId,
      request,
      reply,
      principal
    );
  }

  @Post(":pageId/restore")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("page.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public restore(
    @Param("pageId") pageId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectPageSummary>> {
    return this.changeStatus(
      "restore",
      pageId,
      request,
      reply,
      principal
    );
  }

  private async changeStatus(
    operation: "archive" | "restore",
    pageId: string,
    request: TenantRequest,
    reply: FastifyReply,
    principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectPageSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalPageId = assertUuid(pageId, "pageId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: `page.${operation}_requested`,
      resourceType: "page",
      resourceId: canonicalPageId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.changeProjectPageStatus(
      internalProjectContext(request, principal, tenant),
      canonicalPageId,
      operation,
      version
    );
    await committedAudit(
      this.audit,
      this.logger,
      tenant,
      principal.userId,
      context.requestId,
      operation === "archive" ? "page.archived" : "page.restored",
      canonicalPageId
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }
}

function pageAccess(tenant: AuthorizedProjectTenant): ProjectPageAccess {
  const mutationRestriction: ProjectPageAccess["mutationRestriction"] =
    tenant.workspaceStatus === "READ_ONLY"
      ? "WORKSPACE_READ_ONLY"
      : !hasEffectiveProjectPermission(
            tenant.roleCode,
            tenant.projectAccessLevel,
            "page.manage"
          )
        ? "MISSING_PERMISSION"
        : tenant.projectStatus === "ARCHIVED"
          ? "PROJECT_ARCHIVED"
          : "NONE";
  return {
    canManage: mutationRestriction === "NONE",
    canViewKeywords: hasEffectiveProjectPermission(tenant.roleCode, tenant.projectAccessLevel, "semantic.view"),
    mutationRestriction
  };
}

function assertRelatedRead(request: TenantRequest, scope: "semantics:read" | "positions:read") {
  const tenant = requiredProjectTenant(request);
  if (!hasEffectiveProjectPermission(tenant.roleCode, tenant.projectAccessLevel, "semantic.view") || request.apiTokenAuthorization && !request.apiTokenAuthorization.scopes.includes(scope)) throw new ForbiddenException("Недостаточно прав для просмотра связанных данных");
}
function readInput<T>(parse: (value: unknown) => T, value: unknown): T {
  try { return parse(value); } catch { throw new BadRequestException("Некорректные параметры страницы"); }
}

function committedAudit(
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
    resourceType: "page",
    resourceId,
    outcome: "SUCCESS",
    requestId
  });
}
