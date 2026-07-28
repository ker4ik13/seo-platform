export interface S3Config {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle: boolean;
  readonly signedUrlTtlSeconds: number;
  readonly buckets: {
    readonly uploads?: string;
    readonly artifacts?: string;
  };
}

export interface EmailConfig {
  readonly enabled: boolean;
  readonly from?: string;
  readonly host?: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
}

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly redisUrl: string;
  readonly internalApiToken?: string;
  readonly nats: {
    readonly url: string;
    readonly user?: string;
    readonly password?: string;
  };
  readonly s3: S3Config;
  readonly email: EmailConfig;
  readonly uploads: {
    readonly maxSizeBytes: number;
    readonly partSizeBytes: number;
    readonly expiresHours: number;
  };
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected boolean, received: ${value}`);
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
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

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }

  const s3Enabled = bool(env.S3_ENABLED);
  const emailEnabled = bool(env.EMAIL_ENABLED);
  const natsUser = optional(env, "NATS_USER");
  const natsPassword = optional(env, "NATS_PASSWORD");
  const s3Endpoint = optional(env, "S3_ENDPOINT");
  const s3AccessKeyId = optional(env, "S3_ACCESS_KEY_ID");
  const s3SecretAccessKey = optional(env, "S3_SECRET_ACCESS_KEY");
  const uploadsBucket = optional(env, "S3_BUCKET_UPLOADS");
  const artifactsBucket = optional(env, "S3_BUCKET_ARTIFACTS");
  const emailFrom = optional(env, "EMAIL_FROM");
  const smtpHost = optional(env, "SMTP_HOST");
  const smtpUser = optional(env, "SMTP_USER");
  const smtpPassword = optional(env, "SMTP_PASSWORD");
  const internalApiToken = optional(env, "INTERNAL_API_TOKEN");

  if (
    s3Enabled &&
    (!s3AccessKeyId ||
      !s3SecretAccessKey ||
      !uploadsBucket ||
      !artifactsBucket)
  ) {
    throw new Error("S3 is enabled but credentials or buckets are incomplete");
  }

  if (
    emailEnabled &&
    (!emailFrom || !smtpHost || !smtpUser || !smtpPassword)
  ) {
    throw new Error("Email is enabled but SMTP configuration is incomplete");
  }
  if (
    nodeEnv === "production" &&
    (!internalApiToken || internalApiToken.length < 32)
  ) {
    throw new Error(
      "INTERNAL_API_TOKEN with at least 32 characters is required in production"
    );
  }

  return {
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    port: positiveInteger(env.PORT, 4002, "PORT"),
    version: optional(env, "SERVICE_VERSION") || "0.1.0",
    databaseUrl: required(env, "DATABASE_URL"),
    databasePoolMax: positiveInteger(
      env.DATABASE_POOL_MAX,
      20,
      "DATABASE_POOL_MAX"
    ),
    redisUrl: env.REDIS_URL?.trim() || "redis://localhost:6379",
    ...(internalApiToken ? { internalApiToken } : {}),
    nats: {
      url: env.NATS_URL?.trim() || "nats://localhost:4222",
      ...(natsUser ? { user: natsUser } : {}),
      ...(natsPassword ? { password: natsPassword } : {})
    },
    s3: {
      enabled: s3Enabled,
      ...(s3Endpoint ? { endpoint: s3Endpoint } : {}),
      region: env.S3_REGION?.trim() || "us-east-1",
      ...(s3AccessKeyId ? { accessKeyId: s3AccessKeyId } : {}),
      ...(s3SecretAccessKey ? { secretAccessKey: s3SecretAccessKey } : {}),
      forcePathStyle: bool(env.S3_FORCE_PATH_STYLE),
      signedUrlTtlSeconds: positiveInteger(
        env.S3_SIGNED_URL_TTL_SECONDS,
        900,
        "S3_SIGNED_URL_TTL_SECONDS"
      ),
      buckets: {
        ...(uploadsBucket ? { uploads: uploadsBucket } : {}),
        ...(artifactsBucket ? { artifacts: artifactsBucket } : {})
      }
    },
    email: {
      enabled: emailEnabled,
      ...(emailFrom ? { from: emailFrom } : {}),
      ...(smtpHost ? { host: smtpHost } : {}),
      port: positiveInteger(env.SMTP_PORT, 587, "SMTP_PORT"),
      secure: bool(env.SMTP_SECURE),
      ...(smtpUser ? { user: smtpUser } : {}),
      ...(smtpPassword ? { password: smtpPassword } : {})
    },
    uploads: {
      maxSizeBytes: positiveInteger(
        env.UPLOAD_MAX_SIZE_BYTES,
        5 * 1_024 * 1_024 * 1_024,
        "UPLOAD_MAX_SIZE_BYTES"
      ),
      partSizeBytes: positiveInteger(
        env.UPLOAD_PART_SIZE_BYTES,
        8 * 1_024 * 1_024,
        "UPLOAD_PART_SIZE_BYTES"
      ),
      expiresHours: positiveInteger(
        env.UPLOAD_EXPIRES_HOURS,
        24,
        "UPLOAD_EXPIRES_HOURS"
      )
    }
  };
}
