import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  ApiTokenCollection,
  ApiTokenSummary,
  IssuedApiToken
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
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
import {
  assertEmptyApiTokenActionInput,
  createApiTokenInput,
  updateApiTokenInput
} from "./api-token-input.js";
import { ApiTokenService } from "./api-token.service.js";

@Controller("api/v1/workspaces/:workspaceId/api-tokens")
export class ApiTokenController {
  public constructor(private readonly apiTokens: ApiTokenService) {}

  @Get()
  @RequirePermission("workspace.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Param("workspaceId") workspaceId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ApiTokenCollection>> {
    return apiResponse(
      request,
      await this.apiTokens.list(
        assertUuid(workspaceId, "workspaceId"),
        principal.userId
      )
    );
  }

  @Post()
  @RequirePermission("workspace.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<IssuedApiToken>> {
    const result = await this.apiTokens.create(
      assertUuid(workspaceId, "workspaceId"),
      principal.userId,
      createApiTokenInput(body),
      requestContext(request)
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Patch(":apiTokenId")
  @RequirePermission("workspace.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("workspaceId") workspaceId: string,
    @Param("apiTokenId") apiTokenId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ApiTokenSummary>> {
    const result = await this.apiTokens.update(
      assertUuid(workspaceId, "workspaceId"),
      principal.userId,
      assertUuid(apiTokenId, "apiTokenId"),
      requiredVersion(headerValue(request, "if-match")),
      updateApiTokenInput(body),
      requestContext(request)
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post(":apiTokenId/rotate")
  @RequirePermission("workspace.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async rotate(
    @Param("workspaceId") workspaceId: string,
    @Param("apiTokenId") apiTokenId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<IssuedApiToken>> {
    assertEmptyApiTokenActionInput(body);
    const result = await this.apiTokens.rotate(
      assertUuid(workspaceId, "workspaceId"),
      principal.userId,
      assertUuid(apiTokenId, "apiTokenId"),
      requiredVersion(headerValue(request, "if-match")),
      requestContext(request)
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }

  @Post(":apiTokenId/revoke")
  @RequirePermission("workspace.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async revoke(
    @Param("workspaceId") workspaceId: string,
    @Param("apiTokenId") apiTokenId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ApiTokenSummary>> {
    assertEmptyApiTokenActionInput(body);
    const result = await this.apiTokens.revoke(
      assertUuid(workspaceId, "workspaceId"),
      principal.userId,
      assertUuid(apiTokenId, "apiTokenId"),
      requiredVersion(headerValue(request, "if-match")),
      requestContext(request)
    );
    setEntityVersion(reply, result.version);
    return apiResponse(request, result, result.version);
  }
}
