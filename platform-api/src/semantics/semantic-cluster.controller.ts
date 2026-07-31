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
  SemanticCluster,
  SemanticClusterPageBulkPreview,
  SemanticClusterPageBulkResult
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
  createSemanticClusterInput,
  semanticClusterPageBulkInput,
  updateSemanticClusterInput
} from "./semantic-cluster-input.js";

@Controller("api/v1/projects/:projectId/clusters")
export class SemanticClusterController {
  private readonly logger = new Logger(SemanticClusterController.name);

  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Get()
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly SemanticCluster[]>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listSemanticClusters(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticCluster>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = createSemanticClusterInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cluster.create_requested",
      resourceType: "semantic_cluster",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.createSemanticCluster(
      internalProjectContext(request, principal, tenant),
      input
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cluster.created",
      resourceType: "semantic_cluster",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post("page-mapping-preview")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.bulk_edit")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async previewPageMapping(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticClusterPageBulkPreview>> {
    const tenant = requiredMutableProjectTenant(request);
    const input = semanticClusterPageBulkInput(body);
    return apiResponse(
      request,
      await this.seoData.previewSemanticClusterPageMapping(
        internalProjectContext(request, principal, tenant),
        input
      )
    );
  }

  @Post("page-mapping-bulk")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.bulk_edit")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async bulkUpdatePageMapping(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticClusterPageBulkResult>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = semanticClusterPageBulkInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cluster_page_mapping.requested",
      resourceType: "semantic_cluster",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.bulkUpdateSemanticClusterPageMapping(
      internalProjectContext(request, principal, tenant),
      input
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cluster_page_mapping.completed",
      resourceType: "semantic_cluster",
      outcome: result.conflicted > 0 ? "PARTIAL" : "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }

  @Patch(":clusterId")
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("clusterId") clusterId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticCluster>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalClusterId = assertUuid(clusterId, "clusterId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = updateSemanticClusterInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cluster.update_requested",
      resourceType: "semantic_cluster",
      resourceId: canonicalClusterId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.seoData.updateSemanticCluster(
      internalProjectContext(request, principal, tenant),
      canonicalClusterId,
      input,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cluster.updated",
      resourceType: "semantic_cluster",
      resourceId: canonicalClusterId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Delete(":clusterId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission("semantic.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async delete(
    @Param("clusterId") clusterId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalClusterId = assertUuid(clusterId, "clusterId");
    const context = requestContext(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cluster.delete_requested",
      resourceType: "semantic_cluster",
      resourceId: canonicalClusterId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    await this.seoData.deleteSemanticCluster(
      internalProjectContext(request, principal, tenant),
      canonicalClusterId,
      version
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.cluster.deleted",
      resourceType: "semantic_cluster",
      resourceId: canonicalClusterId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
  }
}
