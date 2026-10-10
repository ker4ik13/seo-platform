import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { parseAnalyticsReportQuery } from "@seo-platform/contracts";
import { apiResponse } from "../common/api-response.js";
import { validationError } from "../common/domain-error.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { RequirePlatformRole } from "./platform-role.js";
import {
  PlatformRoleGuard,
  type PlatformAdminRequest,
} from "./platform-role.guard.js";
import { PlatformAnalyticsService } from "./platform-analytics.service.js";

@Controller("admin-api/v1/analytics")
@RequirePlatformRole("ANALYST", "OPERATIONS", "FINANCE", "SUPPORT")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformAnalyticsController {
  public constructor(private readonly analytics: PlatformAnalyticsService) {}
  @Get()
  public async report(
    @Query() value: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    let query;
    try {
      query = parseAnalyticsReportQuery(value);
    } catch {
      throw validationError(
        "query",
        "INVALID_ANALYTICS_QUERY",
        "Выберите период 7, 30 или 90 дней",
      );
    }
    const finance =
      request.platformRoles?.some(
        (role) => role === "SUPER_ADMIN" || role === "FINANCE",
      ) === true;
    return apiResponse(
      request,
      await this.analytics.report(query, finance, principal.userId, request.id),
    );
  }
}
