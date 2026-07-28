import { Inject, Injectable } from "@nestjs/common";
import {
  domainEventTypes,
  type AcceptedOperation,
  type AuthenticationResult,
  type LoginInput,
  type PasswordResetAccepted,
  type RegisterAccountInput,
  type RequestPasswordResetInput,
  type ResendEmailVerificationInput,
  type ResetPasswordInput,
  type VerifyEmailInput
} from "@seo-platform/contracts";
import type { Prisma, User } from "../generated/prisma/client.js";
import { AuditService } from "../audit/audit.service.js";
import { DomainError, isUniqueConstraintError } from "../common/domain-error.js";
import {
  normalizeCountry,
  normalizeEmail,
  normalizeLocale,
  normalizeTimezone
} from "../common/normalization.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { unauthenticatedError } from "./auth-errors.js";
import { AuthCryptoService } from "./auth-crypto.service.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { toSessionSummary, toUserSummary } from "./identity.mapper.js";
import type {
  RequestContext,
  SessionCredentials
} from "./identity.types.js";
import { SessionService } from "./session.service.js";

type Transaction = Prisma.TransactionClient;

export interface AuthenticationCommandResult {
  readonly response: AuthenticationResult;
  readonly credentials?: SessionCredentials;
}
export interface AcceptedCommandResult {
  readonly response: AcceptedOperation;
}
export interface PasswordResetRequestCommandResult {
  readonly response: PasswordResetAccepted;
}

