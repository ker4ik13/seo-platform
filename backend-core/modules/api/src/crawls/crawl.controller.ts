import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  ProjectCrawlAbsentPageCollection,
  ProjectCrawlDuplicateGroupCollection,
  ProjectCrawlPageChangeCollection,
  ProjectCrawlIssueCollection,
  TechnicalCrawlAccess,
  TechnicalCrawlSettings,
  TechnicalCrawlSummary,
  CrawlOperationResultPage
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
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
import { DomainError } from "../common/domain-error.js";
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
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { TenantService } from "../tenants/tenant.service.js";
import {
  assertTechnicalCrawlProjectDomain,
  assertEmptyCrawlCancelInput,
  createTechnicalCrawlInput
} from "./crawl-input.js";

@Controller("api/v1/projects/:projectId")
export class CrawlController {
  private readonly logger = new Logger(CrawlController.name);

  public constructor(
    private readonly jobs: JobsClient,
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService,
    private readonly billing: BillingEntitlementService,
    private readonly tenants: TenantService
  ) {}

  @Get("crawls")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TechnicalCrawlSettings>> {
    const tenant = requiredProjectTenant(request);
    const crawls = await this.jobs.listTechnicalCrawls(
      internalProjectContext(request, principal, tenant)
    );
    return apiResponse(request, { ...crawls, access: crawlAccess(tenant) });
  }

  @Get("crawl-issues")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async issues(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectCrawlIssueCollection>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listProjectCrawlIssues(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Get("crawl-changes")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async changes(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectCrawlPageChangeCollection>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listProjectCrawlPageChanges(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Get("crawls/:crawlId/duplicate-groups")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async duplicateGroups(
    @Param("crawlId") crawlId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectCrawlDuplicateGroupCollection>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listProjectCrawlDuplicateGroups(
        internalProjectContext(request, principal, tenant),
        assertUuid(crawlId, "crawlId")
      )
    );
  }

  @Get("crawls/:crawlId/absent-pages")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async absentPages(
    @Param("crawlId") crawlId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectCrawlAbsentPageCollection>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listProjectCrawlAbsentPages(
        internalProjectContext(request, principal, tenant),
        assertUuid(crawlId, "crawlId")
      )
    );
  }

  @Get("crawls/:crawlId")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("crawlId") crawlId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TechnicalCrawlSummary>> {
    const tenant = requiredProjectTenant(request);
    const crawl = await this.jobs.getTechnicalCrawl(
      internalProjectContext(request, principal, tenant),
      assertUuid(crawlId, "crawlId")
    );
    setEntityVersion(reply, crawl.version);
    return apiResponse(request, crawl, crawl.version);
  }

  @Get("crawls/:crawlId/result")
  @RequirePermission("page.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async result(
    @Param("crawlId") crawlId: string,
    @Query("limit") limitValue: unknown,
    @Query("cursor") cursorValue: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CrawlOperationResultPage>> {
    const tenant = requiredProjectTenant(request);
    const context = internalProjectContext(request, principal, tenant);
    const canonicalCrawlId = assertUuid(crawlId, "crawlId");
    const limit = crawlResultLimit(limitValue);
    const cursor = crawlResultCursor(cursorValue);
    const [crawl, result] = await Promise.all([
      this.jobs.getTechnicalCrawl(context, canonicalCrawlId),
      this.seoData.crawlOperationResult(
        context,
        canonicalCrawlId,
        limit,
        cursor
      )
    ]);
    const { workspaceId: _workspaceId, projectId: _projectId, ...safe } = result;
    return apiResponse(request, { ...safe, crawl });
  }

  @Post("crawls")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission("page.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TechnicalCrawlSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const input = createTechnicalCrawlInput(body);
    const project = await this.tenants.getProject(tenant.projectId);
    if (
      project.id !== tenant.projectId ||
      project.workspaceId !== tenant.workspaceId
    ) {
      throw new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "Project ownership changed while starting the crawl"
      });
    }
    assertTechnicalCrawlProjectDomain(input, project.domain);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "crawl.create_requested",
      resourceType: "technical_crawl",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const crawl = await this.jobs.createTechnicalCrawl(
      internalProjectContext(request, principal, tenant),
      input,
      idempotencyKey,
      await this.billing.jobCapacity(tenant.workspaceId)
    );
    await committed(
      this.audit,
      this.logger,
      tenant,
      principal.userId,
      context.requestId,
      "crawl.created",
      crawl.id
    );
    reply.header(
      "Location",
      `/api/v1/projects/${encodeURIComponent(
        tenant.projectId
      )}/crawls/${encodeURIComponent(crawl.id)}`
    );
    setEntityVersion(reply, crawl.version);
    return apiResponse(request, crawl, crawl.version);
  }

  @Post("crawls/:crawlId/cancel")
  @RequirePermission("page.manage")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async cancel(
    @Param("crawlId") crawlId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TechnicalCrawlSummary>> {
    assertEmptyCrawlCancelInput(body);
    const tenant = requiredMutableProjectTenant(request);
    const id = assertUuid(crawlId, "crawlId");
    const version = requiredVersion(headerValue(request, "if-match"));
    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "crawl.cancel_requested",
      resourceType: "technical_crawl",
      resourceId: id,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const crawl = await this.jobs.cancelTechnicalCrawl(
      internalProjectContext(request, principal, tenant),
      id,
      version
    );
    await committed(
      this.audit,
      this.logger,
      tenant,
      principal.userId,
      context.requestId,
      "crawl.cancelled",
      id
    );
    setEntityVersion(reply, crawl.version);
    return apiResponse(request, crawl, crawl.version);
  }
}

function crawlResultLimit(value: unknown): number {
  if (value === undefined) return 1_000;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new DomainError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Invalid crawl result limit"
    });
  }
  return parsed;
}

function crawlResultCursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,3})$/u.test(value)) {
    throw new DomainError({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Invalid crawl result cursor"
    });
  }
  return value;
}

function crawlAccess(tenant: AuthorizedProjectTenant): TechnicalCrawlAccess {
  const mutationRestriction: TechnicalCrawlAccess["mutationRestriction"] =
    tenant.workspaceStatus === "READ_ONLY"
      ? "WORKSPACE_READ_ONLY"
      : tenant.projectStatus === "ARCHIVED"
        ? "PROJECT_ARCHIVED"
        : !hasEffectiveProjectPermission(
              tenant.roleCode,
              tenant.projectAccessLevel,
              "page.manage"
            )
          ? "MISSING_PERMISSION"
          : "NONE";
  return {
    canRun: mutationRestriction === "NONE",
    mutationRestriction
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
    resourceType: "technical_crawl",
    resourceId,
    outcome: "SUCCESS",
    requestId
  });
}
