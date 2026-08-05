import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  RankHistoryItem
} from "@seo-platform/contracts";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { rankHistoryQuery } from "./rank-history-query.js";

@Controller("api/v1/projects/:projectId/rank-history")
export class RankHistoryController {
  public constructor(private readonly seoData: SeoDataClient) {}

  @Get()
  @RequirePermission("ranking.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Query() query: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<RankHistoryItem>> {
    const tenant = requiredProjectTenant(request);
    const context = internalProjectContext(
      request,
      principal,
      tenant
    );
    const result = await this.seoData.listRankHistory(
      context,
      rankHistoryQuery(query)
    );
    return {
      data: result.data,
      page: result.page,
      meta: { requestId: context.requestId }
    };
  }
}
