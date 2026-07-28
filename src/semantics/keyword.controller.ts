import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import { RequirePermission } from "../authorization/require-permission.js";
import type {
  TenantAuthorization,
  TenantRequest
} from "../authorization/authorization.types.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { keywordListQuery } from "./keyword-query.js";

@Controller("api/v1/projects/:projectId/keywords")
export class KeywordController {
  public constructor(private readonly seoData: SeoDataClient) {}

  @Get()
  @RequirePermission("semantic.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Query() query: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const context = requestContext(request);
    const result = await this.seoData.listKeywords(
      {
        tenant: requiredTenant(request),
        actorId: principal.userId,
        requestId: context.requestId
      },
      keywordListQuery(query)
    );
    return {
      data: result.data,
      page: result.page,
      meta: { requestId: context.requestId }
    };
  }
}

function requiredTenant(request: TenantRequest): TenantAuthorization {
  const tenant = request.tenantAuthorization;
  if (!tenant?.projectId) {
    throw new Error("Project authorization is missing");
  }
  return tenant;
}
