import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ProviderBalanceService } from "../billing/provider-balance.service.js";
import { apiResponse } from "../common/api-response.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard, SessionAuthGuard } from "../identity/session-auth.guard.js";
import { assertUuid } from "../common/identifier.js";
import { RequirePlatformRole } from "./platform-role.js";
import { PlatformRoleGuard, type PlatformAdminRequest } from "./platform-role.guard.js";
@Controller("admin-api/v1/provider-accounts")
@RequirePlatformRole("FINANCE", "OPERATIONS")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformProviderController {
  public constructor(private readonly providers: ProviderBalanceService) {}
  @Get() public async list(@Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) { return apiResponse(request, await this.providers.accounts(principal.userId, request.id)); }
  @Post("refresh") @RequirePlatformRole("OPERATIONS") @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async refresh(@Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) { return apiResponse(request, { requested: await this.providers.refresh(principal.userId, request.id) }); }
  @Post(":accountId/enabled") @RequirePlatformRole("OPERATIONS") @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async setEnabled(@Param("accountId") accountId: string, @Body() body: unknown, @Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return apiResponse(request, await this.providers.setEnabled(assertUuid(accountId, "accountId"), enabledInput(body), principal.userId, request.id));
  }
}

function enabledInput(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Invalid provider account command");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.enabled !== "boolean") throw new BadRequestException("Invalid provider account command");
  return input.enabled;
}
