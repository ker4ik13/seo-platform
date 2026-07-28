export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly dependencyTimeoutMs: number;
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
    readonly sessionCookieName: string;
    readonly csrfCookieName: string;
    readonly sessionTtlDays: number;
    readonly emailVerificationRequired: boolean;
    readonly emailVerificationTtlMinutes: number;
    readonly cookieSecure: boolean;
    readonly passwordPepper?: string;
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

  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }

  if (nodeEnv === "production" && !passwordPepper) {
    throw new Error("AUTH_PASSWORD_PEPPER is required in production");
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
      sessionCookieName:
        env.AUTH_SESSION_COOKIE_NAME?.trim() || "seo_session",
      csrfCookieName: env.AUTH_CSRF_COOKIE_NAME?.trim() || "seo_csrf",
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
      cookieSecure: booleanValue(
        env.AUTH_COOKIE_SECURE,
        nodeEnv === "production",
        "AUTH_COOKIE_SECURE"
      ),
      ...(passwordPepper ? { passwordPepper } : {}),
      exposeDevelopmentTokens
    }
  };
}
