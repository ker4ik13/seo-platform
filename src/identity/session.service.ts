import { Inject, Injectable } from "@nestjs/common";
import type {
  AuthenticationResult,
  CurrentAccount,
  UserSessionSummary
} from "@seo-platform/contracts";
import type {
  Prisma,
  Session,
  User
} from "../generated/prisma/client.js";
import { AuditService } from "../audit/audit.service.js";
import { DomainError } from "../common/domain-error.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { unauthenticatedError } from "./auth-errors.js";
import { AuthCryptoService } from "./auth-crypto.service.js";
import {
  toSessionSummary,
  toUserSessionSummary,
  toUserSummary
} from "./identity.mapper.js";
import type {
  AuthenticatedPrincipal,
  RequestContext,
  SessionCredentials
} from "./identity.types.js";

export interface SessionIssue {
  readonly session: Session;
  readonly credentials: SessionCredentials;
}

export interface AuthenticatedSession {
  readonly principal: AuthenticatedPrincipal;
  readonly user: User;
  readonly session: Session;
}

export interface SessionRotationResult {
  readonly response: AuthenticationResult;
  readonly credentials: SessionCredentials;
}

@Injectable()
export class SessionService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async issue(
    transaction: Prisma.TransactionClient,
    userId: string,
    context: RequestContext,
    familyId = this.crypto.randomFamilyId()
  ): Promise<SessionIssue> {
    const accessToken = this.crypto.randomToken();
    const refreshToken = this.crypto.randomToken();
    const csrfToken = this.crypto.randomToken();
    const accessExpiresAt = new Date(
      Date.now() + this.config.auth.accessTokenTtlMinutes * 60 * 1_000
    );
    const expiresAt = new Date(
      Date.now() + this.config.auth.sessionTtlDays * 24 * 60 * 60 * 1_000
    );
    const session = await transaction.session.create({
      data: {
        userId,
        accessTokenHash: this.crypto.hashOpaqueToken(accessToken),
        refreshTokenHash: this.crypto.hashOpaqueToken(refreshToken),
        csrfTokenHash: this.crypto.hashOpaqueToken(csrfToken),
        familyId,
        accessExpiresAt,
        expiresAt,
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {})
      }
    });
    return {
      session,
      credentials: { accessToken, refreshToken, csrfToken }
    };
  }

  public async authenticate(
    accessToken: string | undefined,
    csrfCookie?: string,
    csrfHeader?: string
  ): Promise<AuthenticatedSession> {
    if (!accessToken) throw unauthenticatedError();
    const tokenHash = this.crypto.hashOpaqueToken(accessToken);
    const session = await this.prisma.session.findUnique({
      where: { accessTokenHash: tokenHash },
      include: { user: true }
    });
    if (!session) throw unauthenticatedError();

    if (
      session.revokedAt ||
      session.accessExpiresAt <= new Date() ||
      session.expiresAt <= new Date()
    ) {
      throw unauthenticatedError();
    }
    if (session.user.status !== "ACTIVE") throw unauthenticatedError();

    if (csrfCookie !== undefined || csrfHeader !== undefined) {
      this.validateCsrf(session, csrfCookie, csrfHeader);
    }

    if (session.lastUsedAt.getTime() < Date.now() - 5 * 60 * 1_000) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() }
      });
    }

    return {
      principal: {
        userId: session.userId,
        sessionId: session.id,
        sessionFamilyId: session.familyId,
        authenticatedAt: session.authenticatedAt,
        expiresAt: session.expiresAt
      },
      user: session.user,
      session
    };
  }

  public async currentAccount(
    principal: AuthenticatedPrincipal
  ): Promise<CurrentAccount> {
    const authenticated = await this.loadPrincipal(principal);
    return {
      user: toUserSummary(authenticated.user),
      session: toSessionSummary(authenticated.session)
    };
  }

  public async rotate(
    refreshToken: string | undefined,
    csrfCookie: string | undefined,
    csrfHeader: string | undefined,
    context: RequestContext
  ): Promise<SessionRotationResult> {
    const authenticated = await this.authenticateRefresh(
      refreshToken,
      csrfCookie,
      csrfHeader
    );
    const rotated = await this.prisma.$transaction(async (transaction) => {
      const replacement = await this.issue(
        transaction,
        authenticated.user.id,
        context,
        authenticated.session.familyId
      );
      const revoked = await transaction.session.updateMany({
        where: {
          id: authenticated.session.id,
          revokedAt: null
        },
        data: {
          revokedAt: new Date(),
          replacedBySessionId: replacement.session.id
        }
      });
      if (revoked.count !== 1) throw unauthenticatedError();
      await this.audit.record(
        {
          actorId: authenticated.user.id,
          action: "identity.session.rotated",
          resourceType: "session",
          resourceId: replacement.session.id,
          requestId: context.requestId
        },
        transaction
      );
      return replacement;
    });

    return {
      response: {
        user: toUserSummary(authenticated.user),
        session: toSessionSummary(rotated.session),
        emailVerificationRequired: false
      },
      credentials: rotated.credentials
    };
  }

  public async logout(
    refreshToken: string | undefined,
    csrfCookie: string | undefined,
    csrfHeader: string | undefined,
    context: RequestContext
  ): Promise<void> {
    const authenticated = await this.authenticateRefresh(
      refreshToken,
      csrfCookie,
      csrfHeader
    );
    await this.prisma.$transaction(async (transaction) => {
      await transaction.session.updateMany({
        where: { id: authenticated.session.id, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      await this.audit.record(
        {
          actorId: authenticated.user.id,
          action: "identity.logout",
          resourceType: "session",
          resourceId: authenticated.session.id,
          requestId: context.requestId
        },
        transaction
      );
    });
  }

  public async list(
    principal: AuthenticatedPrincipal
  ): Promise<readonly UserSessionSummary[]> {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId: principal.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { lastUsedAt: "desc" },
      take: 100
    });
    return sessions.map((session) =>
      toUserSessionSummary(session, principal.sessionId)
    );
  }

  public async revoke(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    context: RequestContext
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.session.updateMany({
        where: {
          id: sessionId,
          userId: principal.userId,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
      if (revoked.count === 1) {
        await this.audit.record(
          {
            actorId: principal.userId,
            action: "identity.session.revoked",
            resourceType: "session",
            resourceId: sessionId,
            requestId: context.requestId
          },
          transaction
        );
      }
      return revoked.count === 1;
    });
  }

  public async revokeOthers(
    principal: AuthenticatedPrincipal,
    context: RequestContext
  ): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.session.updateMany({
        where: {
          userId: principal.userId,
          id: { not: principal.sessionId },
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
      await this.audit.record(
        {
          actorId: principal.userId,
          action: "identity.sessions.others_revoked",
          resourceType: "session",
          resourceId: principal.sessionId,
          requestId: context.requestId
        },
        transaction
      );
      return revoked.count;
    });
  }

  private async loadPrincipal(
    principal: AuthenticatedPrincipal
  ): Promise<AuthenticatedSession> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: principal.sessionId,
        userId: principal.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      include: { user: true }
    });
    if (!session || session.user.status !== "ACTIVE") {
      throw unauthenticatedError();
    }
    return { principal, user: session.user, session };
  }

  private async authenticateRefresh(
    refreshToken: string | undefined,
    csrfCookie: string | undefined,
    csrfHeader: string | undefined
  ): Promise<AuthenticatedSession> {
    if (!refreshToken) throw unauthenticatedError();
    const tokenHash = this.crypto.hashOpaqueToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { user: true }
    });
    if (!session) throw unauthenticatedError();

    if (session.revokedAt) {
      if (session.replacedBySessionId && session.expiresAt > new Date()) {
        await this.prisma.session.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }
      throw unauthenticatedError();
    }
    if (session.expiresAt <= new Date()) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() }
      });
      throw unauthenticatedError();
    }
    if (session.user.status !== "ACTIVE") throw unauthenticatedError();

    this.validateCsrf(session, csrfCookie, csrfHeader);
    return {
      principal: {
        userId: session.userId,
        sessionId: session.id,
        sessionFamilyId: session.familyId,
        authenticatedAt: session.authenticatedAt,
        expiresAt: session.expiresAt
      },
      user: session.user,
      session
    };
  }

  private validateCsrf(
    session: Session,
    csrfCookie: string | undefined,
    csrfHeader: string | undefined
  ): void {
    if (
      !csrfCookie ||
      !csrfHeader ||
      !this.crypto.tokensEqual(csrfCookie, csrfHeader) ||
      this.crypto.hashOpaqueToken(csrfCookie) !== session.csrfTokenHash
    ) {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "CSRF validation failed"
      });
    }
  }
}
