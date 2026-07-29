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

export interface MalwareScannerConfig {
  readonly enabled: boolean;
  readonly host?: string;
  readonly port: number;
  readonly connectTimeoutMs: number;
  readonly scanTimeoutMs: number;
}

export type IntegrationCredentialRole =
  | "DISABLED"
  | "MANAGEMENT"
  | "EXECUTION";

export interface IntegrationCredentialEncryptionConfig {
  readonly enabled: boolean;
  readonly role: IntegrationCredentialRole;
  readonly keys: ReadonlyMap<number, Buffer>;
  readonly activeKeyVersion?: number;
  readonly fingerprintKeys: ReadonlyMap<number, Buffer>;
  readonly activeFingerprintKeyVersion?: number;
}

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly redisUrl: string;
  readonly internalApiToken?: string;
  readonly integrationCredentialApiToken?: string;
  readonly internalCommandTimeoutMs: number;
  readonly services: {
    readonly seoData: string;
  };
  readonly nats: {
    readonly url: string;
    readonly user?: string;
    readonly password?: string;
  };
  readonly s3: S3Config;
  readonly email: EmailConfig;
  readonly malwareScanner: MalwareScannerConfig;
  readonly integrationCredentials: IntegrationCredentialEncryptionConfig;
  readonly integrationCredentialValidation: {
    readonly timeoutMs: number;
    readonly leaseSeconds: number;
    readonly dispatchSeconds: number;
    readonly concurrency: number;
  };
  readonly uploads: {
    readonly maxSizeBytes: number;
    readonly partSizeBytes: number;
    readonly expiresHours: number;
    readonly inspectionLeaseMinutes: number;
    readonly inspectionDispatchSeconds: number;
    readonly inspectionHeartbeatSeconds: number;
    readonly inspectionConcurrency: number;
  };
  readonly imports: {
    readonly parseLeaseMinutes: number;
    readonly parseDispatchSeconds: number;
    readonly parseHeartbeatSeconds: number;
    readonly parseConcurrency: number;
    readonly stagingBatchRows: number;
    readonly previewRows: number;
    readonly publishBatchRows: number;
  };
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected boolean, received: ${value}`);
}

function integrationCredentialRole(
  env: NodeJS.ProcessEnv
): IntegrationCredentialRole {
  const configured = env.INTEGRATION_CREDENTIAL_ROLE?.trim().toUpperCase();
  if (
    configured !== undefined &&
    !["DISABLED", "MANAGEMENT", "EXECUTION"].includes(configured)
  ) {
    throw new Error(
      "INTEGRATION_CREDENTIAL_ROLE must be DISABLED, MANAGEMENT or EXECUTION"
    );
  }
  const legacyEnabled =
    env.INTEGRATION_CREDENTIALS_ENABLED === undefined
      ? undefined
      : bool(env.INTEGRATION_CREDENTIALS_ENABLED);
  const role =
    (configured as IntegrationCredentialRole | undefined) ??
    (legacyEnabled ? "MANAGEMENT" : "DISABLED");
  if (
    legacyEnabled !== undefined &&
    legacyEnabled !== (role !== "DISABLED")
  ) {
    throw new Error(
      "INTEGRATION_CREDENTIAL_ROLE conflicts with INTEGRATION_CREDENTIALS_ENABLED"
    );
  }
  return role;
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
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  key: string,
  minimum: number,
  maximum: number
): number {
  const parsed = positiveInteger(value, fallback, key);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(
      `${key} must be between ${minimum} and ${maximum}`
    );
  }
  return parsed;
}

function versionedKeyring(
  value: string | undefined,
  environmentVariable: string
): ReadonlyMap<number, Buffer> {
  const keys = new Map<number, Buffer>();
  if (!value?.trim()) return keys;

  for (const entry of value.split(",")) {
    const match = /^([1-9]\d*):([A-Za-z0-9_-]{43})$/u.exec(entry.trim());
    if (!match?.[1] || !match[2]) {
      throw new Error(
        `${environmentVariable} must use version:base64url entries`
      );
    }
    const version = Number.parseInt(match[1], 10);
    const key = Buffer.from(match[2], "base64url");
    if (
      !Number.isSafeInteger(version) ||
      version > 2_147_483_647 ||
      key.length !== 32 ||
      keys.has(version) ||
      [...keys.values()].some((existing) => existing.equals(key))
    ) {
      throw new Error(
        `${environmentVariable} must contain unique 32-byte keys`
      );
    }
    keys.set(version, key);
  }
  return keys;
}

function keyVersion(
  value: string,
  environmentVariable: string
): number {
  const version = Number(value);
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 2_147_483_647
  ) {
    throw new Error(
      `${environmentVariable} must be a positive PostgreSQL integer`
    );
  }
  return version;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }

  const s3Enabled = bool(env.S3_ENABLED);
  const emailEnabled = bool(env.EMAIL_ENABLED);
  const malwareScannerEnabled = bool(env.MALWARE_SCANNER_ENABLED);
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
  const integrationCredentialApiToken = optional(
    env,
    "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN"
  );
  const malwareScannerHost = optional(env, "MALWARE_SCANNER_HOST");
  const integrationCredentialKeys = versionedKeyring(
    env.INTEGRATION_CREDENTIAL_KEYS,
    "INTEGRATION_CREDENTIAL_KEYS"
  );
  const integrationCredentialFingerprintKeys = versionedKeyring(
    env.INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS,
    "INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS"
  );
  const credentialRole = integrationCredentialRole(env);
  const integrationCredentialsEnabled = credentialRole !== "DISABLED";
  const credentialManagementEnabled = credentialRole === "MANAGEMENT";
  const credentialExecutionEnabled = credentialRole === "EXECUTION";
  const integrationCredentialActiveKeyVersion =
    env.INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION
      ? keyVersion(
          env.INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION,
          "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION"
        )
      : undefined;
  const integrationCredentialActiveFingerprintKeyVersion =
    env.INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION
      ? keyVersion(
          env.INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION,
          "INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION"
        )
      : undefined;

  if (
    credentialRole === "DISABLED" &&
    (integrationCredentialKeys.size > 0 ||
      integrationCredentialActiveKeyVersion !== undefined ||
      integrationCredentialFingerprintKeys.size > 0 ||
      integrationCredentialActiveFingerprintKeyVersion !== undefined ||
      integrationCredentialApiToken)
  ) {
    throw new Error(
      "Credential-disabled processes must not receive credential keyrings or the dedicated credential API token"
    );
  }

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
  if (malwareScannerEnabled && !malwareScannerHost) {
    throw new Error(
      "Malware scanner is enabled but MALWARE_SCANNER_HOST is missing"
    );
  }
  if (
    nodeEnv === "production" &&
    !credentialExecutionEnabled &&
    (!internalApiToken || internalApiToken.length < 32)
  ) {
    throw new Error(
      "INTERNAL_API_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    integrationCredentialKeys.size > 0 &&
    integrationCredentialActiveKeyVersion === undefined
  ) {
    throw new Error(
      "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION is required when credential keys are configured"
    );
  }
  if (
    integrationCredentialActiveKeyVersion !== undefined &&
    !integrationCredentialKeys.has(integrationCredentialActiveKeyVersion)
  ) {
    throw new Error(
      "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION must reference a configured key"
    );
  }
  if (integrationCredentialsEnabled && integrationCredentialKeys.size === 0) {
    throw new Error(
      "INTEGRATION_CREDENTIAL_KEYS is required when integration credentials are enabled"
    );
  }
  if (
    integrationCredentialFingerprintKeys.size > 0 &&
    integrationCredentialActiveFingerprintKeyVersion === undefined
  ) {
    throw new Error(
      "INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION is required when fingerprint keys are configured"
    );
  }
  if (
    integrationCredentialActiveFingerprintKeyVersion !== undefined &&
    !integrationCredentialFingerprintKeys.has(
      integrationCredentialActiveFingerprintKeyVersion
    )
  ) {
    throw new Error(
      "INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION must reference a configured key"
    );
  }
  if (
    credentialManagementEnabled &&
    integrationCredentialFingerprintKeys.size === 0
  ) {
    throw new Error(
      "INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS is required when integration credentials are enabled"
    );
  }
  if (
    credentialManagementEnabled &&
    (!integrationCredentialApiToken ||
      integrationCredentialApiToken.length < 32)
  ) {
    throw new Error(
      "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN with at least 32 characters is required when integration credentials are enabled"
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
  if (
    credentialExecutionEnabled &&
    (integrationCredentialFingerprintKeys.size > 0 ||
      integrationCredentialApiToken ||
      internalApiToken ||
      natsUser ||
      natsPassword ||
      s3AccessKeyId ||
      s3SecretAccessKey ||
      smtpUser ||
      smtpPassword)
  ) {
    throw new Error(
      "Execution-only credential workers must not receive management, internal API, NATS, S3 or SMTP credentials"
    );
  }
  const integrationValidationTimeoutMs = boundedInteger(
    env.INTEGRATION_VALIDATION_TIMEOUT_MS,
    10_000,
    "INTEGRATION_VALIDATION_TIMEOUT_MS",
    1_000,
    120_000
  );
  const integrationValidationLeaseSeconds = boundedInteger(
    env.INTEGRATION_VALIDATION_LEASE_SECONDS,
    120,
    "INTEGRATION_VALIDATION_LEASE_SECONDS",
    10,
    600
  );
  if (
    integrationValidationLeaseSeconds * 1_000 <
    integrationValidationTimeoutMs + 5_000
  ) {
    throw new Error(
      "INTEGRATION_VALIDATION_LEASE_SECONDS must exceed the provider timeout by at least 5 seconds"
    );
  }
  if (
    [...integrationCredentialKeys.values()].some((encryptionKey) =>
      [...integrationCredentialFingerprintKeys.values()].some(
        (fingerprintKey) => encryptionKey.equals(fingerprintKey)
      )
    )
  ) {
    throw new Error(
      "Integration credential encryption and fingerprint keyrings must use different key material"
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
    ...(integrationCredentialApiToken
      ? { integrationCredentialApiToken }
      : {}),
    internalCommandTimeoutMs: positiveInteger(
      env.SEO_DATA_COMMAND_TIMEOUT_MS,
      60_000,
      "SEO_DATA_COMMAND_TIMEOUT_MS"
    ),
    services: {
      seoData:
        optional(env, "SEO_DATA_URL") || "http://localhost:4001"
    },
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
    malwareScanner: {
      enabled: malwareScannerEnabled,
      ...(malwareScannerHost ? { host: malwareScannerHost } : {}),
      port: positiveInteger(
        env.MALWARE_SCANNER_PORT,
        3310,
        "MALWARE_SCANNER_PORT"
      ),
      connectTimeoutMs: positiveInteger(
        env.MALWARE_SCANNER_CONNECT_TIMEOUT_MS,
        5_000,
        "MALWARE_SCANNER_CONNECT_TIMEOUT_MS"
      ),
      scanTimeoutMs: positiveInteger(
        env.MALWARE_SCANNER_SCAN_TIMEOUT_MS,
        15 * 60 * 1_000,
        "MALWARE_SCANNER_SCAN_TIMEOUT_MS"
      )
    },
    integrationCredentials: {
      enabled: integrationCredentialsEnabled,
      role: credentialRole,
      keys: integrationCredentialKeys,
      ...(integrationCredentialActiveKeyVersion !== undefined
        ? { activeKeyVersion: integrationCredentialActiveKeyVersion }
        : {}),
      fingerprintKeys: integrationCredentialFingerprintKeys,
      ...(integrationCredentialActiveFingerprintKeyVersion !== undefined
        ? {
            activeFingerprintKeyVersion:
              integrationCredentialActiveFingerprintKeyVersion
          }
        : {})
    },
    integrationCredentialValidation: {
      timeoutMs: integrationValidationTimeoutMs,
      leaseSeconds: integrationValidationLeaseSeconds,
      dispatchSeconds: boundedInteger(
        env.INTEGRATION_VALIDATION_DISPATCH_SECONDS,
        15,
        "INTEGRATION_VALIDATION_DISPATCH_SECONDS",
        5,
        300
      ),
      concurrency: boundedInteger(
        env.INTEGRATION_VALIDATION_CONCURRENCY,
        2,
        "INTEGRATION_VALIDATION_CONCURRENCY",
        1,
        32
      )
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
      ),
      inspectionLeaseMinutes: positiveInteger(
        env.UPLOAD_INSPECTION_LEASE_MINUTES,
        30,
        "UPLOAD_INSPECTION_LEASE_MINUTES"
      ),
      inspectionDispatchSeconds: positiveInteger(
        env.UPLOAD_INSPECTION_DISPATCH_SECONDS,
        30,
        "UPLOAD_INSPECTION_DISPATCH_SECONDS"
      ),
      inspectionHeartbeatSeconds: positiveInteger(
        env.UPLOAD_INSPECTION_HEARTBEAT_SECONDS,
        60,
        "UPLOAD_INSPECTION_HEARTBEAT_SECONDS"
      ),
      inspectionConcurrency: positiveInteger(
        env.UPLOAD_INSPECTION_CONCURRENCY,
        2,
        "UPLOAD_INSPECTION_CONCURRENCY"
      )
    },
    imports: {
      parseLeaseMinutes: positiveInteger(
        env.IMPORT_PARSE_LEASE_MINUTES,
        30,
        "IMPORT_PARSE_LEASE_MINUTES"
      ),
      parseDispatchSeconds: positiveInteger(
        env.IMPORT_PARSE_DISPATCH_SECONDS,
        30,
        "IMPORT_PARSE_DISPATCH_SECONDS"
      ),
      parseHeartbeatSeconds: positiveInteger(
        env.IMPORT_PARSE_HEARTBEAT_SECONDS,
        30,
        "IMPORT_PARSE_HEARTBEAT_SECONDS"
      ),
      parseConcurrency: positiveInteger(
        env.IMPORT_PARSE_CONCURRENCY,
        2,
        "IMPORT_PARSE_CONCURRENCY"
      ),
      stagingBatchRows: positiveInteger(
        env.IMPORT_STAGING_BATCH_ROWS,
        1_000,
        "IMPORT_STAGING_BATCH_ROWS"
      ),
      previewRows: positiveInteger(
        env.IMPORT_PREVIEW_ROWS,
        20,
        "IMPORT_PREVIEW_ROWS"
      ),
      publishBatchRows: positiveInteger(
        env.IMPORT_PUBLISH_BATCH_ROWS,
        200,
        "IMPORT_PUBLISH_BATCH_ROWS"
      )
    }
  };
}
