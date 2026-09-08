import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { apiResponse } from "../common/api-response.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { RequirePlatformRole } from "./platform-role.js";
import { PlatformRoleGuard, type PlatformAdminRequest } from "./platform-role.guard.js";
import { PlatformOverviewService } from "./platform-overview.service.js";
@Controller("admin-api/v1/overview")
@RequirePlatformRole("FINANCE", "OPERATIONS", "SUPPORT")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformOverviewController {
  public constructor(private readonly overviewService: PlatformOverviewService) {}
  @Get() public async overview(@Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const overview = await this.overviewService.overview(principal.userId, request.id);
    if (request.platformRoles?.some(role => role === "SUPER_ADMIN" || role === "FINANCE")) return apiResponse(request, overview);
    const { finance: _finance, ...operational } = overview;
    return apiResponse(request, operational);
  }
}
