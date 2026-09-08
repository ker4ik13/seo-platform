export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string;
  readonly locale: string;
  readonly timezone: string;
  readonly country?: string;
  readonly avatarUpdatedAt?: string;
  readonly status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";
  readonly createdAt: string;
}

export interface UpdateUserPreferencesInput { readonly locale: "ru" | "en" }

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

export interface UserSessionListQuery {
  readonly limit: number;
  readonly cursor?: string;
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

export interface MfaChallengeResult {
  readonly mfaRequired: true;
  readonly challengeToken: string;
  readonly methods: readonly ("TOTP" | "RECOVERY_CODE")[];
  readonly expiresAt: string;
}

export type LoginResult = AuthenticationResult | MfaChallengeResult;

export interface VerifyMfaChallengeInput {
  readonly challengeToken: string;
  readonly code: string;
}

export interface MfaOverview {
  readonly totp?: {
    readonly id: string;
    readonly status: "ACTIVE";
    readonly confirmedAt: string;
    readonly lastUsedAt?: string;
  };
  readonly remainingRecoveryCodes: number;
}

export interface TotpSetupResult {
  readonly methodId: string;
  readonly secret: string;
  readonly otpauthUri: string;
}

export interface ConfirmTotpInput {
  readonly methodId: string;
  readonly code: string;
}

export interface ConfirmTotpResult {
  readonly enabled: true;
  readonly recoveryCodes: readonly string[];
}

export interface DisableTotpInput {
  readonly password: string;
  readonly code: string;
}

export interface DisableTotpResult {
  readonly disabled: true;
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
