import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import type {
  AdminOperationSearchResult,
  AdminProjectSearchResult,
  ApiResponse
} from "@seo-platform/contracts";
import { apiResponse } from "../common/api-response.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import {
  adminOperationQuery,
  adminProjectQuery
} from "./platform-admin-read-input.js";
import { PlatformAdminReadService } from "./platform-admin-read.service.js";
import { RequirePlatformRole } from "./platform-role.js";
import {
  PlatformRoleGuard,
  type PlatformAdminRequest
} from "./platform-role.guard.js";

@Controller("admin-api/v1/projects")
@RequirePlatformRole("SUPPORT", "OPERATIONS")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformAdminProjectController {
  public constructor(private readonly admin: PlatformAdminReadService) {}

  @Get()
  public async list(
    @Query("q") q: unknown,
    @Query("status") status: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<AdminProjectSearchResult>> {
    return apiResponse(
      request,
      await this.admin.projects(
        adminProjectQuery({ q, status }),
        principal.userId,
        request.id
      )
    );
  }
}

@Controller("admin-api/v1/operations")
@RequirePlatformRole("SUPPORT", "OPERATIONS")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformAdminOperationController {
  public constructor(private readonly admin: PlatformAdminReadService) {}

  @Get()
  public async list(
    @Query("status") status: unknown,
    @Query("type") type: unknown,
    @Query("cursor") cursor: unknown,
    @Query("limit") limit: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<AdminOperationSearchResult>> {
    return apiResponse(
      request,
      await this.admin.operations(
        adminOperationQuery({ status, type, cursor, limit }),
        principal.userId,
        request.id
      )
    );
  }
}
