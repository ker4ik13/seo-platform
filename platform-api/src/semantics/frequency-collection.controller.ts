import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type { ApiResponse, FrequencyCollectionSummary } from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { apiResponse } from "../common/api-response.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { assertUuid } from "../common/identifier.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import {
  createFrequencyCollectionInput,
  frequencyCancelInput,
  frequencyIdempotencyKey
} from "./frequency-collection-input.js";

@Controller("api/v1/projects/:projectId/frequency-collections")
export class FrequencyCollectionController {
  private readonly logger = new Logger(FrequencyCollectionController.name);

  public constructor(
    private readonly jobs: JobsClient,
    private readonly billing: BillingEntitlementService,
    private readonly audit: AuditService
  ) {}

  @Get()
  @RequirePermission("collector.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<{ readonly collections: readonly FrequencyCollectionSummary[] }>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(request, {
      collections: await this.jobs.listFrequencyCollections(
        internalProjectContext(request, principal, tenant)
      )
    });
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission("collector.run")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<FrequencyCollectionSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const input = createFrequencyCollectionInput(body);
    const canonicalIdempotencyKey = frequencyIdempotencyKey(idempotencyKey);
    await this.billing.semanticCapacity(tenant.workspaceId);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.frequency_collection.create_requested",
      resourceType: "frequency_collection",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.createFrequencyCollection(
      internalProjectContext(request, principal, tenant),
      input,
      canonicalIdempotencyKey
    );
    await committed(
      this.audit,
      this.logger,
      principal,
      tenant,
      context.requestId,
      "semantic.frequency_collection.created",
      result.id
    );
    return apiResponse(request, result, result.version);
  }

  @Get(":jobId")
  @RequirePermission("collector.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("jobId") jobId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<FrequencyCollectionSummary>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.jobs.getFrequencyCollection(
        internalProjectContext(request, principal, tenant),
        assertUuid(jobId, "jobId")
      )
    );
  }

  @Post(":jobId/cancel")
  @RequirePermission("collector.cancel")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async cancel(
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<FrequencyCollectionSummary>> {
    const tenant = requiredProjectTenant(request);
    const context = requestContext(request);
    const canonicalJobId = assertUuid(jobId, "jobId");
    const version = frequencyCancelInput(body).version;
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.frequency_collection.cancel_requested",
      resourceType: "frequency_collection",
      resourceId: canonicalJobId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.cancelFrequencyCollection(
      internalProjectContext(request, principal, tenant),
      canonicalJobId,
      version
    );
    await committed(
      this.audit,
      this.logger,
      principal,
      tenant,
      context.requestId,
      "semantic.frequency_collection.cancelled",
      result.id
    );
    return apiResponse(request, result, result.version);
  }

  @Post(":jobId/retry-failed")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission("collector.run")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async retryFailed(
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<FrequencyCollectionSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const context = requestContext(request);
    const canonicalJobId = assertUuid(jobId, "jobId");
    const version = frequencyCancelInput(body).version;
    await this.billing.semanticCapacity(tenant.workspaceId);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.frequency_collection.retry_requested",
      resourceType: "frequency_collection",
      resourceId: canonicalJobId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.retryFailedFrequencyCollection(
      internalProjectContext(request, principal, tenant),
      canonicalJobId,
      version
    );
    await committed(
      this.audit,
      this.logger,
      principal,
      tenant,
      context.requestId,
      "semantic.frequency_collection.retry_started",
      result.id
    );
    return apiResponse(request, result, result.version);
  }
}

function committed(
  audit: AuditService,
  logger: Logger,
  principal: AuthenticatedPrincipal,
  tenant: ReturnType<typeof requiredProjectTenant>,
  requestId: string,
  action: string,
  resourceId: string
): Promise<void> {
  return recordCommittedAudit(audit, logger, {
    actorId: principal.userId,
    workspaceId: tenant.workspaceId,
    projectId: tenant.projectId,
    action,
    resourceType: "frequency_collection",
    resourceId,
    outcome: "SUCCESS",
    requestId
  });
}
