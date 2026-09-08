import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { parseSemanticRankComparisonInput } from "@seo-platform/contracts";
import { RequirePermission } from "../authorization/require-permission.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { internalProjectContext, requiredProjectTenant } from "../authorization/project-tenant.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { validationError } from "../common/domain-error.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard, SessionAuthGuard } from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";

@Controller("api/v1/projects/:projectId/keyword-ranks")
export class KeywordRankComparisonController {
  constructor(private readonly seoData: SeoDataClient) {}

  @Get("dimensions")
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  async catalog(@Req() request: TenantRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const tenant = requiredProjectTenant(request);
    return apiResponse(request, await this.seoData.keywordRankDimensions(internalProjectContext(request, principal, tenant)));
  }

  @Post("comparison")
  @HttpCode(200)
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, CsrfSessionGuard, TenantPermissionGuard)
  async compare(@Body() body: unknown, @Req() request: TenantRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const tenant = requiredProjectTenant(request);
    let input;
    try { input = parseSemanticRankComparisonInput(body); } catch { throw validationError("$", "INVALID_SCOPE", "Choose valid keywords and rank dimensions"); }
    return apiResponse(request, await this.seoData.keywordRankComparison(internalProjectContext(request, principal, tenant), input));
  }
}
