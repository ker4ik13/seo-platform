import { Inject, Injectable } from "@nestjs/common";
import {
  domainEventTypes,
  sessionFamilyRevokedEventDataV1,
  type AuthenticationResult,
  type CurrentAccount,
  type UserSessionSummary
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
import { OutboxService } from "../outbox/outbox.service.js";
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

export interface SessionFamilyRevocationResult {
  readonly revokedSessionCount: number;
  readonly revokedFamilyIds: readonly string[];
}

interface RefreshCandidate {
  readonly sessionId: string;
  readonly userId: string;
}

type SessionWithUser = Prisma.SessionGetPayload<{
  include: { user: true };
}>;

type RotationTransactionResult =
  | {
      readonly kind: "ROTATED";
      readonly user: User;
      readonly replacement: SessionIssue;
    }
  | {
      readonly kind: "UNAUTHENTICATED";
    };

@Injectable()
export class SessionService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async issue(
    transaction: Prisma.TransactionClient,
    user: Pick<User, "id" | "version">,
    context: RequestContext,
    familyId = this.crypto.randomFamilyId()
  ): Promise<SessionIssue> {
    await this.assertSessionLifecycleUser(transaction, user);
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
        userId: user.id,
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
      await this.prisma.$transaction(async (transaction) => {
        await this.lockUserSessionLifecycle(transaction, session.userId);
        await transaction.session.updateMany({
          where: {
            id: session.id,
            userId: session.userId,
            revokedAt: null
          },
          data: { lastUsedAt: new Date() }
        });
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
    const candidate = await this.loadRefreshCandidate(refreshToken);
    const result = await this.prisma.$transaction<
      RotationTransactionResult
    >(async (transaction) => {
      await this.lockUserSessionLifecycle(transaction, candidate.userId);
      const current = await transaction.session.findFirst({
        where: {
          id: candidate.sessionId,
          userId: candidate.userId
        },
        include: { user: true }
      });
      if (!current) return { kind: "UNAUTHENTICATED" };
      if (
        await this.revokeTerminalRefreshState(
          transaction,
          current,
          context.requestId
        )
      ) {
        return { kind: "UNAUTHENTICATED" };
      }
      this.validateCsrf(current, csrfCookie, csrfHeader);

      const replacement = await this.issue(
        transaction,
        current.user,
        context,
        current.familyId
      );
      const rotatedAt = new Date();
      const revoked = await transaction.session.updateMany({
        where: {
          id: current.id,
          userId: current.userId,
          revokedAt: null
        },
        data: {
          revokedAt: rotatedAt,
          replacedBySessionId: replacement.session.id
        }
      });
      if (revoked.count !== 1) {
        await this.revokeFamilies(transaction, {
          userId: current.userId,
          familyIds: [current.familyId],
          requestId: context.requestId
        });
        return { kind: "UNAUTHENTICATED" };
      }
      await this.audit.record(
        {
          actorId: current.user.id,
          action: "identity.session.rotated",
          resourceType: "session",
          resourceId: replacement.session.id,
          requestId: context.requestId
        },
        transaction
      );
      return {
        kind: "ROTATED",
        user: current.user,
        replacement
      };
    });
    if (result.kind === "UNAUTHENTICATED") throw unauthenticatedError();

    return {
      response: {
        user: toUserSummary(result.user),
        session: toSessionSummary(result.replacement.session),
        emailVerificationRequired: false
      },
      credentials: result.replacement.credentials
    };
  }

  public async logout(
    refreshToken: string | undefined,
    csrfCookie: string | undefined,
    csrfHeader: string | undefined,
    context: RequestContext
  ): Promise<void> {
    const candidate = await this.loadRefreshCandidate(refreshToken);
    const authenticated = await this.prisma.$transaction(
      async (transaction): Promise<boolean> => {
        await this.lockUserSessionLifecycle(transaction, candidate.userId);
        const current = await transaction.session.findFirst({
          where: {
            id: candidate.sessionId,
            userId: candidate.userId
          },
          include: { user: true }
        });
        if (!current) return false;
        if (
          await this.revokeTerminalRefreshState(
            transaction,
            current,
            context.requestId
          )
        ) {
          return false;
        }
        this.validateCsrf(current, csrfCookie, csrfHeader);
        const revoked = await this.revokeFamilies(transaction, {
          userId: current.userId,
          familyIds: [current.familyId],
          requestId: context.requestId
        });
        if (revoked.revokedSessionCount === 0) return false;
        await this.audit.record(
          {
            actorId: current.user.id,
            action: "identity.logout",
            resourceType: "session",
            resourceId: current.id,
            requestId: context.requestId
          },
          transaction
        );
        return true;
      });
    if (!authenticated) throw unauthenticatedError();
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
      await this.assertSessionLifecyclePrincipal(transaction, principal);
      const target = await transaction.session.findFirst({
        where: {
          id: sessionId,
          userId: principal.userId
        },
        select: { familyId: true }
      });
      if (!target) return false;

      const revoked = await this.revokeFamilies(transaction, {
        userId: principal.userId,
        familyIds: [target.familyId],
        requestId: context.requestId
      });
      if (revoked.revokedSessionCount > 0) {
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
      return revoked.revokedSessionCount > 0;
    });
  }

  public async revokeOthers(
    principal: AuthenticatedPrincipal,
    context: RequestContext
  ): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      await this.assertSessionLifecyclePrincipal(transaction, principal);
      const revoked = await this.revokeFamilies(transaction, {
        userId: principal.userId,
        excludeFamilyIds: [principal.sessionFamilyId],
        requestId: context.requestId
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
      return revoked.revokedSessionCount;
    });
  }

  public async revokeFamilies(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly requestId: string;
      readonly familyIds?: readonly string[];
      readonly excludeFamilyIds?: readonly string[];
    }
  ): Promise<SessionFamilyRevocationResult> {
    await this.lockUserSessionLifecycle(transaction, input.userId);
    const requestedFamilyIds = input.familyIds
      ? [...new Set(input.familyIds)].sort()
      : undefined;
    const excludedFamilyIds = [
      ...new Set(input.excludeFamilyIds ?? [])
    ].sort();
    if (requestedFamilyIds?.length === 0) {
      return { revokedSessionCount: 0, revokedFamilyIds: [] };
    }

    const familyFilter = {
      ...(requestedFamilyIds
        ? { in: requestedFamilyIds }
        : {}),
      ...(excludedFamilyIds.length > 0
        ? { notIn: excludedFamilyIds }
        : {})
    };
    const activeSessions = await transaction.session.findMany({
      where: {
        userId: input.userId,
        revokedAt: null,
        ...(Object.keys(familyFilter).length > 0
          ? { familyId: familyFilter }
          : {})
      },
      select: { familyId: true }
    });
    const activeFamilyIds = [
      ...new Set(activeSessions.map(({ familyId }) => familyId))
    ].sort();
    if (activeFamilyIds.length === 0) {
      return { revokedSessionCount: 0, revokedFamilyIds: [] };
    }

    const revokedAt = new Date();
    let revokedSessionCount = 0;
    const revokedFamilyIds: string[] = [];
    for (const familyId of activeFamilyIds) {
      const revoked = await transaction.session.updateMany({
        where: {
          userId: input.userId,
          familyId,
          revokedAt: null
        },
        data: { revokedAt }
      });
      if (revoked.count === 0) continue;

      await this.outbox.event(transaction, {
        eventType: domainEventTypes.sessionFamilyRevoked,
        aggregateType: "session-family",
        aggregateId: familyId,
        aggregateVersion: 1,
        payload: {
          ...sessionFamilyRevokedEventDataV1({
            userId: input.userId,
            sessionFamilyId: familyId,
            revokedAt
          })
        },
        requestId: input.requestId
      });
      revokedSessionCount += revoked.count;
      revokedFamilyIds.push(familyId);
    }
    return { revokedSessionCount, revokedFamilyIds };
  }

  public async lockUserSessionLifecycle(
    transaction: Prisma.TransactionClient,
    userId: string
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${"identity-session-user:" + userId}, 0)
      )::text AS lock_result
    `;
  }

  public async assertSessionLifecycleUser(
    transaction: Prisma.TransactionClient,
    expectedUser: Pick<User, "id" | "version">
  ): Promise<void> {
    await this.lockUserSessionLifecycle(transaction, expectedUser.id);
    const user = await transaction.user.findFirst({
      where: {
        id: expectedUser.id,
        version: expectedUser.version,
        status: "ACTIVE"
      },
      select: { id: true }
    });
    if (!user) throw unauthenticatedError();
  }

  public async assertSessionLifecyclePrincipal(
    transaction: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
    expectedUser?: Pick<User, "id" | "version">
  ): Promise<void> {
    if (expectedUser && expectedUser.id !== principal.userId) {
      throw unauthenticatedError();
    }
    await this.lockUserSessionLifecycle(transaction, principal.userId);
    const session = await transaction.session.findFirst({
      where: {
        id: principal.sessionId,
        userId: principal.userId,
        familyId: principal.sessionFamilyId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: {
          is: {
            status: "ACTIVE",
            ...(expectedUser
              ? { version: expectedUser.version }
              : {})
          }
        }
      },
      select: { id: true }
    });
    if (!session) throw unauthenticatedError();
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

  private async loadRefreshCandidate(
    refreshToken: string | undefined
  ): Promise<RefreshCandidate> {
    if (!refreshToken) throw unauthenticatedError();
    const tokenHash = this.crypto.hashOpaqueToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: tokenHash },
      select: {
        id: true,
        userId: true
      }
    });
    if (!session) throw unauthenticatedError();
    return {
      sessionId: session.id,
      userId: session.userId
    };
  }

  private async revokeTerminalRefreshState(
    transaction: Prisma.TransactionClient,
    session: SessionWithUser,
    requestId: string
  ): Promise<boolean> {
    if (session.expiresAt <= new Date()) {
      await this.revokeFamilies(transaction, {
        userId: session.userId,
        familyIds: [session.familyId],
        requestId
      });
      return true;
    }
    if (session.revokedAt) {
      if (session.replacedBySessionId) {
        await this.revokeFamilies(transaction, {
          userId: session.userId,
          familyIds: [session.familyId],
          requestId
        });
      }
      return true;
    }
    if (session.user.status !== "ACTIVE") {
      await this.revokeFamilies(transaction, {
        userId: session.userId,
        familyIds: [session.familyId],
        requestId
      });
      return true;
    }
    return false;
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
