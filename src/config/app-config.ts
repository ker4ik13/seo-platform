export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly dependencyTimeoutMs: number;
  readonly internalCommandTimeoutMs: number;
  readonly internalApiToken?: string;
  readonly integrationCredentialApiToken?: string;
  readonly realtimeNotificationApiToken?: string;
  readonly corsOrigins: readonly string[];
  readonly nats: {
    readonly url: string;
    readonly user?: string;
    readonly password?: string;
  };
  readonly services: {
    readonly seoData: string;
    readonly jobs: string;
    readonly realtime: string;
  };
  readonly auth: {
    readonly accessCookieName: string;
    readonly sessionCookieName: string;
    readonly csrfCookieName: string;
    readonly accessTokenTtlMinutes: number;
    readonly sessionTtlDays: number;
    readonly emailVerificationRequired: boolean;
    readonly emailVerificationTtlMinutes: number;
    readonly passwordResetTtlMinutes: number;
    readonly mfaChallengeTtlMinutes: number;
    readonly recentAuthenticationMinutes: number;
    readonly totpIssuer: string;
    readonly cookieSecure: boolean;
    readonly passwordPepper?: string;
    readonly dataEncryptionKey?: string;
    readonly exposeDevelopmentTokens: boolean;
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  key: string
): number {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return parsed;
}

