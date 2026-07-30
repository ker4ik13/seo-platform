import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  RealtimeProjectTicket
} from "@seo-platform/contracts";
import { RequirePermission } from "../authorization/require-permission.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { requiredProjectTenant } from "../authorization/project-tenant.js";
import { apiResponse } from "../common/api-response.js";
import { DomainError } from "../common/domain-error.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue
} from "../identity/session-auth.guard.js";
import { RealtimeClient } from "./realtime.client.js";
import { realtimeTicketInput } from "./realtime-ticket-input.js";

@Controller("api/v1/projects/:projectId/realtime-tickets")
export class RealtimeTicketController {
  public constructor(private readonly realtime: RealtimeClient) {}

  @Post()
  @RequirePermission("presence.view")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async issue(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<RealtimeProjectTicket>> {
    const context = requestContext(request);
    return apiResponse(
      request,
      await this.realtime.issueProjectTicket(
        {
          tenant: requiredProjectTenant(request),
          actorId: principal.userId,
          requestId: context.requestId
        },
        {
          sessionId: principal.sessionId,
          sessionFamilyId: principal.sessionFamilyId,
          sessionExpiresAt: principal.expiresAt.toISOString()
        },
        realtimeTicketInput(body),
        requiredBrowserOrigin(request)
      )
    );
  }
}

function requiredBrowserOrigin(request: TenantRequest): string {
  const origin = headerValue(request, "origin");
  if (!origin || origin.length > 512) throw invalidOrigin();
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== origin
    ) {
      throw invalidOrigin();
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw invalidOrigin();
  }
  return origin;
}

function invalidOrigin(): DomainError {
  return new DomainError({
    statusCode: 403,
    code: "FORBIDDEN",
    message: "Realtime access requires an allowed browser origin"
  });
}
