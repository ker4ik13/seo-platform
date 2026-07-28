import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  AuthenticationResult,
  ConfirmTotpResult,
  DisableTotpResult,
  MfaOverview,
  TotpSetupResult
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { apiResponse } from "../common/api-response.js";
import { CurrentPrincipal } from "./current-principal.js";
import {
  confirmTotpInput,
  disableTotpInput,
  verifyMfaChallengeInput
} from "./identity-input.js";
import type { AuthenticatedPrincipal } from "./identity.types.js";
import { MfaService } from "./mfa.service.js";
import { requestContext } from "./request-context.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "./session-auth.guard.js";
import { SessionCookieService } from "./session-cookie.service.js";

@Controller("api/v1/auth/mfa")
export class MfaController {
  public constructor(
    private readonly mfa: MfaService,
    private readonly cookies: SessionCookieService
  ) {}

  @Post("challenge/verify")
  @HttpCode(200)
  public async verifyChallenge(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<AuthenticationResult>> {
    const result = await this.mfa.verifyLoginChallenge(
      verifyMfaChallengeInput(body),
      requestContext(request)
    );
    this.cookies.write(reply, result.credentials);
    return apiResponse(request, result.response);
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  public async overview(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<MfaOverview>> {
    return apiResponse(request, await this.mfa.overview(principal));
  }

  @Post("totp/setup")
  @UseGuards(CsrfSessionGuard)
  public async setupTotp(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<TotpSetupResult>> {
    return apiResponse(
      request,
      await this.mfa.setupTotp(principal, requestContext(request))
    );
  }

  @Post("totp/confirm")
  @UseGuards(CsrfSessionGuard)
  public async confirmTotp(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ConfirmTotpResult>> {
    return apiResponse(
      request,
      await this.mfa.confirmTotp(
        principal,
        confirmTotpInput(body),
        requestContext(request)
      )
    );
  }

  @Delete("totp")
  @UseGuards(CsrfSessionGuard)
  public async disableTotp(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<DisableTotpResult>> {
    return apiResponse(
      request,
      await this.mfa.disableTotp(
        principal,
        disableTotpInput(body),
        requestContext(request)
      )
    );
  }
}
