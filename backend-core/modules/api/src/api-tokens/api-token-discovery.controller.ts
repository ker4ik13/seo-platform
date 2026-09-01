import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type {
  ApiResponse,
  ApiTokenAccessDiscovery
} from "@seo-platform/contracts";
import { apiResponse } from "../common/api-response.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import { ApiTokenOnlyGuard } from "../identity/api-token-only.guard.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest
} from "../identity/identity.types.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { ApiTokenService } from "./api-token.service.js";

@Controller("api/v1")
export class ApiTokenDiscoveryController {
  public constructor(private readonly apiTokens: ApiTokenService) {}

  @Get("access")
  @UseGuards(SessionAuthGuard, ApiTokenOnlyGuard)
  public async discover(
    @Req() request: AuthenticatedRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ApiTokenAccessDiscovery>> {
    const authorization = request.apiTokenAuthorization;
    if (!authorization) {
      throw new Error("API token authorization is missing after guard");
    }
    return apiResponse(
      request,
      await this.apiTokens.discover(principal.userId, authorization)
    );
  }
}
