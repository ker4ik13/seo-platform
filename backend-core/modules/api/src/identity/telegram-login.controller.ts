import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { apiResponse } from "../common/api-response.js";
import { inputObject } from "../common/input.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { CurrentPrincipal } from "./current-principal.js";
import type { AuthenticatedPrincipal } from "./identity.types.js";
import { requestContext } from "./request-context.js";
import { RecentAuthenticationService } from "./recent-authentication.service.js";
import { CsrfSessionGuard, SessionAuthGuard } from "./session-auth.guard.js";
import { SessionCookieService } from "./session-cookie.service.js";
import { TelegramLoginService } from "./telegram-login.service.js";

const COOKIE = "seo_telegram_login";
@Controller("api/v1")
export class TelegramLoginController {
  public constructor(private readonly telegram: TelegramLoginService, private readonly cookies: SessionCookieService, private readonly recent: RecentAuthenticationService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  @Get("auth/telegram/config") public configuration(@Req() request: FastifyRequest) { return apiResponse(request, this.telegram.configuration()); }
  @Post("auth/telegram/start") public async start(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = inputObject(body); const result = await this.telegram.start("LOGIN", input.locale === "en" ? "en" : "ru", requestContext(request));
    this.bind(reply, result.response.id, result.browserSecret); return apiResponse(request, result.response);
  }
  @Get("auth/telegram/status/:id") public async status(@Param("id") id: string, @Req() request: FastifyRequest) { return apiResponse(request, await this.telegram.status(id, secret(request, id))); }
  @Post("auth/telegram/cancel/:id") public async cancel(@Param("id") id: string, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) { await this.telegram.cancel(id, secret(request, id)); reply.clearCookie(COOKIE, { path: "/app" }); return apiResponse(request, { cancelled: true }); }
  @Post("auth/telegram/finish/:id") @HttpCode(200) public async finish(@Param("id") id: string, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.telegram.finishLogin(id, secret(request, id), requestContext(request));
    reply.clearCookie(COOKIE, { path: "/app" });
    if (result.credentials) this.cookies.write(reply, result.credentials);
    return apiResponse(request, result.response);
  }
  @Get("me/telegram") @UseGuards(SessionAuthGuard) public async connection(@Req() request: FastifyRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) { return apiResponse(request, await this.telegram.connection(principal.userId)); }
  @Post("me/telegram/start") @UseGuards(CsrfSessionGuard) public async startLink(@Body() body: unknown, @Req() request: FastifyRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.recent.assert(principal); const input = inputObject(body); const result = await this.telegram.start("LINK", input.locale === "en" ? "en" : "ru", requestContext(request), principal);
    this.bind(reply, result.response.id, result.browserSecret); return apiResponse(request, result.response);
  }
  @Post("me/telegram/finish/:id") @UseGuards(CsrfSessionGuard) public async finishLink(@Param("id") id: string, @Req() request: FastifyRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal, @Res({ passthrough: true }) reply: FastifyReply) {
    this.recent.assert(principal); await this.telegram.finishLink(id, secret(request, id), principal, requestContext(request)); reply.clearCookie(COOKIE, { path: "/app" }); return apiResponse(request, { linked: true });
  }
  @Delete("me/telegram") @UseGuards(CsrfSessionGuard) public async unlink(@Req() request: FastifyRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) { this.recent.assert(principal); await this.telegram.unlink(principal, requestContext(request)); return apiResponse(request, { linked: false }); }
  @Post("auth/telegram/webhook") @HttpCode(200) public async webhook(@Body() body: unknown, @Req() request: FastifyRequest) {
    const header = request.headers["x-telegram-bot-api-secret-token"];
    if (typeof header !== "string" || !this.telegram.verifySecret(header)) throw new UnauthorizedException();
    await this.telegram.webhook(body); return { received: true };
  }
  private bind(reply: FastifyReply, id: string, browserSecret: string): void { reply.setCookie(COOKIE, `${id}.${browserSecret}`, { path: "/app", httpOnly: true, secure: this.config.auth.cookieSecure, sameSite: "lax", maxAge: 300 }); }
}
function secret(request: FastifyRequest, id: string): string { const value = request.cookies[COOKIE]; const [bound, secret, extra] = value?.split(".") ?? []; if (bound !== id || !secret || extra) throw new UnauthorizedException(); return secret; }
