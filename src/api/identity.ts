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
  readonly expiresAt: string;
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
