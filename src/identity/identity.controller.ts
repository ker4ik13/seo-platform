import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  AcceptedOperation,
  ApiCollectionResponse,
  ApiResponse,
  AuthenticationResult,
  CurrentAccount,
  UserSessionSummary
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  apiResponse,
  collectionResponse
} from "../common/api-response.js";
import { DomainError, validationError } from "../common/domain-error.js";
import { CurrentPrincipal } from "./current-principal.js";
import {
  loginInput,
  registerInput,
  resendVerificationInput,
  verifyEmailInput
} from "./identity-input.js";
import { IdentityService } from "./identity.service.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest
} from "./identity.types.js";
import { requestContext } from "./request-context.js";
import { SessionService } from "./session.service.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "./session-auth.guard.js";
import { SessionCookieService } from "./session-cookie.service.js";

@Controller("api/v1")
export class IdentityController {
  public constructor(
    private readonly identity: IdentityService,
    private readonly sessionsService: SessionService,
    private readonly cookies: SessionCookieService
  ) {}

  @Post("auth/register")
  public async register(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<AuthenticationResult>> {
    const result = await this.identity.register(
      registerInput(body),
      requestContext(request)
    );
    if (result.credentials) this.cookies.write(reply, result.credentials);
    return apiResponse(request, result.response);
  }

  @Post("auth/login")
  @HttpCode(200)
  public async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<AuthenticationResult>> {
    const result = await this.identity.login(
      loginInput(body),
      requestContext(request)
    );
    if (result.credentials) this.cookies.write(reply, result.credentials);
    return apiResponse(request, result.response);
  }

  @Post("auth/email-verification/verify")
  @HttpCode(200)
  public async verifyEmail(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<AuthenticationResult>> {
    const result = await this.identity.verifyEmail(
      verifyEmailInput(body),
      requestContext(request)
    );
    if (result.credentials) this.cookies.write(reply, result.credentials);
    return apiResponse(request, result.response);
  }

  @Post("auth/email-verification/resend")
  @HttpCode(202)
  public async resendEmailVerification(
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<AcceptedOperation>> {
    const result = await this.identity.resendVerification(
      resendVerificationInput(body),
      requestContext(request)
    );
    return apiResponse(request, result.response);
  }

  @Post("auth/refresh")
  @HttpCode(200)
  public async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<AuthenticationResult>> {
    const result = await this.sessionsService.rotate(
      this.cookies.refreshToken(request.cookies),
      this.cookies.csrfToken(request.cookies),
      headerValue(request, "x-csrf-token"),
      requestContext(request)
    );
    if (result.credentials) this.cookies.write(reply, result.credentials);
    return apiResponse(request, result.response);
  }

  @Post("auth/logout")
  @HttpCode(204)
  public async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<void> {
    await this.sessionsService.logout(
      this.cookies.refreshToken(request.cookies),
      this.cookies.csrfToken(request.cookies),
      headerValue(request, "x-csrf-token"),
      requestContext(request)
    );
    this.cookies.clear(reply);
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  public async me(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CurrentAccount>> {
    return apiResponse(
      request,
      await this.sessionsService.currentAccount(principal)
    );
  }

  @Get("sessions")
  @UseGuards(SessionAuthGuard)
  public async sessions(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<UserSessionSummary>> {
    return collectionResponse(
      request,
      await this.sessionsService.list(principal)
    );
  }

  @Delete("sessions/others")
  @UseGuards(CsrfSessionGuard)
  @HttpCode(200)
  public async revokeOtherSessions(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<{ readonly revoked: number }>> {
    const revoked = await this.sessionsService.revokeOthers(
      principal,
      requestContext(request)
    );
    return apiResponse(request, { revoked });
  }

  @Delete("sessions/:sessionId")
  @UseGuards(CsrfSessionGuard)
  @HttpCode(204)
  public async revokeSession(
    @Param("sessionId") sessionId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    assertUuid(sessionId);
    const revoked = await this.sessionsService.revoke(
      principal,
      sessionId,
      requestContext(request)
    );
    if (!revoked) {
      throw new DomainError({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Session not found"
      });
    }
    if (sessionId === principal.sessionId) this.cookies.clear(reply);
  }
}

function assertUuid(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value
    )
  ) {
    throw validationError(
      "sessionId",
      "INVALID_IDENTIFIER",
      "A valid UUID is required"
    );
  }
}
