import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  CreatedMultipartUpload,
  UploadPartUrls,
  UploadSummary
} from "@seo-platform/contracts";
import { apiResponse } from "../common/api-response.js";
import { assertUuid } from "../common/identifier.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type {
  TenantAuthorization,
  TenantRequest
} from "../authorization/authorization.types.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { JobsUploadClient } from "./jobs-upload.client.js";
import {
  completeUploadInput,
  createUploadInput,
  createUploadPartUrlsInput,
  idempotencyKey
} from "./upload-input.js";

@Controller("api/v1/projects/:projectId/uploads")
export class UploadController {
  public constructor(private readonly uploads: JobsUploadClient) {}

  @Post()
  @RequirePermission("file.upload")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CreatedMultipartUpload>> {
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.uploads.create(
        {
          tenant: requiredTenant(request),
          actorId: principal.userId,
          requestId: context.requestId
        },
        createUploadInput(body),
        idempotencyKey(headerValue(request, "idempotency-key"))
      )
    );
  }

  @Post(":uploadId/parts")
  @RequirePermission("file.upload")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async partUrls(
    @Param("uploadId") uploadId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<UploadPartUrls>> {
    assertUuid(uploadId, "uploadId");
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.uploads.partUrls(
        {
          tenant: requiredTenant(request),
          actorId: principal.userId,
          requestId: context.requestId
        },
        uploadId,
        createUploadPartUrlsInput(body)
      )
    );
  }

  @Post(":uploadId/complete")
  @RequirePermission("file.upload")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async complete(
    @Param("uploadId") uploadId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<UploadSummary>> {
    assertUuid(uploadId, "uploadId");
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.uploads.complete(
        {
          tenant: requiredTenant(request),
          actorId: principal.userId,
          requestId: context.requestId
        },
        uploadId,
        completeUploadInput(body)
      )
    );
  }

  @Get(":uploadId")
  @RequirePermission("file.download")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("uploadId") uploadId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<UploadSummary>> {
    assertUuid(uploadId, "uploadId");
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.uploads.get(
        {
          tenant: requiredTenant(request),
          actorId: principal.userId,
          requestId: context.requestId
        },
        uploadId
      )
    );
  }

  @Delete(":uploadId")
  @RequirePermission("file.upload")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async abort(
    @Param("uploadId") uploadId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<UploadSummary>> {
    assertUuid(uploadId, "uploadId");
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.uploads.abort(
        {
          tenant: requiredTenant(request),
          actorId: principal.userId,
          requestId: context.requestId
        },
        uploadId
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
