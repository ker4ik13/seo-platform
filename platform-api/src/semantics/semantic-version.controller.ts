import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticVersionListItem,
  SemanticVersionUndoPreview,
  SemanticVersionUndoResult
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { RequirePermission } from "../authorization/require-permission.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { assertUuid } from "../common/identifier.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard,
  headerValue
} from "../identity/session-auth.guard.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { semanticVersionUndoInput } from "./semantic-version-input.js";

@Controller("api/v1/projects/:projectId/semantic-versions")
export class SemanticVersionController {
  private readonly logger = new Logger(SemanticVersionController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService,
    private readonly billingEntitlements: BillingEntitlementService
  ) {}

  @Get()
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly SemanticVersionListItem[]>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listSemanticVersions(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Get(":versionId/undo-preview")
  @RequirePermission("semantic.restore_version")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async previewUndo(
    @Param("versionId") versionId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticVersionUndoPreview>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.previewSemanticVersionUndo(
        internalProjectContext(request, principal, tenant),
        assertUuid(versionId, "versionId")
      )
    );
  }

  @Post(":versionId/undo")
  @RequirePermission("semantic.restore_version")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async undo(
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticVersionUndoResult>> {
    semanticVersionUndoInput(body);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const tenant = requiredMutableProjectTenant(request);
    const canonicalVersionId = assertUuid(versionId, "versionId");
    const context = requestContext(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.version.undo_requested",
      resourceType: "semantic_version",
      resourceId: canonicalVersionId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.undoSemanticVersion(
      internalProjectContext(request, principal, tenant),
      canonicalVersionId,
      idempotencyKey,
      await this.billingEntitlements.semanticCapacity(
        tenant.workspaceId
      )
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.version.undo_completed",
      resourceType: "semantic_version",
      resourceId: canonicalVersionId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }
}
