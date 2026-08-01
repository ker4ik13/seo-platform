import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticKeywordBulkResult,
  SemanticKeywordCleaningPreview,
  SemanticKeywordCleaningResult
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant
} from "../authorization/project-tenant.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import {
  semanticKeywordBulkInput,
  semanticKeywordCleaningInput
} from "./keyword-input.js";

@Controller("api/v1/projects/:projectId/bulk-commands")
export class SemanticBulkController {
  private readonly logger = new Logger(SemanticBulkController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.bulk_edit")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async execute(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordBulkResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = semanticKeywordBulkInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.bulk_update.requested",
      resourceType: "semantic_keyword",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.bulkUpdateKeywords(
      internalProjectContext(request, principal, tenant),
      input
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.bulk_update.completed",
      resourceType: "semantic_keyword",
      outcome: result.failed > 0 ? "PARTIAL" : "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }

  @Post("clean-preview")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.bulk_edit")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async previewCleaning(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordCleaningPreview>> {
    const tenant = requiredMutableProjectTenant(request);
    const input = semanticKeywordCleaningInput(body);
    return apiResponse(
      request,
      await this.seoData.previewSemanticKeywordCleaning(
        internalProjectContext(request, principal, tenant),
        input
      )
    );
  }

  @Post("clean")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.bulk_edit")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async clean(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticKeywordCleaningResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = semanticKeywordCleaningInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cleaning.requested",
      resourceType: "semantic_keyword",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.cleanSemanticKeywords(
      internalProjectContext(request, principal, tenant),
      input
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cleaning.completed",
      resourceType: "semantic_keyword",
      outcome:
        result.failed > 0 || result.conflicted > 0 ? "PARTIAL" : "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }
}
