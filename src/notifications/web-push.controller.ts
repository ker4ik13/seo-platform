import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  WebPushDeviceSummary,
  WebPushRevokeResult,
  WebPushSubscriptionsState
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { apiResponse } from "../common/api-response.js";
import { assertUuid } from "../common/identifier.js";
import { requiredVersion } from "../common/version-precondition.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest
} from "../identity/identity.types.js";
import { RecentAuthenticationService } from "../identity/recent-authentication.service.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { RealtimeClient } from "../realtime/realtime.client.js";
import {
  renameWebPushDeviceInput,
  upsertWebPushSubscriptionInput
} from "./web-push-input.js";
import { webPushUserAgentMetadata } from "./web-push-user-agent.js";

@Controller("api/v1/me/push-subscriptions")
export class WebPushSubscriptionController {
  public constructor(
    private readonly realtime: RealtimeClient,
    private readonly recentAuthentication: RecentAuthenticationService,
    private readonly audit: AuditService
  ) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  public async get(
    @Req() request: AuthenticatedRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WebPushSubscriptionsState>> {
    return apiResponse(
      request,
      await this.realtime.getWebPushSubscriptions(
        internalContext(request, principal)
      )
    );
  }

  @Put(":installationId")
  @UseGuards(CsrfSessionGuard)
  public async upsert(
    @Param("installationId") installationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WebPushDeviceSummary>> {
    const canonicalInstallationId = assertUuid(
      installationId,
      "installationId"
    );
    this.recentAuthentication.assert(principal);
    const context = requestContext(request);
    const input = upsertWebPushSubscriptionInput(body);
    await this.audit.record({
      actorId: principal.userId,
      action:
        input.intent === "ENABLE"
          ? "notification.web_push.enable_requested"
          : "notification.web_push.reconcile_requested",
      resourceType: "web_push_subscription",
      resourceId: canonicalInstallationId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.realtime.upsertWebPushSubscription(
      {
        actorId: principal.userId,
        sessionFamilyId: principal.sessionFamilyId,
        requestId: context.requestId
      },
      canonicalInstallationId,
      {
        ...input,
        ...webPushUserAgentMetadata(context.userAgent)
      }
    );
    return apiResponse(request, result, result.version);
  }

  @Patch(":installationId")
  @UseGuards(CsrfSessionGuard)
  public async rename(
    @Param("installationId") installationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WebPushDeviceSummary>> {
    const context = internalContext(request, principal);
    const canonicalInstallationId = assertUuid(
      installationId,
      "installationId"
    );
    const input = renameWebPushDeviceInput(body);
    const version = requiredVersion(headerValue(request, "if-match"));
    await this.audit.record({
      actorId: principal.userId,
      action: "notification.web_push.rename_requested",
      resourceType: "web_push_subscription",
      resourceId: canonicalInstallationId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const result = await this.realtime.renameWebPushDevice(
      context,
      canonicalInstallationId,
      input,
      version
    );
    return apiResponse(request, result, result.version);
  }

  @Delete(":installationId")
  @UseGuards(CsrfSessionGuard)
  public async revoke(
    @Param("installationId") installationId: string,
    @Req() request: AuthenticatedRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WebPushRevokeResult>> {
    const context = internalContext(request, principal);
    const canonicalInstallationId = assertUuid(
      installationId,
      "installationId"
    );
    await this.audit.record({
      actorId: principal.userId,
      action: "notification.web_push.revoke_requested",
      resourceType: "web_push_subscription",
      resourceId: canonicalInstallationId,
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    return apiResponse(
      request,
      await this.realtime.revokeWebPushDevice(
        context,
        canonicalInstallationId
      )
    );
  }
}

function internalContext(
  request: AuthenticatedRequest,
  principal: AuthenticatedPrincipal
): {
  readonly actorId: string;
  readonly sessionFamilyId: string;
  readonly requestId: string;
} {
  return {
    actorId: principal.userId,
    sessionFamilyId: principal.sessionFamilyId,
    requestId: requestContext(request).requestId
  };
}