function booleanValue(
  value: string | undefined,
  fallback: boolean,
  key: string
): boolean {
  if (value === undefined || value.trim() === "") return fallback;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  throw new Error(`${key} must be true or false`);
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const natsUser = env.NATS_USER?.trim();
  const natsPassword = env.NATS_PASSWORD?.trim();
  const passwordPepper = env.AUTH_PASSWORD_PEPPER?.trim();
  const dataEncryptionKey = env.AUTH_DATA_ENCRYPTION_KEY?.trim();
  const internalApiToken = env.INTERNAL_API_TOKEN?.trim();
  const integrationCredentialApiToken =
    env.PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN?.trim();
  const realtimeNotificationApiToken =
    env.PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN?.trim();

  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }

  if (nodeEnv === "production" && !passwordPepper) {
    throw new Error("AUTH_PASSWORD_PEPPER is required in production");
  }
  if (nodeEnv === "production" && !dataEncryptionKey) {
    throw new Error("AUTH_DATA_ENCRYPTION_KEY is required in production");
  }
  if (
    dataEncryptionKey &&
    (!/^[A-Za-z0-9_-]{43}$/u.test(dataEncryptionKey) ||
      Buffer.from(dataEncryptionKey, "base64url").length !== 32)
  ) {
    throw new Error(
      "AUTH_DATA_ENCRYPTION_KEY must be a Base64URL-encoded 32-byte key"
    );
  }
  if (
    nodeEnv === "production" &&
    (!internalApiToken || internalApiToken.length < 32)
  ) {
    throw new Error(
      "INTERNAL_API_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    nodeEnv === "production" &&
    (!integrationCredentialApiToken ||
      integrationCredentialApiToken.length < 32)
  ) {
    throw new Error(
      "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    nodeEnv === "production" &&
    (!realtimeNotificationApiToken ||
      realtimeNotificationApiToken.length < 32)
  ) {
    throw new Error(
      "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    internalApiToken &&
    integrationCredentialApiToken &&
    internalApiToken === integrationCredentialApiToken
  ) {
    throw new Error(
      "Credential API token must differ from the shared internal API token"
    );
  }
  const internalTokens = [
    internalApiToken,
    integrationCredentialApiToken,
    realtimeNotificationApiToken
  ].filter((value): value is string => Boolean(value));
  if (new Set(internalTokens).size !== internalTokens.length) {
    throw new Error("Every internal API token must be distinct");
  }

  const exposeDevelopmentTokens = booleanValue(
    env.AUTH_EXPOSE_DEVELOPMENT_TOKENS,
    nodeEnv !== "production",
    "AUTH_EXPOSE_DEVELOPMENT_TOKENS"
  );

  if (nodeEnv === "production" && exposeDevelopmentTokens) {
    throw new Error(
      "AUTH_EXPOSE_DEVELOPMENT_TOKENS cannot be enabled in production"
    );
  }

  return {
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    port: positiveInteger(env.PORT, 4000, "PORT"),
    version: env.SERVICE_VERSION?.trim() || "0.1.0",
    databaseUrl: required(env, "DATABASE_URL"),
    databasePoolMax: positiveInteger(
      env.DATABASE_POOL_MAX,
      10,
      "DATABASE_POOL_MAX"
    ),
    dependencyTimeoutMs: positiveInteger(
      env.INTERNAL_REQUEST_TIMEOUT_MS,
      1500,
      "INTERNAL_REQUEST_TIMEOUT_MS"
    ),
    internalCommandTimeoutMs: positiveInteger(
      env.INTERNAL_COMMAND_TIMEOUT_MS,
      15_000,
      "INTERNAL_COMMAND_TIMEOUT_MS"
    ),
    ...(internalApiToken ? { internalApiToken } : {}),
    ...(integrationCredentialApiToken
      ? { integrationCredentialApiToken }
      : {}),
    ...(realtimeNotificationApiToken
      ? { realtimeNotificationApiToken }
      : {}),
    corsOrigins: (env.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    nats: {
      url: env.NATS_URL?.trim() || "nats://localhost:4222",
      ...(natsUser ? { user: natsUser } : {}),
      ...(natsPassword ? { password: natsPassword } : {})
    },
    services: {
      seoData:
        env.SEO_DATA_INTERNAL_URL?.trim() || "http://localhost:4001",
      jobs: env.JOBS_INTERNAL_URL?.trim() || "http://localhost:4002",
      realtime:
        env.REALTIME_INTERNAL_URL?.trim() || "http://localhost:4003"
    },
    auth: {
      accessCookieName:
        env.AUTH_ACCESS_COOKIE_NAME?.trim() || "seo_access",
      sessionCookieName:
        env.AUTH_SESSION_COOKIE_NAME?.trim() || "seo_session",
      csrfCookieName: env.AUTH_CSRF_COOKIE_NAME?.trim() || "seo_csrf",
      accessTokenTtlMinutes: positiveInteger(
        env.AUTH_ACCESS_TOKEN_TTL_MINUTES,
        15,
        "AUTH_ACCESS_TOKEN_TTL_MINUTES"
      ),
      sessionTtlDays: positiveInteger(
        env.AUTH_SESSION_TTL_DAYS,
        30,
        "AUTH_SESSION_TTL_DAYS"
      ),
      emailVerificationRequired: booleanValue(
        env.AUTH_EMAIL_VERIFICATION_REQUIRED,
        nodeEnv === "production",
        "AUTH_EMAIL_VERIFICATION_REQUIRED"
      ),
      emailVerificationTtlMinutes: positiveInteger(
        env.AUTH_EMAIL_VERIFICATION_TTL_MINUTES,
        30,
        "AUTH_EMAIL_VERIFICATION_TTL_MINUTES"
      ),
      passwordResetTtlMinutes: positiveInteger(
        env.AUTH_PASSWORD_RESET_TTL_MINUTES,
        30,
        "AUTH_PASSWORD_RESET_TTL_MINUTES"
      ),
      mfaChallengeTtlMinutes: positiveInteger(
        env.AUTH_MFA_CHALLENGE_TTL_MINUTES,
        5,
        "AUTH_MFA_CHALLENGE_TTL_MINUTES"
      ),
      recentAuthenticationMinutes: positiveInteger(
        env.AUTH_RECENT_AUTHENTICATION_MINUTES,
        10,
        "AUTH_RECENT_AUTHENTICATION_MINUTES"
      ),
      totpIssuer: env.AUTH_TOTP_ISSUER?.trim() || "SEO Workspace",
      cookieSecure: booleanValue(
        env.AUTH_COOKIE_SECURE,
        nodeEnv === "production",
        "AUTH_COOKIE_SECURE"
      ),
      ...(passwordPepper ? { passwordPepper } : {}),
      ...(dataEncryptionKey ? { dataEncryptionKey } : {}),
      exposeDevelopmentTokens
    }
  };
}
