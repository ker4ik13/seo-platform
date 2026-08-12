import { Readable } from "node:stream";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
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
  SemanticExportCollection,
  SemanticExportDownload,
  SemanticExportJobSummary
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { RequirePermission } from "../authorization/require-permission.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  requiredMutableProjectTenant,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { assertUuid } from "../common/identifier.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
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
import { createSemanticExportInput } from "./semantic-export-input.js";

const EXPORT_DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

@Controller("api/v1/projects/:projectId/exports")
export class SemanticExportController {
  private readonly logger = new Logger(SemanticExportController.name);

  public constructor(
    private readonly jobs: JobsClient,
    private readonly billing: BillingEntitlementService,
    private readonly audit: AuditService
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission("semantic.export")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticExportJobSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = createSemanticExportInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.export.requested",
      resourceType: "semantic_export",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const created = await this.jobs.createSemanticExport(
      {
        tenant,
        actorId: principal.userId,
        requestId: context.requestId
      },
      input,
      requiredIdempotencyKey(headerValue(request, "idempotency-key")),
      await this.billing.jobCapacity(tenant.workspaceId)
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.export.queued",
      resourceType: "semantic_export",
      resourceId: created.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, created);
  }

  @Get()
  @RequirePermission("semantic.export")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticExportCollection>> {
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.jobs.listSemanticExports({
        tenant: requiredProjectTenant(request),
        actorId: principal.userId,
        requestId: context.requestId
      })
    );
  }

  @Get(":exportId")
  @RequirePermission("semantic.export")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("exportId") exportId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticExportJobSummary>> {
    assertUuid(exportId, "exportId");
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.jobs.getSemanticExport(
        {
          tenant: requiredProjectTenant(request),
          actorId: principal.userId,
          requestId: context.requestId
        },
        exportId
      )
    );
  }

  @Get(":exportId/download")
  @RequirePermission("semantic.export")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async download(
    @Param("exportId") exportId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticExportDownload>> {
    return apiResponse(
      request,
      await this.issueDownload(exportId, request, principal)
    );
  }

  @Get(":exportId/file")
  @RequirePermission("semantic.export")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async file(
    @Param("exportId") exportId: string,
    @Req() request: TenantRequest,
    @Res() reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const download = await this.issueDownload(exportId, request, principal);
    let artifact: Response;
    try {
      artifact = await fetch(download.url, {
        method: "GET",
        headers: { Accept: download.contentType },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(EXPORT_DOWNLOAD_TIMEOUT_MS)
      });
    } catch {
      throw exportArtifactUnavailable();
    }
    if (!artifact.ok || !artifact.body) {
      await artifact.body?.cancel().catch(() => undefined);
      throw exportArtifactUnavailable();
    }

    reply.header("Cache-Control", "private, no-store");
    reply.header(
      "Content-Disposition",
      attachmentDisposition(download.filename)
    );
    reply.header("Content-Length", download.sizeBytes);
    reply.header("Content-Type", download.contentType);
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.code(HttpStatus.OK);
    reply.send(Readable.fromWeb(artifact.body));
  }

  @Post(":exportId/cancel")
  @RequirePermission("semantic.export")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async cancel(
    @Param("exportId") exportId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticExportJobSummary>> {
    assertUuid(exportId, "exportId");
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const cancelled = await this.jobs.cancelSemanticExport(
      {
        tenant,
        actorId: principal.userId,
        requestId: context.requestId
      },
      exportId,
      requiredVersion(headerValue(request, "if-match"))
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.export.cancel_requested",
      resourceType: "semantic_export",
      resourceId: exportId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, cancelled);
  }

  private async issueDownload(
    exportId: string,
    request: TenantRequest,
    principal: AuthenticatedPrincipal
  ): Promise<SemanticExportDownload> {
    assertUuid(exportId, "exportId");
    const tenant = requiredProjectTenant(request);
    const context = requestContext(request);
    const download = await this.jobs.downloadSemanticExport(
      {
        tenant,
        actorId: principal.userId,
        requestId: context.requestId
      },
      exportId
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.export.download_url_issued",
      resourceType: "semantic_export",
      resourceId: exportId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return download;
  }
}

function attachmentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/gu,
    (character) =>
      `%${character.codePointAt(0)!.toString(16).toUpperCase()}`
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}

function exportArtifactUnavailable(): HttpException {
  return new HttpException(
    {
      code: "EXPORT_ARTIFACT_UNAVAILABLE",
      message: "Export artifact is unavailable"
    },
    HttpStatus.SERVICE_UNAVAILABLE
  );
}
