export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string;
  readonly locale: string;
  readonly timezone: string;
  readonly country?: string;
  readonly status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";
  readonly createdAt: string;
}

export interface SessionSummary {
  readonly id: string;
  readonly authenticatedAt: string;
  readonly accessExpiresAt: string;
  readonly expiresAt: string;
}

export interface UserSessionSummary extends SessionSummary {
  readonly current: boolean;
  readonly userAgent?: string;
  readonly ipAddress?: string;
  readonly lastUsedAt: string;
  readonly createdAt: string;
}

export interface AuthenticationResult {
  readonly user: UserSummary;
  readonly session?: SessionSummary;
  readonly emailVerificationRequired: boolean;
  readonly verificationTokenForDevelopment?: string;
}

export interface CurrentAccount {
  readonly user: UserSummary;
  readonly session: SessionSummary;
}

export interface RegisterAccountInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly country?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly termsVersion: string;
  readonly privacyVersion: string;
  readonly marketingAccepted?: boolean;
  readonly marketingVersion?: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface VerifyEmailInput {
  readonly token: string;
}

export interface ResendEmailVerificationInput {
  readonly email: string;
}

export interface RequestPasswordResetInput {
  readonly email: string;
}

export interface ResetPasswordInput {
  readonly token: string;
  readonly password: string;
}

export interface AcceptedOperation {
  readonly accepted: true;
  readonly verificationTokenForDevelopment?: string;
}

export interface PasswordResetAccepted {
  readonly accepted: true;
  readonly resetTokenForDevelopment?: string;
}