@Injectable()
export class IdentityService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async register(
    input: RegisterAccountInput,
    context: RequestContext
  ): Promise<AuthenticationCommandResult> {
    const email = normalizeEmail(input.email);
    await this.rateLimits.consume("REGISTER", [
      `ip:${context.ipAddress ?? "unknown"}`,
      `email:${email}`
    ]);

    const passwordHash = await this.crypto.hashPassword(input.password);
    const now = new Date();
    const requiresVerification = this.config.auth.emailVerificationRequired;
    const country = normalizeCountry(input.country);

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            emailNormalized: email,
            emailDisplay: input.email.trim(),
            emailVerifiedAt: requiresVerification ? null : now,
            passwordHash,
            displayName: input.displayName.trim(),
            locale: normalizeLocale(input.locale),
            timezone: normalizeTimezone(input.timezone),
            ...(country ? { country } : {}),
            status: requiresVerification
              ? "PENDING_VERIFICATION"
              : "ACTIVE",
            consents: {
              create: [
                this.consent(
                  "TERMS",
                  input.termsVersion,
                  true,
                  context
                ),
                this.consent(
                  "PRIVACY",
                  input.privacyVersion,
                  true,
                  context
                ),
                ...(input.marketingAccepted === undefined
                  ? []
                  : [
                      this.consent(
                        "MARKETING",
                        input.marketingVersion ?? "unspecified",
                        input.marketingAccepted,
                        context
                      )
                    ])
              ]
            }
          }
        });

        await this.audit.record(
          {
            actorId: user.id,
            action: "identity.user.registered",
            resourceType: "user",
            resourceId: user.id,
            requestId: context.requestId
          },
          transaction
        );
        await this.outbox.userEvent(transaction, {
          eventType: domainEventTypes.userCreated,
          user,
          payload: {
            userId: user.id,
            locale: user.locale,
            country: user.country
          },
          requestId: context.requestId
        });

        if (requiresVerification) {
          const verificationToken = await this.createVerificationToken(
            transaction,
            user,
            context
          );
          return { user, verificationToken };
        }

        const session = await this.sessions.issue(
          transaction,
          user.id,
          context
        );
        return { user, session };
      });

      return {
        response: {
          user: toUserSummary(result.user),
          ...(result.session
            ? { session: toSessionSummary(result.session.session) }
            : {}),
          emailVerificationRequired: requiresVerification,
          ...(requiresVerification &&
            this.config.auth.exposeDevelopmentTokens &&
            result.verificationToken
            ? {
                verificationTokenForDevelopment: result.verificationToken
              }
            : {})
        },
        ...(result.session ? { credentials: result.session.credentials } : {})
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DomainError({
          statusCode: 409,
          code: "DUPLICATE",
          message: "An account with this email already exists"
        });
      }
      throw error;
    }
  }

  public async login(
    input: LoginInput,
    context: RequestContext
  ): Promise<AuthenticationCommandResult> {
    const email = normalizeEmail(input.email);
    await this.rateLimits.consume("LOGIN", [
      `ip:${context.ipAddress ?? "unknown"}`,
      `email:${email}`
    ]);

    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: email }
    });
    const passwordValid = await this.crypto.verifyPassword(
      input.password,
      user?.passwordHash
    );

    if (!user || !passwordValid || user.status === "DELETED") {
      await this.audit.record({
        action: "identity.login.failed",
        resourceType: "user",
        ...(user ? { resourceId: user.id } : {}),
        outcome: "DENIED",
        reason: "INVALID_CREDENTIALS",
        requestId: context.requestId
      });
      throw unauthenticatedError();
    }

    if (user.status === "PENDING_VERIFICATION") {
      throw new DomainError({
        statusCode: 403,
        code: "RESOURCE_STATE_CONFLICT",
        message: "Email verification is required"
      });
    }
    if (user.status !== "ACTIVE") {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Account access is unavailable"
      });
    }

    const issued = await this.prisma.$transaction(async (transaction) => {
      const session = await this.sessions.issue(transaction, user.id, context);
      await this.audit.record(
        {
          actorId: user.id,
          action: "identity.login.succeeded",
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
        user: toUserSummary(user),
        session: toSessionSummary(issued.session),
        emailVerificationRequired: false
      },
      credentials: issued.credentials
    };
  }

  public async verifyEmail(
    input: VerifyEmailInput,
    context: RequestContext
  ): Promise<AuthenticationCommandResult> {
    const tokenHash = this.crypto.hashOpaqueToken(input.token);
    await this.rateLimits.consume("VERIFY", [
      `ip:${context.ipAddress ?? "unknown"}`,
      `token:${tokenHash}`
    ]);

    const record = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash },
      include: { user: true }
    });
    if (
      !record ||
      record.purpose !== "EMAIL_VERIFICATION" ||
      record.consumedAt ||
      record.expiresAt <= new Date() ||
      record.user.status !== "PENDING_VERIFICATION"
    ) {
      throw new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "Verification link is invalid or expired"
      });
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.oneTimeToken.updateMany({
        where: {
          id: record.id,
          consumedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { consumedAt: new Date() }
      });
      if (consumed.count !== 1) {
        throw new DomainError({
          statusCode: 409,
          code: "RESOURCE_STATE_CONFLICT",
          message: "Verification link is invalid or expired"
        });
      }

      const user = await transaction.user.update({
        where: { id: record.userId },
        data: {
          emailVerifiedAt: new Date(),
          status: "ACTIVE",
          version: { increment: 1 }
        }
      });
      await transaction.oneTimeToken.updateMany({
        where: {
          userId: user.id,
          purpose: "EMAIL_VERIFICATION",
          consumedAt: null
        },
        data: { consumedAt: new Date() }
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: "identity.email.verified",
          resourceType: "user",
          resourceId: user.id,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.userEvent(transaction, {
        eventType: domainEventTypes.userEmailVerified,
        user,
        payload: { userId: user.id },
        requestId: context.requestId
      });
      const session = await this.sessions.issue(transaction, user.id, context);
      return { user, session };
    });

    return {
      response: {
        user: toUserSummary(result.user),
        session: toSessionSummary(result.session.session),
        emailVerificationRequired: false
      },
      credentials: result.session.credentials
    };
  }

  public async resendVerification(
    input: ResendEmailVerificationInput,
    context: RequestContext
  ): Promise<AcceptedCommandResult> {
    const email = normalizeEmail(input.email);
    await this.rateLimits.consume("RESEND", [
      `ip:${context.ipAddress ?? "unknown"}`,
      `email:${email}`
    ]);

    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: email }
    });
    if (!user || user.status !== "PENDING_VERIFICATION") {
      return { response: { accepted: true } };
    }

    const verificationToken = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.oneTimeToken.updateMany({
          where: {
            userId: user.id,
            purpose: "EMAIL_VERIFICATION",
            consumedAt: null
          },
          data: { consumedAt: new Date() }
        });
        const token = await this.createVerificationToken(
          transaction,
          user,
          context
        );
        await this.audit.record(
          {
            actorId: user.id,
            action: "identity.email.verification_resent",
            resourceType: "user",
            resourceId: user.id,
            requestId: context.requestId
          },
          transaction
        );
        return token;
      }
    );

    return {
      response: {
        accepted: true,
        ...(this.config.auth.exposeDevelopmentTokens
          ? { verificationTokenForDevelopment: verificationToken }
          : {})
      }
    };
  }

  public async requestPasswordReset(
    input: RequestPasswordResetInput,
    context: RequestContext
  ): Promise<PasswordResetRequestCommandResult> {
    const email = normalizeEmail(input.email);
    await this.rateLimits.consume("PASSWORD_RESET_REQUEST", [
      `ip:${context.ipAddress ?? "unknown"}`,
      `email:${email}`
    ]);

    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: email }
    });
    if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
      return { response: { accepted: true } };
    }

    const resetToken = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.oneTimeToken.updateMany({
          where: {
            userId: user.id,
            purpose: "PASSWORD_RESET",
            consumedAt: null
          },
          data: { consumedAt: new Date() }
        });
        const token = await this.createPasswordResetToken(
          transaction,
          user,
          context
        );
        await this.audit.record(
          {
            actorId: user.id,
            action: "identity.password.reset_requested",
            resourceType: "user",
            resourceId: user.id,
            requestId: context.requestId
          },
          transaction
        );
        return token;
      }
    );

    return {
      response: {
        accepted: true,
        ...(this.config.auth.exposeDevelopmentTokens
          ? { resetTokenForDevelopment: resetToken }
          : {})
      }
    };
  }

  public async resetPassword(
    input: ResetPasswordInput,
    context: RequestContext
  ): Promise<AuthenticationCommandResult> {
    const tokenHash = this.crypto.hashOpaqueToken(input.token);
    await this.rateLimits.consume("PASSWORD_RESET", [
      `ip:${context.ipAddress ?? "unknown"}`,
      `token:${tokenHash}`
    ]);

    const record = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash },
      include: { user: true }
    });
    if (
      !record ||
      record.purpose !== "PASSWORD_RESET" ||
      record.consumedAt ||
      record.expiresAt <= new Date() ||
      record.user.status !== "ACTIVE" ||
      !record.user.emailVerifiedAt
    ) {
      throw this.invalidPasswordResetToken();
    }

    const passwordHash = await this.crypto.hashPassword(input.password);
    const result = await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.oneTimeToken.updateMany({
        where: {
          id: record.id,
          consumedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { consumedAt: new Date() }
      });
      if (consumed.count !== 1) {
        throw this.invalidPasswordResetToken();
      }

      const user = await transaction.user.update({
        where: {
          id: record.userId,
          status: "ACTIVE"
        },
        data: {
          passwordHash,
          version: { increment: 1 }
        }
      });
      await transaction.oneTimeToken.updateMany({
        where: {
          userId: user.id,
          purpose: "PASSWORD_RESET",
          consumedAt: null
        },
        data: { consumedAt: new Date() }
      });
      await transaction.session.updateMany({
        where: {
          userId: user.id,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: "identity.password.changed_via_reset",
          resourceType: "user",
          resourceId: user.id,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.userEvent(transaction, {
        eventType: domainEventTypes.userPasswordChanged,
        user,
        payload: {
          userId: user.id,
          method: "PASSWORD_RESET"
        },
        requestId: context.requestId
      });
      const session = await this.sessions.issue(transaction, user.id, context);
      return { user, session };
    });

    return {
      response: {
        user: toUserSummary(result.user),
        session: toSessionSummary(result.session.session),
        emailVerificationRequired: false
      },
      credentials: result.session.credentials
    };
  }

  private async createVerificationToken(
    transaction: Transaction,
    user: User,
    context: RequestContext
  ): Promise<string> {
    const expiresAt = new Date(
      Date.now() +
        this.config.auth.emailVerificationTtlMinutes * 60 * 1_000
    );
    const record = await transaction.oneTimeToken.create({
      data: {
        userId: user.id,
        purpose: "EMAIL_VERIFICATION",
        tokenHash: this.crypto.hashOpaqueToken(this.crypto.randomToken()),
        expiresAt
      }
    });
    const token = this.crypto.emailVerificationToken(
      record.id,
      user.id,
      expiresAt
    );
    await transaction.oneTimeToken.update({
      where: { id: record.id },
      data: { tokenHash: this.crypto.hashOpaqueToken(token) }
    });
    await this.outbox.userEvent(transaction, {
      eventType: domainEventTypes.emailVerificationRequested,
      user,
      payload: {
        userId: user.id,
        oneTimeTokenId: record.id,
        locale: user.locale,
        expiresAt: expiresAt.toISOString()
      },
      requestId: context.requestId
    });
    return token;
  }

  private async createPasswordResetToken(
    transaction: Transaction,
    user: User,
    context: RequestContext
  ): Promise<string> {
    const expiresAt = new Date(
      Date.now() + this.config.auth.passwordResetTtlMinutes * 60 * 1_000
    );
    const record = await transaction.oneTimeToken.create({
      data: {
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: this.crypto.hashOpaqueToken(this.crypto.randomToken()),
        expiresAt
      }
    });
    const token = this.crypto.passwordResetToken(
      record.id,
      user.id,
      expiresAt
    );
    await transaction.oneTimeToken.update({
      where: { id: record.id },
      data: { tokenHash: this.crypto.hashOpaqueToken(token) }
    });
    await this.outbox.userEvent(transaction, {
      eventType: domainEventTypes.passwordResetRequested,
      user,
      payload: {
        userId: user.id,
        oneTimeTokenId: record.id,
        locale: user.locale,
        expiresAt: expiresAt.toISOString()
      },
      requestId: context.requestId
    });
    return token;
  }

  private invalidPasswordResetToken(): DomainError {
    return new DomainError({
      statusCode: 409,
      code: "RESOURCE_STATE_CONFLICT",
      message: "Password reset link is invalid or expired"
    });
  }

  private consent(
    type: "TERMS" | "PRIVACY" | "MARKETING",
    documentVersion: string,
    accepted: boolean,
    context: RequestContext
  ): Prisma.UserConsentCreateWithoutUserInput {
    return {
      type,
      documentVersion,
      accepted,
      source: "REGISTRATION",
      ...(context.ipAddress ? { ipAddress: context.ipAddress } : {})
    };
  }
}
