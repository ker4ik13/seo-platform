import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticImportSummary
} from "@seo-platform/contracts";
import { RequirePermission } from "../authorization/require-permission.js";
import type {
  TenantAuthorization,
  TenantRequest
} from "../authorization/authorization.types.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { assertUuid } from "../common/identifier.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { createSemanticImportInput } from "./semantic-import-input.js";

@Controller("api/v1/projects/:projectId/imports")
export class SemanticImportController {
  public constructor(private readonly jobs: JobsClient) {}

  @Post()
  @RequirePermission("semantic.import")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticImportSummary>> {
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.jobs.createSemanticImport(
        {
          tenant: requiredTenant(request),
          actorId: principal.userId,
          requestId: context.requestId
        },
        createSemanticImportInput(body),
        requiredIdempotencyKey(
          headerValue(request, "idempotency-key")
        )
      )
    );
  }

  @Get(":importId")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("importId") importId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<SemanticImportSummary>> {
    assertUuid(importId, "importId");
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.jobs.getSemanticImport(
        {
          tenant: requiredTenant(request),
          actorId: principal.userId,
          requestId: context.requestId
        },
        importId
      )
    );
  }
}

function requiredTenant(request: TenantRequest): TenantAuthorization {
  const tenant = request.tenantAuthorization;
  if (!tenant?.projectId) {
    throw new Error("Project authorization is missing");
  }
  return tenant;
}
