import {
  Body,
  Controller,
  Delete,
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
  SemanticNegativeKeywordApplyResult,
  SemanticNegativeKeywordPreset,
  SemanticNegativeKeywordPreview
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { setEntityVersion } from "../common/entity-version.js";
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
  applyNegativeKeywordsInput,
  createNegativeKeywordPresetInput,
  negativeKeywordCommandInput,
  updateNegativeKeywordPresetInput
} from "./negative-keyword-input.js";

@Controller("api/v1/projects/:projectId")
export class NegativeKeywordController {
  private readonly logger = new Logger(NegativeKeywordController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Get("negative-keyword-presets")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly SemanticNegativeKeywordPreset[]>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listNegativeKeywordPresets(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Post("negative-keyword-presets")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticNegativeKeywordPreset>> {
    const tenant = requiredMutableProjectTenant(request);
    const result = await this.seoData.createNegativeKeywordPreset(
      internalProjectContext(request, principal, tenant),
      createNegativeKeywordPresetInput(body)
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Patch("negative-keyword-presets/:presetId")
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("presetId") presetId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticNegativeKeywordPreset>> {
    const tenant = requiredMutableProjectTenant(request);
    const result = await this.seoData.updateNegativeKeywordPreset(
      internalProjectContext(request, principal, tenant),
      assertUuid(presetId, "presetId"),
      updateNegativeKeywordPresetInput(body),
      requiredVersion(headerValue(request, "if-match"))
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Delete("negative-keyword-presets/:presetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async delete(
    @Param("presetId") presetId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    await this.seoData.deleteNegativeKeywordPreset(
      internalProjectContext(request, principal, tenant),
      assertUuid(presetId, "presetId"),
      requiredVersion(headerValue(request, "if-match"))
    );
  }

  @Post("negative-keywords/preview")
  @RequirePermission("semantic.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async preview(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticNegativeKeywordPreview>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.previewNegativeKeywords(
        internalProjectContext(request, principal, tenant),
        negativeKeywordCommandInput(body)
      )
    );
  }

  @Post("negative-keywords/apply")
  @RequirePermission("semantic.delete")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async apply(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticNegativeKeywordApplyResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = applyNegativeKeywordsInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.negative_keywords.apply_requested",
      resourceType: "semantic_keyword",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.applyNegativeKeywords(
      internalProjectContext(request, principal, tenant),
      input
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.negative_keywords.applied",
      resourceType: "semantic_keyword",
      outcome: "SUCCESS",
      requestId: context.requestId,
      redactedChanges: { deletedCount: result.deletedCount }
    });
    return apiResponse(request, result);
  }
}
