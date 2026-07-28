import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import type { SessionCredentials } from "./identity.types.js";

@Injectable()
export class SessionCookieService {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public accessToken(
    cookies: Readonly<Record<string, string | undefined>>
  ): string | undefined {
    return cookies[this.config.auth.accessCookieName];
  }

  public refreshToken(
    cookies: Readonly<Record<string, string | undefined>>
  ): string | undefined {
    return cookies[this.config.auth.sessionCookieName];
  }

  public csrfToken(
    cookies: Readonly<Record<string, string | undefined>>
  ): string | undefined {
    return cookies[this.config.auth.csrfCookieName];
  }

  public write(
    reply: FastifyReply,
    credentials: SessionCredentials
  ): void {
    const refreshMaxAge = this.config.auth.sessionTtlDays * 24 * 60 * 60;
    reply.setCookie(
      this.config.auth.accessCookieName,
      credentials.accessToken,
      {
        httpOnly: true,
        secure: this.config.auth.cookieSecure,
        sameSite: "lax",
        path: "/",
        maxAge: this.config.auth.accessTokenTtlMinutes * 60
      }
    );
    reply.setCookie(
      this.config.auth.sessionCookieName,
      credentials.refreshToken,
      {
        httpOnly: true,
        secure: this.config.auth.cookieSecure,
        sameSite: "lax",
        path: "/",
        maxAge: refreshMaxAge
      }
    );
    reply.setCookie(this.config.auth.csrfCookieName, credentials.csrfToken, {
      httpOnly: false,
      secure: this.config.auth.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: refreshMaxAge
    });
  }

  public clear(reply: FastifyReply): void {
    const options = {
      secure: this.config.auth.cookieSecure,
      sameSite: "lax" as const,
      path: "/"
    };
    reply.clearCookie(this.config.auth.accessCookieName, {
      ...options,
      httpOnly: true
    });
    reply.clearCookie(this.config.auth.sessionCookieName, {
      ...options,
      httpOnly: true
    });
    reply.clearCookie(this.config.auth.csrfCookieName, {
      ...options,
      httpOnly: false
    });
  }
}
