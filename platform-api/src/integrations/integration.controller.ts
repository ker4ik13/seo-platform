import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  IntegrationCredentialValidationSummary,
  IntegrationCredentialSummary,
  IntegrationProviderCatalogItem
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type {
  TenantAuthorization,
  TenantRequest
} from "../authorization/authorization.types.js";
import {
  apiResponse,
  collectionResponse
} from "../common/api-response.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import { assertUuid } from "../common/identifier.js";
import { requiredVersion } from "../common/version-precondition.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { RecentAuthenticationService } from "../identity/recent-authentication.service.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import {
  createIntegrationCredentialInput,
  updateIntegrationCredentialInput
} from "./integration-input.js";

@Controller("api/v1/workspaces/:workspaceId/integrations")
export class IntegrationController {
  public constructor(
    private readonly jobs: JobsClient,
    private readonly audit: AuditService,
    private readonly recentAuthentication: RecentAuthenticationService
  ) {}

  @Get("catalog")
  @RequirePermission("integration.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async catalog(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<IntegrationProviderCatalogItem>> {
    return collectionResponse(
      request,
      await this.jobs.integrationCatalog(
        internalContext(request, principal)
      )
    );
  }

  @Get("credentials")
  @RequirePermission("integration.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<IntegrationCredentialSummary>> {
    return collectionResponse(
      request,
      await this.jobs.listIntegrationCredentials(
        internalContext(request, principal)
      )
    );
  }

  @Post("credentials")
  @RequirePermission("integration.connect")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<IntegrationCredentialSummary>> {
    this.recentAuthentication.assert(principal);
    const context = requestContext(request);
    const tenant = requiredTenant(request);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    const input = createIntegrationCredentialInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      action: "integration.credential.connect_requested",
      resourceType: "integration_credential",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.createIntegrationCredential(
      {
        tenant,
        actorId: principal.userId,
        requestId: context.requestId
      },
      input,
      idempotencyKey
    );
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      action: "integration.credential.connected",
      resourceType: "integration_credential",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result, result.version);
  }

  @Patch("credentials/:credentialId")
  @RequirePermission("integration.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("credentialId") credentialId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<IntegrationCredentialSummary>> {
    this.recentAuthentication.assert(principal);
    const canonicalCredentialId = assertUuid(
      credentialId,
      "credentialId"
    );
    const context = requestContext(request);
    const tenant = requiredTenant(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    const input = updateIntegrationCredentialInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      action: "integration.credential.update_requested",
      resourceType: "integration_credential",
      resourceId: canonicalCredentialId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.jobs.updateIntegrationCredential(
      {
        tenant,
        actorId: principal.userId,
        requestId: context.requestId
      },
      canonicalCredentialId,
      input,
      version
    );
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      action: "integration.credential.updated",
      resourceType: "integration_credential",
      resourceId: canonicalCredentialId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result, result.version);
  }

  @Post("credentials/:credentialId/validations")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission("integration.test")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async createValidation(
    @Param("credentialId") credentialId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<IntegrationCredentialValidationSummary>> {
    this.recentAuthentication.assert(principal);
    const canonicalCredentialId = assertUuid(
      credentialId,
      "credentialId"
    );
    const context = requestContext(request);
    const tenant = requiredTenant(request);
    const idempotencyKey = requiredIdempotencyKey(
      headerValue(request, "idempotency-key")
    );
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      action: "integration.credential.validation_requested",
      resourceType: "integration_credential",
      resourceId: canonicalCredentialId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result =
      await this.jobs.createIntegrationCredentialValidation(
        {
          tenant,
          actorId: principal.userId,
          requestId: context.requestId
        },
        canonicalCredentialId,
        idempotencyKey
      );
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      action: "integration.credential.validation_queued",
      resourceType: "integration_credential_validation",
      resourceId: result.id,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, result);
  }

  @Get("credentials/:credentialId/validations/:validationId")
  @RequirePermission("integration.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async getValidation(
    @Param("credentialId") credentialId: string,
    @Param("validationId") validationId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<IntegrationCredentialValidationSummary>> {
    const result =
      await this.jobs.getIntegrationCredentialValidation(
        internalContext(request, principal),
        assertUuid(credentialId, "credentialId"),
        assertUuid(validationId, "validationId")
      );
    return apiResponse(request, result);
  }

  @Delete("credentials/:credentialId")
  @RequirePermission("integration.delete")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async revoke(
    @Param("credentialId") credentialId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<{ readonly revoked: true }>> {
    this.recentAuthentication.assert(principal);
    const canonicalCredentialId = assertUuid(
      credentialId,
      "credentialId"
    );
    const context = requestContext(request);
    const tenant = requiredTenant(request);
    const version = requiredVersion(headerValue(request, "if-match"));
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      action: "integration.credential.revoke_requested",
      resourceType: "integration_credential",
      resourceId: canonicalCredentialId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    await this.jobs.revokeIntegrationCredential(
      {
        tenant,
        actorId: principal.userId,
        requestId: context.requestId
      },
      canonicalCredentialId,
      version
    );
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      action: "integration.credential.revoked",
      resourceType: "integration_credential",
      resourceId: canonicalCredentialId,
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    return apiResponse(request, { revoked: true });
  }
}

function internalContext(
  request: TenantRequest,
  principal: AuthenticatedPrincipal
): {
  readonly tenant: TenantAuthorization;
  readonly actorId: string;
  readonly requestId: string;
} {
  return {
    tenant: requiredTenant(request),
    actorId: principal.userId,
    requestId: requestContext(request).requestId
  };
}

function requiredTenant(request: TenantRequest): TenantAuthorization {
  const tenant = request.tenantAuthorization;
  if (!tenant || tenant.projectId) {
    throw new Error("Workspace authorization is missing");
  }
  return tenant;
}
