import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticDuplicateApplyResult,
  SemanticDuplicatePreview
} from "@seo-platform/contracts";
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
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard
} from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import {
  applySemanticDuplicatesInput,
  semanticDuplicateCommandInput
} from "./semantic-duplicate-input.js";

@Controller("api/v1/projects/:projectId/semantic-duplicates")
export class SemanticDuplicateController {
  private readonly logger = new Logger(SemanticDuplicateController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Post("preview")
  @RequirePermission("semantic.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async preview(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticDuplicatePreview>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.previewSemanticDuplicates(
        internalProjectContext(request, principal, tenant),
        semanticDuplicateCommandInput(body)
      )
    );
  }

  @Post("apply")
  @RequirePermission("semantic.delete")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async apply(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticDuplicateApplyResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = applySemanticDuplicatesInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.implicit_duplicates.apply_requested",
      resourceType: "semantic_keyword",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.applySemanticDuplicates(
      internalProjectContext(request, principal, tenant),
      input
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.implicit_duplicates.applied",
      resourceType: "semantic_keyword",
      outcome: "SUCCESS",
      requestId: context.requestId,
      redactedChanges: { deletedCount: result.deletedCount }
    });
    return apiResponse(request, result);
  }
}
