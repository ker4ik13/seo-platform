import { Inject, Injectable } from "@nestjs/common";
import {
  domainEventTypes,
  type AuthenticationResult,
  type ConfirmTotpInput,
  type ConfirmTotpResult,
  type DisableTotpInput,
  type DisableTotpResult,
  type MfaChallengeResult,
  type MfaOverview,
  type TotpSetupResult,
  type VerifyMfaChallengeInput
} from "@seo-platform/contracts";
import type {
  MfaMethod,
  Prisma,
  User
} from "../generated/prisma/client.js";
import { AuditService } from "../audit/audit.service.js";
import { DomainError } from "../common/domain-error.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { AuthCryptoService } from "./auth-crypto.service.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { toSessionSummary, toUserSummary } from "./identity.mapper.js";
import type {
  AuthenticatedPrincipal,
  RequestContext,
  SessionCredentials
} from "./identity.types.js";
import { SessionService } from "./session.service.js";
import {
  createRecoveryCode,
  createTotpSecret,
  matchTotp,
  normalizeRecoveryCode
} from "./totp.js";
import { RecentAuthenticationService } from "./recent-authentication.service.js";

type Transaction = Prisma.TransactionClient;

interface SecondFactorMatch {
  readonly method: "TOTP" | "RECOVERY_CODE";
  readonly id: string;
  readonly counter?: bigint;
}

export interface MfaAuthenticationCommandResult {
  readonly response: AuthenticationResult;
  readonly credentials: SessionCredentials;
}

