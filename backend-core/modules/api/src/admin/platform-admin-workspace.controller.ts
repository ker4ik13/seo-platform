import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  AdminBillingPlanSummary,
  AdminWorkspaceSearchResult,
  AdminWorkspaceSubscriptionGrantSummary,
  ApiCollectionResponse,
  ApiResponse
} from "@seo-platform/contracts";
import {
  apiResponse,
  collectionResponse
} from "../common/api-response.js";
import { assertUuid } from "../common/identifier.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type {
  AuthenticatedPrincipal
} from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import {
  adminSubscriptionPrecondition,
  adminWorkspaceSearchQuery,
  grantAdminWorkspaceSubscriptionInput
} from "./platform-admin-workspace-input.js";
import { PlatformAdminWorkspaceService } from "./platform-admin-workspace.service.js";
import { RequirePlatformRole } from "./platform-role.js";
import {
  PlatformRoleGuard,
  type PlatformAdminRequest
} from "./platform-role.guard.js";

@Controller("admin-api/v1/workspaces")
@RequirePlatformRole("FINANCE", "SUPPORT", "OPERATIONS")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformAdminWorkspaceController {
  public constructor(
    private readonly workspaces: PlatformAdminWorkspaceService
  ) {}

  @Get()
  public async search(
    @Query("q") query: unknown,
    @Req() request: PlatformAdminRequest
  ): Promise<ApiResponse<AdminWorkspaceSearchResult>> {
    return apiResponse(
      request,
      await this.workspaces.searchWorkspaces(
        adminWorkspaceSearchQuery(query)
      )
    );
  }

  @Post(":workspaceId/subscription-grants")
  @RequirePlatformRole("FINANCE")
  @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async grantSubscription(
    @Param("workspaceId") workspaceIdValue: string,
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<AdminWorkspaceSubscriptionGrantSummary>> {
    const workspaceId = assertUuid(workspaceIdValue, "workspaceId");
    return apiResponse(
      request,
      await this.workspaces.grantSubscription(
        workspaceId,
        grantAdminWorkspaceSubscriptionInput(body, workspaceId),
        adminSubscriptionPrecondition(
          headerValue(request, "if-match"),
          headerValue(request, "if-none-match")
        ),
        principal.userId,
        requiredIdempotencyKey(
          headerValue(request, "idempotency-key")
        ),
        requestContext(request)
      )
    );
  }
}

@Controller("admin-api/v1/billing/plans")
@RequirePlatformRole("FINANCE")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformAdminBillingPlanController {
  public constructor(
    private readonly workspaces: PlatformAdminWorkspaceService
  ) {}

  @Get()
  public async plans(
    @Req() request: PlatformAdminRequest
  ): Promise<ApiCollectionResponse<AdminBillingPlanSummary>> {
    return collectionResponse(request, await this.workspaces.plans());
  }
}
