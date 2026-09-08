import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ProviderBalanceService } from "../billing/provider-balance.service.js";
import { apiResponse } from "../common/api-response.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { RequirePlatformRole } from "./platform-role.js";
import { PlatformRoleGuard, type PlatformAdminRequest } from "./platform-role.guard.js";
@Controller("admin-api/v1/provider-accounts")
@RequirePlatformRole("FINANCE", "OPERATIONS")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformProviderController {
  public constructor(private readonly providers: ProviderBalanceService) {}
  @Get() public async list(@Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) { return apiResponse(request, await this.providers.accounts(principal.userId, request.id)); }
}