@Injectable()
export class MfaService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly recentAuthentication: RecentAuthenticationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async createLoginChallenge(
    transaction: Transaction,
    user: User,
    context: RequestContext
  ): Promise<MfaChallengeResult | undefined> {
    const method = await transaction.mfaMethod.findFirst({
      where: {
        userId: user.id,
        type: "TOTP",
        status: "ACTIVE"
      },
      select: { id: true }
    });
    if (!method) return undefined;

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.auth.mfaChallengeTtlMinutes * 60 * 1_000
    );
    const challengeToken = this.crypto.randomToken();
    await transaction.mfaChallenge.updateMany({
      where: {
        userId: user.id,
        consumedAt: null,
        expiresAt: { gt: now }
      },
      data: { consumedAt: now }
    });
    await transaction.mfaChallenge.create({
      data: {
        userId: user.id,
        tokenHash: this.crypto.hashOpaqueToken(challengeToken),
        expiresAt,
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {})
      }
    });
    return {
      mfaRequired: true,
      challengeToken,
      methods: ["TOTP", "RECOVERY_CODE"],
      expiresAt: expiresAt.toISOString()
    };
  }

  public async verifyLoginChallenge(
    input: VerifyMfaChallengeInput,
    context: RequestContext
  ): Promise<MfaAuthenticationCommandResult> {
    const tokenHash = this.crypto.hashOpaqueToken(input.challengeToken);
    await this.rateLimits.consume("MFA_VERIFY", [
      `ip:${context.ipAddress ?? "unknown"}`,
      `challenge:${tokenHash}`
    ]);

    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { tokenHash },
      include: { user: true }
    });
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date() ||
      challenge.attemptCount >= 5 ||
      challenge.user.status !== "ACTIVE"
    ) {
      throw this.invalidSecondFactor();
    }

    const factor = await this.findSecondFactor(
      challenge.userId,
      input.code
    );
    if (!factor) {
      await this.recordFailedChallenge(challenge.id, challenge.userId, context);
      throw this.invalidSecondFactor();
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.mfaChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attemptCount: { lt: 5 }
        },
        data: { consumedAt: new Date() }
      });
      if (consumed.count !== 1) throw this.invalidSecondFactor();
      await this.consumeSecondFactor(transaction, factor);
      const session = await this.sessions.issue(
        transaction,
        challenge.userId,
        context
      );
      await this.audit.record(
        {
          actorId: challenge.userId,
          action: "identity.mfa.challenge_verified",
          resourceType: "session",
          resourceId: session.session.id,
          requestId: context.requestId
        },
        transaction
      );
      return session;
    });

    return {
      response: {
        user: toUserSummary(challenge.user),
        session: toSessionSummary(result.session),
        emailVerificationRequired: false
      },
      credentials: result.credentials
    };
  }

  public async overview(
    principal: AuthenticatedPrincipal
  ): Promise<MfaOverview> {
    const [totp, remainingRecoveryCodes] = await Promise.all([
      this.prisma.mfaMethod.findFirst({
        where: {
          userId: principal.userId,
          type: "TOTP",
          status: "ACTIVE"
        },
        orderBy: { confirmedAt: "desc" }
      }),
      this.prisma.recoveryCode.count({
        where: {
          userId: principal.userId,
          usedAt: null
        }
      })
    ]);
    return {
      ...(totp?.confirmedAt
        ? {
            totp: {
              id: totp.id,
              status: "ACTIVE" as const,
              confirmedAt: totp.confirmedAt.toISOString(),
              ...(totp.lastUsedAt
                ? { lastUsedAt: totp.lastUsedAt.toISOString() }
                : {})
            }
          }
        : {}),
      remainingRecoveryCodes
    };
  }

  public async setupTotp(
    principal: AuthenticatedPrincipal,
    context: RequestContext
  ): Promise<TotpSetupResult> {
    this.recentAuthentication.assert(principal);
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId }
    });
    if (!user || user.status !== "ACTIVE") throw this.invalidSecondFactor();
    const activeMethod = await this.prisma.mfaMethod.findFirst({
      where: {
        userId: principal.userId,
        type: "TOTP",
        status: "ACTIVE"
      },
      select: { id: true }
    });
    if (activeMethod) {
      throw new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "Disable the current TOTP method before replacing it"
      });
    }

    const secret = createTotpSecret();
    const method = await this.prisma.$transaction(async (transaction) => {
      await transaction.mfaMethod.updateMany({
        where: {
          userId: principal.userId,
          type: "TOTP",
          status: "PENDING"
        },
        data: {
          status: "DISABLED",
          disabledAt: new Date()
        }
      });
      const created = await transaction.mfaMethod.create({
        data: {
          userId: principal.userId,
          type: "TOTP",
          secretEncrypted: this.crypto.encryptMfaSecret(secret)
        }
      });
      await this.audit.record(
        {
          actorId: principal.userId,
          action: "identity.mfa.totp_setup_started",
          resourceType: "mfa_method",
          resourceId: created.id,
          requestId: context.requestId
        },
        transaction
      );
      return created;
    });

    return {
      methodId: method.id,
      secret,
      otpauthUri: this.otpauthUri(user.emailDisplay, secret)
    };
  }

  public async confirmTotp(
    principal: AuthenticatedPrincipal,
    input: ConfirmTotpInput,
    context: RequestContext
  ): Promise<ConfirmTotpResult> {
    this.recentAuthentication.assert(principal);
    const method = await this.prisma.mfaMethod.findFirst({
      where: {
        id: input.methodId,
        userId: principal.userId,
        type: "TOTP",
        status: "PENDING"
      }
    });
    if (!method) throw this.invalidSecondFactor();
    const match = this.matchMethod(method, input.code);
    if (!match) throw this.invalidSecondFactor();

    const recoveryCodes = Array.from(
      { length: 10 },
      () => createRecoveryCode()
    );
    await this.prisma.$transaction(async (transaction) => {
      await transaction.mfaMethod.updateMany({
        where: {
          userId: principal.userId,
          type: "TOTP",
          status: "ACTIVE"
        },
        data: {
          status: "DISABLED",
          disabledAt: new Date()
        }
      });
      const activated = await transaction.mfaMethod.updateMany({
        where: {
          id: method.id,
          userId: principal.userId,
          status: "PENDING"
        },
        data: {
          status: "ACTIVE",
          confirmedAt: new Date(),
          lastUsedAt: new Date(),
          lastUsedCounter: match.counter
        }
      });
      if (activated.count !== 1) throw this.invalidSecondFactor();
      await transaction.recoveryCode.deleteMany({
        where: { userId: principal.userId }
      });
      await transaction.recoveryCode.createMany({
        data: recoveryCodes.map((code) => ({
          userId: principal.userId,
          codeHash: this.crypto.hashOpaqueToken(normalizeRecoveryCode(code))
        }))
      });
      const user = await transaction.user.update({
        where: { id: principal.userId },
        data: { version: { increment: 1 } }
      });
      await this.audit.record(
        {
          actorId: principal.userId,
          action: "identity.mfa.enabled",
          resourceType: "mfa_method",
          resourceId: method.id,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.userEvent(transaction, {
        eventType: domainEventTypes.userMfaEnabled,
        user,
        payload: {
          userId: user.id,
          method: "TOTP"
        },
        requestId: context.requestId
      });
    });

    return {
      enabled: true,
      recoveryCodes
    };
  }

  public async disableTotp(
    principal: AuthenticatedPrincipal,
    input: DisableTotpInput,
    context: RequestContext
  ): Promise<DisableTotpResult> {
    this.recentAuthentication.assert(principal);
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId }
    });
    const passwordValid = await this.crypto.verifyPassword(
      input.password,
      user?.passwordHash
    );
    if (!user || !passwordValid || user.status !== "ACTIVE") {
      throw new DomainError({
        statusCode: 401,
        code: "REAUTHENTICATION_REQUIRED",
        message: "Current password and second factor are required"
      });
    }
    const factor = await this.findSecondFactor(user.id, input.code);
    if (!factor) throw this.invalidSecondFactor();

    await this.prisma.$transaction(async (transaction) => {
      await this.consumeSecondFactor(transaction, factor);
      const disabled = await transaction.mfaMethod.updateMany({
        where: {
          userId: user.id,
          type: "TOTP",
          status: "ACTIVE"
        },
        data: {
          status: "DISABLED",
          disabledAt: new Date()
        }
      });
      if (disabled.count !== 1) throw this.invalidSecondFactor();
      await transaction.recoveryCode.deleteMany({
        where: { userId: user.id }
      });
      await transaction.session.updateMany({
        where: {
          userId: user.id,
          id: { not: principal.sessionId },
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
      const updatedUser = await transaction.user.update({
        where: { id: user.id },
        data: { version: { increment: 1 } }
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: "identity.mfa.disabled",
          resourceType: "mfa_method",
          ...(factor.method === "TOTP" ? { resourceId: factor.id } : {}),
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.userEvent(transaction, {
        eventType: domainEventTypes.userMfaDisabled,
        user: updatedUser,
        payload: {
          userId: user.id,
          method: "TOTP"
        },
        requestId: context.requestId
      });
    });
    return { disabled: true };
  }

  private async findSecondFactor(
    userId: string,
    code: string
  ): Promise<SecondFactorMatch | undefined> {
    if (/^\d{6}$/u.test(code.trim())) {
      const method = await this.prisma.mfaMethod.findFirst({
        where: {
          userId,
          type: "TOTP",
          status: "ACTIVE"
        }
      });
      if (!method) return undefined;
      const match = this.matchMethod(method, code.trim());
      return match
        ? { method: "TOTP", id: method.id, counter: match.counter }
        : undefined;
    }

    const normalized = normalizeRecoveryCode(code);
    if (normalized.length !== 16) return undefined;
    const recoveryCode = await this.prisma.recoveryCode.findUnique({
      where: {
        userId_codeHash: {
          userId,
          codeHash: this.crypto.hashOpaqueToken(normalized)
        }
      }
    });
    return recoveryCode && !recoveryCode.usedAt
      ? { method: "RECOVERY_CODE", id: recoveryCode.id }
      : undefined;
  }

  private matchMethod(
    method: MfaMethod,
    code: string
  ): ReturnType<typeof matchTotp> {
    return matchTotp(
      this.crypto.decryptMfaSecret(method.secretEncrypted),
      code.trim(),
      Date.now(),
      1,
      method.lastUsedCounter
    );
  }

  private async consumeSecondFactor(
    transaction: Transaction,
    factor: SecondFactorMatch
  ): Promise<void> {
    if (factor.method === "RECOVERY_CODE") {
      const used = await transaction.recoveryCode.updateMany({
        where: {
          id: factor.id,
          usedAt: null
        },
        data: { usedAt: new Date() }
      });
      if (used.count !== 1) throw this.invalidSecondFactor();
      return;
    }
    const counter = factor.counter;
    if (counter === undefined) throw this.invalidSecondFactor();
    const used = await transaction.mfaMethod.updateMany({
      where: {
        id: factor.id,
        status: "ACTIVE",
        OR: [
          { lastUsedCounter: null },
          { lastUsedCounter: { lt: counter } }
        ]
      },
      data: {
        lastUsedCounter: counter,
        lastUsedAt: new Date()
      }
    });
    if (used.count !== 1) throw this.invalidSecondFactor();
  }

  private async recordFailedChallenge(
    challengeId: string,
    userId: string,
    context: RequestContext
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.mfaChallenge.updateMany({
        where: {
          id: challengeId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attemptCount: { lt: 5 }
        },
        data: { attemptCount: { increment: 1 } }
      });
      if (updated.count === 1) {
        const challenge = await transaction.mfaChallenge.findUnique({
          where: { id: challengeId },
          select: { attemptCount: true }
        });
        if (challenge && challenge.attemptCount >= 5) {
          await transaction.mfaChallenge.updateMany({
            where: { id: challengeId, consumedAt: null },
            data: { consumedAt: new Date() }
          });
        }
      }
      if (updated.count === 1) {
        await this.audit.record(
          {
            actorId: userId,
            action: "identity.mfa.challenge_failed",
            resourceType: "mfa_challenge",
            resourceId: challengeId,
            outcome: "DENIED",
            reason: "INVALID_SECOND_FACTOR",
            requestId: context.requestId
          },
          transaction
        );
      }
    });
  }

  private otpauthUri(email: string, secret: string): string {
    const issuer = this.config.auth.totpIssuer;
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
    const query = new URLSearchParams({
      secret,
      issuer,
      algorithm: "SHA1",
      digits: "6",
      period: "30"
    });
    return `otpauth://totp/${label}?${query.toString()}`;
  }

  private invalidSecondFactor(): DomainError {
    return new DomainError({
      statusCode: 401,
      code: "UNAUTHENTICATED",
      message: "Invalid or expired second factor"
    });
  }
}
