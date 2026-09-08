import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { RefundRequestService } from "../billing/refund-request.service.js";
import { apiResponse } from "../common/api-response.js";
import { assertUuid } from "../common/identifier.js";
import { inputObject, stringField } from "../common/input.js";
import { requiredVersion } from "../common/version-precondition.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import { CsrfSessionGuard, SessionAuthGuard, headerValue } from "../identity/session-auth.guard.js";
import { RequirePlatformRole } from "./platform-role.js";
import { PlatformRoleGuard, type PlatformAdminRequest } from "./platform-role.guard.js";

@Controller("admin-api/v1/refund-requests")
export class PlatformRefundController {
  public constructor(private readonly refunds: RefundRequestService) {}
  @Get() @RequirePlatformRole("SUPPORT", "FINANCE") @UseGuards(SessionAuthGuard, PlatformRoleGuard)
  public async list(@Req() request: PlatformAdminRequest) { return apiResponse(request, await this.refunds.adminList()); }

  @Post(":id/decision") @RequirePlatformRole("FINANCE") @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async decide(@Param("id") id: string, @Body() body: unknown, @Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const input = inputObject(body);
    if ((input.decision !== "APPROVE" && input.decision !== "REJECT") || input.amountMinor !== undefined && (!Number.isSafeInteger(input.amountMinor) || Number(input.amountMinor) < 1 || Number(input.amountMinor) > 100_000_000)) throw new BadRequestException("Invalid refund decision");
    return apiResponse(request, await this.refunds.decide(assertUuid(id, "id"), requiredVersion(headerValue(request, "if-match")), principal.userId, input.decision, stringField(input, "reason", { min: 3, max: 500 }), input.amountMinor === undefined ? undefined : Number(input.amountMinor), requestContext(request)));
  }

  @Post(":id/confirm-manual") @RequirePlatformRole("FINANCE") @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async confirmManual(@Param("id") id: string, @Body() body: unknown, @Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const input = inputObject(body);
    if (input.confirmedTransferred !== true) throw new BadRequestException("Confirm that the transfer was completed");
    return apiResponse(request, await this.refunds.confirmManual(assertUuid(id, "id"), requiredVersion(headerValue(request, "if-match")), principal.userId, stringField(input, "reference", { min: 5, max: 180 }), requestContext(request)));
  }

  @Post(":id/reconcile-provider") @RequirePlatformRole("FINANCE") @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async reconcileProvider(@Param("id") id: string, @Body() body: unknown, @Req() request: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const input = inputObject(body);
    await this.refunds.reconcileProviderReference(assertUuid(id, "id"), principal.userId, stringField(input, "externalRefundId", { min: 1, max: 255 }), requestContext(request));
    return apiResponse(request, { reconciled: true });
  }
}
