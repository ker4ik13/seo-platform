import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  NotificationPreferencesSummary,
  ProjectNotificationSubscriptionSummary
} from "@seo-platform/contracts";
import { RequirePermission } from "../authorization/require-permission.js";
import type {
  TenantAuthorization,
  TenantRequest
} from "../authorization/authorization.types.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { requiredVersion } from "../common/version-precondition.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest
} from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { RealtimeClient } from "../realtime/realtime.client.js";
import {
  updateNotificationPreferencesInput,
  updateProjectNotificationSubscriptionInput
} from "./notification-input.js";

@Controller("api/v1/me/notification-preferences")
export class NotificationPreferencesController {
  public constructor(private readonly realtime: RealtimeClient) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  public async get(
    @Req() request: AuthenticatedRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<NotificationPreferencesSummary>> {
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.realtime.getNotificationPreferences({
        actorId: principal.userId,
        requestId: context.requestId
      })
    );
  }

  @Patch()
  @UseGuards(CsrfSessionGuard)
  public async update(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<NotificationPreferencesSummary>> {
    const context = requestContext(request);
    const result = await this.realtime.updateNotificationPreferences(
      {
        actorId: principal.userId,
        requestId: context.requestId
      },
      updateNotificationPreferencesInput(body),
      requiredVersion(headerValue(request, "if-match"))
    );
    return apiResponse(request, result, result.version);
  }
}

@Controller("api/v1/projects/:projectId/notification-subscription")
export class ProjectNotificationSubscriptionController {
  public constructor(private readonly realtime: RealtimeClient) {}

  @Get()
  @RequirePermission("project.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectNotificationSubscriptionSummary>> {
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.realtime.getProjectNotificationSubscription({
        tenant: requiredTenant(request),
        actorId: principal.userId,
        requestId: context.requestId
      })
    );
  }

  @Patch()
  @RequirePermission("project.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectNotificationSubscriptionSummary>> {
    const context = requestContext(request);
    const result = await this.realtime.updateProjectNotificationSubscription(
      {
        tenant: requiredTenant(request),
        actorId: principal.userId,
        requestId: context.requestId
      },
      updateProjectNotificationSubscriptionInput(body),
      requiredVersion(headerValue(request, "if-match"))
    );
    return apiResponse(request, result, result.version);
  }
}

function requiredTenant(request: TenantRequest): TenantAuthorization {
  const tenant = request.tenantAuthorization;
  if (
    !tenant?.projectId ||
    !tenant.membershipId ||
    !tenant.membershipVersion
  ) {
    throw new Error("Project membership authorization is missing");
  }
  return tenant;
}
