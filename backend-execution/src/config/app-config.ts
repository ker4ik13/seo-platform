import { isIP } from "node:net";

export interface S3Config {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle: boolean;
  readonly objectKeyPrefix?: string;
  readonly signedUrlTtlSeconds: number;
  readonly buckets: {
    readonly uploads?: string;
    readonly artifacts?: string;
  };
}

export interface EmailConfig {
  readonly enabled: boolean;
  readonly from?: string;
  readonly messageIdDomain?: string;
  readonly host?: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
  readonly connectionTimeoutMs: number;
  readonly socketTimeoutMs: number;
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

export type JobsProcessRole =
  | "HTTP"
  | "SYSTEM_WORKER"
  | "IMPORT_WORKER"
  | "INSPECTION_WORKER"
  | "RANK_WORKER"
  | "CRAWL_WORKER"
  | "CONNECTOR_WORKER"
  | "AUTH_EMAIL_WORKER";

export interface IntegrationCredentialEncryptionConfig {
  readonly enabled: boolean;
  readonly role: IntegrationCredentialRole;
  readonly keys: ReadonlyMap<number, Buffer>;
  readonly activeKeyVersion?: number;
  readonly fingerprintKeys: ReadonlyMap<number, Buffer>;
  readonly activeFingerprintKeyVersion?: number;
}

export interface PlatformProviderCredentialsConfig {
  readonly XMLSTOCK?: readonly {
    readonly apiKey: string;
    readonly accountIdentifier: string;
  }[];
  readonly ARSENKIN?: readonly {
    readonly apiKey: string;
  }[];
}

export interface AppConfig {
  readonly processRole: JobsProcessRole;
  readonly nodeEnv: "development" | "test" | "production";
  readonly bindAddress: "127.0.0.1" | "0.0.0.0";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly redisUrl: string;
  readonly platformApiToken?: string;
  readonly seoDataApiToken?: string;
  readonly integrationCredentialApiToken?: string;
  readonly rankManifestApiToken?: string;
  readonly rankResultApiToken?: string;
  readonly rankGrantApiToken?: string;
  readonly rankBillingSettlementApiToken?: string;
  readonly automationDispatchApiToken?: string;
  readonly authEmailApiToken?: string;
  readonly internalCommandTimeoutMs: number;
  readonly platformApiCommandTimeoutMs: number;
  readonly services: {
    readonly seoData: string;
    readonly platformApi: string;
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
  readonly platformProviderCredentials: PlatformProviderCredentialsConfig;
  readonly xmlStockSoftId?: string;
  readonly integrationCredentialValidation: {
    readonly timeoutMs: number;
    readonly leaseSeconds: number;
    readonly dispatchSeconds: number;
    readonly concurrency: number;
  };
  readonly connectorRuntime: {
    readonly dispatchIntervalMs: number;
    readonly paidExecutionEnabled: boolean;
    readonly shardIndex: number;
    readonly shardCount: number;
    readonly rankConcurrency: number;
    readonly frequencyConcurrency: number;
    readonly keywordResearchConcurrency: number;
  };
  readonly rankPreparation: {
    readonly enabled: boolean;
    readonly leaseSeconds: number;
    readonly dispatchSeconds: number;
    readonly resultPersistenceDispatchIntervalMs: number;
    readonly concurrency: number;
  };
  readonly rankExecution: {
    readonly submitEnabled: boolean;
    readonly killSwitchVersion: string;
  };
  readonly crawl: {
    readonly enabled: boolean;
    readonly concurrency: number;
    readonly dispatchSeconds: number;
    readonly leaseSeconds: number;
    readonly requestTimeoutMs: number;
    readonly maxResponseBytes: number;
    readonly maxRedirects: number;
    readonly userAgent: string;
  };
  readonly authEmail: {
    readonly enabled: boolean;
    readonly environment?: string;
    readonly streamName: "AUTH_EMAIL_EVENTS";
    readonly durableName: "jobs_auth_email_v1";
    readonly deadLetterStreamName: "DOMAIN_EVENTS_DLQ";
    readonly maxAttempts: number;
    readonly leaseSeconds: number;
    readonly dispatchMs: number;
    readonly fetchExpiresMs: number;
    readonly publishTimeoutMs: number;
    readonly retryBaseMs: number;
    readonly retryMaxMs: number;
    readonly maxPayloadBytes: number;
    readonly shutdownGraceMs: number;
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

export interface SystemWorkerConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly redisUrl: string;
  readonly concurrency: number;
}

function bindAddress(
  value: string | undefined,
  nodeEnv: AppConfig["nodeEnv"]
): AppConfig["bindAddress"] {
  const fallback = nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1";
  const address = value?.trim() || fallback;
  if (address !== "127.0.0.1" && address !== "0.0.0.0") {
    throw new Error("BIND_ADDRESS must be 127.0.0.1 or 0.0.0.0");
  }
  return address;
}

const SERVICE_TOKEN_ENVIRONMENT_VARIABLES = [
  "PLATFORM_API_TO_JOBS_TOKEN",
  "JOBS_TO_SEO_DATA_TOKEN",
  "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
  "JOBS_TO_SEO_RANK_TOKEN",
  "JOBS_TO_SEO_RANK_RESULT_TOKEN",
  "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
  "JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN",
  "JOBS_TO_PLATFORM_AUTOMATION_TOKEN",
  "JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN"
] as const;

const AUTH_EMAIL_ONLY_ENVIRONMENT_VARIABLES = [
  "AUTH_EMAIL_EVENT_ENVIRONMENT",
  "AUTH_EMAIL_MAX_ATTEMPTS",
  "AUTH_EMAIL_LEASE_SECONDS",
  "AUTH_EMAIL_DISPATCH_MS",
  "AUTH_EMAIL_FETCH_EXPIRES_MS",
  "AUTH_EMAIL_PUBLISH_TIMEOUT_MS",
  "AUTH_EMAIL_RETRY_BASE_MS",
  "AUTH_EMAIL_RETRY_MAX_MS",
  "AUTH_EMAIL_MAX_PAYLOAD_BYTES",
  "AUTH_EMAIL_SHUTDOWN_GRACE_MS",
  "EMAIL_MESSAGE_ID_DOMAIN",
  "SMTP_CONNECTION_TIMEOUT_MS",
  "SMTP_SOCKET_TIMEOUT_MS"
] as const;

const SYSTEM_WORKER_FORBIDDEN_ENVIRONMENT_VARIABLES = [
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "PGUSER",
  "PGPASSWORD",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "JOBS_DATABASE_PASSWORD",
  "JOBS_DATABASE_OWNER_PASSWORD",
  "JOBS_CONNECTOR_DATABASE_USER",
  "JOBS_CONNECTOR_DATABASE_PASSWORD",
  "NATS_URL",
  "NATS_USER",
  "NATS_PASSWORD",
  "S3_ENABLED",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET_UPLOADS",
  "S3_BUCKET_ARTIFACTS",
  "S3_FORCE_PATH_STYLE",
  "S3_SIGNED_URL_TTL_SECONDS",
  "EMAIL_ENABLED",
  "EMAIL_FROM",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MALWARE_SCANNER_ENABLED",
  "MALWARE_SCANNER_HOST",
  "MALWARE_SCANNER_PORT",
  "MALWARE_SCANNER_CONNECT_TIMEOUT_MS",
  "MALWARE_SCANNER_SCAN_TIMEOUT_MS",
  "INTEGRATION_CREDENTIAL_ROLE",
  "INTEGRATION_CREDENTIALS_ENABLED",
  "INTEGRATION_CREDENTIAL_KEYS",
  "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION",
  "INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS",
  "INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION",
  "INTEGRATION_VALIDATION_TIMEOUT_MS",
  "INTEGRATION_VALIDATION_LEASE_SECONDS",
  "INTEGRATION_VALIDATION_DISPATCH_SECONDS",
  "INTEGRATION_VALIDATION_CONCURRENCY",
  "PLATFORM_XMLSTOCK_ENABLED",
  "PLATFORM_XMLSTOCK_API_KEY",
  "PLATFORM_XMLSTOCK_API_KEYS",
  "PLATFORM_XMLSTOCK_ACCOUNT_ID",
  "PLATFORM_XMLSTOCK_ACCOUNT_IDS",
  "PLATFORM_XMLSTOCK_SOFT_ID",
  "PLATFORM_ARSENKIN_ENABLED",
  "PLATFORM_ARSENKIN_API_KEY",
  "PLATFORM_ARSENKIN_API_KEYS",
  "CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS",
  "RANK_CONNECTOR_CONCURRENCY",
  "FREQUENCY_COLLECTION_CONCURRENCY",
  "KEYWORD_RESEARCH_CONCURRENCY",
  "RANK_PREPARATION_ENABLED",
  "RANK_PREPARATION_LEASE_SECONDS",
  "RANK_PREPARATION_DISPATCH_SECONDS",
  "RANK_RESULT_PERSISTENCE_DISPATCH_INTERVAL_MS",
  "RANK_PREPARATION_CONCURRENCY",
  "RANK_PROVIDER_SUBMIT_ENABLED",
  "RANK_PROVIDER_KILL_SWITCH_VERSION",
  "SEO_DATA_URL",
  "SEO_DATA_COMMAND_TIMEOUT_MS",
  "PLATFORM_API_URL",
  "PLATFORM_API_COMMAND_TIMEOUT_MS",
  "INTERNAL_API_TOKEN",
  "JOBS_TO_SEO_RANK_RESULT_TOKEN",
  "AUTH_EMAIL_EVENT_ENVIRONMENT",
  "AUTH_EMAIL_MAX_ATTEMPTS",
  "AUTH_EMAIL_LEASE_SECONDS",
  "AUTH_EMAIL_DISPATCH_MS",
  "AUTH_EMAIL_FETCH_EXPIRES_MS",
  "AUTH_EMAIL_PUBLISH_TIMEOUT_MS",
  "AUTH_EMAIL_RETRY_BASE_MS",
  "AUTH_EMAIL_RETRY_MAX_MS",
  "AUTH_EMAIL_MAX_PAYLOAD_BYTES",
  "AUTH_EMAIL_SHUTDOWN_GRACE_MS",
  "EMAIL_MESSAGE_ID_DOMAIN",
  "SMTP_CONNECTION_TIMEOUT_MS",
  "SMTP_SOCKET_TIMEOUT_MS",
  ...SERVICE_TOKEN_ENVIRONMENT_VARIABLES
] as const;

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

function objectStoragePrefix(value: string | undefined): string | undefined {
  const prefix = value?.trim();
  if (!prefix) return undefined;
  if (
    prefix.length > 256 ||
    prefix.startsWith("/") ||
    prefix.endsWith("/") ||
    prefix.includes("//") ||
    prefix.includes("..") ||
    !/^[A-Za-z0-9][A-Za-z0-9._~/-]*$/u.test(prefix)
  ) {
    throw new Error(
      "S3_KEY_PREFIX must be a relative 1..256 character object prefix without empty or parent segments"
    );
  }
  return prefix;
}

function serviceToken(
  env: NodeJS.ProcessEnv,
  key: (typeof SERVICE_TOKEN_ENVIRONMENT_VARIABLES)[number]
): string | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.toLowerCase();
  if (
    value.length < 32 ||
    value.length > 512 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint === undefined ||
        codePoint <= 0x20 ||
        codePoint >= 0x7f ||
        character === ","
      );
    }) ||
    /(replace|placeholder|example|change[-_]?me|insert[-_]?here|your[-_])/u.test(
      normalized
    )
  ) {
    throw new Error(
      `${key} must be a non-placeholder ASCII service token between 32 and 512 characters without whitespace, commas or control characters`
    );
  }
  return value;
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

function boundedNonNegativeInteger(
  value: string | undefined,
  fallback: number,
  key: string,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value ?? fallback);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${key} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function boundedVersion(
  value: string | undefined,
  fallback: string,
  key: string
): string {
  const parsed = value === undefined ? fallback : value.trim();
  if (!/^[a-z0-9][a-z0-9@._-]{0,63}$/u.test(parsed)) {
    throw new Error(
      `${key} must be a lowercase version identifier up to 64 characters`
    );
  }
  return parsed;
}

function eventEnvironment(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = value.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u.test(parsed)) {
    throw new Error(
      "AUTH_EMAIL_EVENT_ENVIRONMENT must be a lowercase NATS token without underscores or edge hyphens"
    );
  }
  return parsed;
}

function messageIdDomain(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = value.trim().toLowerCase();
  if (
    parsed.length > 205 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      parsed
    )
  ) {
    throw new Error(
      "EMAIL_MESSAGE_ID_DOMAIN must be a valid DNS name that keeps Message-ID within 255 characters"
    );
  }
  return parsed;
}

function emailMailbox(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = value.trim();
  if (
    parsed.length > 254 ||
    /[\r\n]/u.test(parsed)
  ) {
    throw new Error("EMAIL_FROM must be one bounded mailbox address");
  }
  const separator = parsed.lastIndexOf("@");
  const local = parsed.slice(0, separator);
  const domain = parsed.slice(separator + 1).toLowerCase();
  const atom = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
  if (
    separator < 1 ||
    local.length > 64 ||
    !new RegExp(`^${atom}(?:\\.${atom})*$`, "u").test(local) ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      domain
    )
  ) {
    throw new Error("EMAIL_FROM must be one bounded mailbox address");
  }
  return `${local}@${domain}`;
}

function smtpHostname(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = value.trim().toLowerCase();
  if (isIP(parsed) !== 0) return parsed;
  if (
    parsed.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u.test(
      parsed
    )
  ) {
    throw new Error("SMTP_HOST must be a bounded DNS hostname or IP address");
  }
  return parsed;
}

function smtpUsername(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (
    value.length > 320 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === undefined || codePoint < 0x21 || codePoint > 0x7e;
    })
  ) {
    throw new Error(
      "SMTP_USER must contain 1 to 320 visible ASCII characters"
    );
  }
  return value;
}

function smtpSecret(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (
    value.length > 1_024 ||
    value.includes("\u0000") ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    throw new Error(
      "SMTP_PASSWORD must contain 1 to 1024 characters without NUL or line breaks"
    );
  }
  return value;
}

function providerApiKey(
  value: string | undefined,
  key: string
): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (
    value.length < 8 ||
    value.length > 2_048 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint === undefined ||
        codePoint <= 0x20 ||
        codePoint >= 0x7f ||
        character === ","
      );
    })
  ) {
    throw new Error(
      `${key} must contain 8 to 2048 visible ASCII characters without whitespace or commas`
    );
  }
  return value;
}

const PLATFORM_PROVIDER_POOL_MAX_SIZE = 64;

function providerApiKeys(
  pluralValue: string | undefined,
  legacyValue: string | undefined,
  pluralKey: string,
  legacyKey: string
): readonly string[] | undefined {
  const pluralConfigured =
    pluralValue !== undefined && pluralValue.trim() !== "";
  const legacyConfigured =
    legacyValue !== undefined && legacyValue.trim() !== "";
  if (pluralConfigured && legacyConfigured) {
    throw new Error(`${pluralKey} conflicts with legacy ${legacyKey}`);
  }
  const source = pluralConfigured
    ? pluralValue
    : legacyConfigured
      ? legacyValue
      : undefined;
  if (source === undefined) return undefined;
  const values = pluralConfigured ? source.split(",") : [source];
  if (values.length > PLATFORM_PROVIDER_POOL_MAX_SIZE) {
    throw new Error(
      `${pluralKey} must contain at most ${PLATFORM_PROVIDER_POOL_MAX_SIZE} keys`
    );
  }
  const parsed = values.map((value, index) => {
    const normalized = value.trim();
    if (!normalized) {
      throw new Error(
        `${pluralKey} contains an empty item at position ${index + 1}`
      );
    }
    return providerApiKey(normalized, pluralKey)!;
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new Error(`${pluralKey} must not contain duplicate keys`);
  }
  return parsed;
}

function providerAccountIdentifier(
  value: string | undefined,
  key: string
): string | undefined {
  const identifier = value?.trim();
  if (!identifier) return undefined;
  if (
    identifier.length > 255 ||
    [...identifier].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint === undefined ||
        codePoint < 0x20 ||
        codePoint === 0x7f ||
        character === ","
      );
    })
  ) {
    throw new Error(
      `${key} must be a bounded printable identifier without commas`
    );
  }
  return identifier;
}

function providerAccountIdentifiers(
  pluralValue: string | undefined,
  legacyValue: string | undefined,
  pluralKey: string,
  legacyKey: string
): readonly string[] | undefined {
  const pluralConfigured =
    pluralValue !== undefined && pluralValue.trim() !== "";
  const legacyConfigured =
    legacyValue !== undefined && legacyValue.trim() !== "";
  if (pluralConfigured && legacyConfigured) {
    throw new Error(`${pluralKey} conflicts with legacy ${legacyKey}`);
  }
  const source = pluralConfigured
    ? pluralValue
    : legacyConfigured
      ? legacyValue
      : undefined;
  if (source === undefined) return undefined;
  const values = pluralConfigured ? source.split(",") : [source];
  if (values.length > PLATFORM_PROVIDER_POOL_MAX_SIZE) {
    throw new Error(
      `${pluralKey} must contain at most ${PLATFORM_PROVIDER_POOL_MAX_SIZE} identifiers`
    );
  }
  const identifiers = values.map((value, index) => {
    const identifier = providerAccountIdentifier(value, pluralKey);
    if (!identifier) {
      throw new Error(
        `${pluralKey} contains an empty item at position ${index + 1}`
      );
    }
    return identifier;
  });
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error(`${pluralKey} must not contain duplicate identifiers`);
  }
  return identifiers;
}

function xmlStockPlatformCredentials(
  apiKeys: readonly string[],
  accountIdentifiers: readonly string[]
): PlatformProviderCredentialsConfig["XMLSTOCK"] {
  if (accountIdentifiers.length !== apiKeys.length) {
    throw new Error(
      "PLATFORM_XMLSTOCK_ACCOUNT_IDS must contain exactly one identifier per API key in the same order"
    );
  }
  return apiKeys.map((apiKey, index) => ({
    apiKey,
    accountIdentifier: accountIdentifiers[index]!
  }));
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

export function loadSystemWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): SystemWorkerConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }
  for (const key of SYSTEM_WORKER_FORBIDDEN_ENVIRONMENT_VARIABLES) {
    if (env[key]?.trim()) {
      throw new Error(
        `SYSTEM_WORKER must not receive ${key}; its runtime capability is Redis only`
      );
    }
  }
  const redisUrl = optional(env, "REDIS_URL");
  if (nodeEnv === "production" && !redisUrl) {
    throw new Error("REDIS_URL is required by SYSTEM_WORKER in production");
  }
  return {
    nodeEnv: nodeEnv as SystemWorkerConfig["nodeEnv"],
    redisUrl: redisUrl ?? "redis://127.0.0.1:6379",
    concurrency: boundedInteger(
      env.SYSTEM_WORKER_CONCURRENCY,
      2,
      "SYSTEM_WORKER_CONCURRENCY",
      1,
      32
    )
  };
}

export function loadAppConfig(
  env: NodeJS.ProcessEnv = process.env,
  requestedProcessRole?: JobsProcessRole
): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }

  const s3Enabled = bool(env.S3_ENABLED);
  const emailEnabled = bool(env.EMAIL_ENABLED);
  const malwareScannerEnabled = bool(env.MALWARE_SCANNER_ENABLED);
  const natsUser = optional(env, "NATS_USER");
  const natsPassword = optional(env, "NATS_PASSWORD");
  const natsUrl = optional(env, "NATS_URL");
  const s3Endpoint = optional(env, "S3_ENDPOINT");
  const s3AccessKeyId = optional(env, "S3_ACCESS_KEY_ID");
  const s3SecretAccessKey = optional(env, "S3_SECRET_ACCESS_KEY");
  const uploadsBucket = optional(env, "S3_BUCKET_UPLOADS");
  const artifactsBucket = optional(env, "S3_BUCKET_ARTIFACTS");
  const s3KeyPrefix = objectStoragePrefix(env.S3_KEY_PREFIX);
  const emailFrom = emailMailbox(env.EMAIL_FROM);
  const smtpHost = smtpHostname(env.SMTP_HOST);
  const smtpUser = smtpUsername(env.SMTP_USER);
  const smtpPassword = smtpSecret(env.SMTP_PASSWORD);
  const emailMessageIdDomain = messageIdDomain(
    env.EMAIL_MESSAGE_ID_DOMAIN
  );
  const platformApiToken = serviceToken(
    env,
    "PLATFORM_API_TO_JOBS_TOKEN"
  );
  const seoDataApiToken = serviceToken(env, "JOBS_TO_SEO_DATA_TOKEN");
  const integrationCredentialApiToken = serviceToken(
    env,
    "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN"
  );
  const rankManifestApiToken = serviceToken(
    env,
    "JOBS_TO_SEO_RANK_TOKEN"
  );
  const rankResultApiToken = serviceToken(
    env,
    "JOBS_TO_SEO_RANK_RESULT_TOKEN"
  );
  const rankGrantApiToken = serviceToken(
    env,
    "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN"
  );
  const rankBillingSettlementApiToken = serviceToken(
    env,
    "JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN"
  );
  const automationDispatchApiToken = serviceToken(
    env,
    "JOBS_TO_PLATFORM_AUTOMATION_TOKEN"
  );
  const authEmailApiToken = serviceToken(
    env,
    "JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN"
  );
  const rankPreparationEnabled = bool(env.RANK_PREPARATION_ENABLED);
  const rankProviderSubmitEnabled = bool(
    env.RANK_PROVIDER_SUBMIT_ENABLED
  );
  const rankProviderKillSwitchVersion = boundedVersion(
    env.RANK_PROVIDER_KILL_SWITCH_VERSION,
    "arsenkin-positions@4",
    "RANK_PROVIDER_KILL_SWITCH_VERSION"
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
  const processRole =
    requestedProcessRole ??
    (rankPreparationEnabled
      ? "RANK_WORKER"
      : credentialExecutionEnabled
        ? "CONNECTOR_WORKER"
        : "HTTP");
  const platformXmlstockEnabled = bool(
    env.PLATFORM_XMLSTOCK_ENABLED
  );
  const xmlStockSoftId = optional(env, "PLATFORM_XMLSTOCK_SOFT_ID");
  if (xmlStockSoftId && !/^[a-f0-9]{32}$/iu.test(xmlStockSoftId)) {
    throw new Error("PLATFORM_XMLSTOCK_SOFT_ID must be a 32-character hexadecimal identifier");
  }
  const platformArsenkinEnabled = bool(
    env.PLATFORM_ARSENKIN_ENABLED
  );
  const platformXmlstockApiKeys = platformXmlstockEnabled
    ? providerApiKeys(
        env.PLATFORM_XMLSTOCK_API_KEYS,
        env.PLATFORM_XMLSTOCK_API_KEY,
        "PLATFORM_XMLSTOCK_API_KEYS",
        "PLATFORM_XMLSTOCK_API_KEY"
      )
    : undefined;
  const platformXmlstockAccountIdentifiers = platformXmlstockEnabled
    ? providerAccountIdentifiers(
        env.PLATFORM_XMLSTOCK_ACCOUNT_IDS,
        env.PLATFORM_XMLSTOCK_ACCOUNT_ID,
        "PLATFORM_XMLSTOCK_ACCOUNT_IDS",
        "PLATFORM_XMLSTOCK_ACCOUNT_ID"
      )
    : undefined;
  const platformArsenkinApiKeys = platformArsenkinEnabled
    ? providerApiKeys(
        env.PLATFORM_ARSENKIN_API_KEYS,
        env.PLATFORM_ARSENKIN_API_KEY,
        "PLATFORM_ARSENKIN_API_KEYS",
        "PLATFORM_ARSENKIN_API_KEY"
      )
    : undefined;
  if (
    (platformXmlstockApiKeys === undefined) !==
    (platformXmlstockAccountIdentifiers === undefined)
  ) {
    throw new Error(
      "PLATFORM_XMLSTOCK_API_KEYS and PLATFORM_XMLSTOCK_ACCOUNT_IDS must be configured together"
    );
  }
  if (
    platformXmlstockEnabled &&
    (!platformXmlstockApiKeys || !platformXmlstockAccountIdentifiers)
  ) {
    throw new Error(
      "PLATFORM_XMLSTOCK_API_KEYS and PLATFORM_XMLSTOCK_ACCOUNT_IDS are required when XMLStock platform usage is enabled"
    );
  }
  if (platformArsenkinEnabled && !platformArsenkinApiKeys) {
    throw new Error(
      "PLATFORM_ARSENKIN_API_KEYS is required when Arsenkin platform usage is enabled"
    );
  }
  const platformXmlstockCredentials =
    platformXmlstockApiKeys && platformXmlstockAccountIdentifiers
      ? xmlStockPlatformCredentials(
          platformXmlstockApiKeys,
          platformXmlstockAccountIdentifiers
        )
      : undefined;
  if (
    processRole !== "HTTP" &&
    [
      env.PLATFORM_XMLSTOCK_API_KEY,
      env.PLATFORM_XMLSTOCK_API_KEYS,
      env.PLATFORM_XMLSTOCK_ACCOUNT_ID,
      env.PLATFORM_XMLSTOCK_ACCOUNT_IDS,
      env.PLATFORM_ARSENKIN_API_KEY,
      env.PLATFORM_ARSENKIN_API_KEYS
    ].some((value) => value !== undefined && value.trim() !== "")
  ) {
    throw new Error(
      `${processRole} must not receive platform provider source credentials`
    );
  }
  if (processRole === "SYSTEM_WORKER") {
    throw new Error(
      "SYSTEM_WORKER must use loadSystemWorkerConfig to avoid receiving database and application capabilities"
    );
  }
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
    (rankManifestApiToken || rankResultApiToken || rankGrantApiToken) &&
    !rankPreparationEnabled
  ) {
    throw new Error(
      "Only the enabled rank preparation worker may receive rank execution service tokens"
    );
  }
  if (
    rankBillingSettlementApiToken &&
    processRole !== "CONNECTOR_WORKER"
  ) {
    throw new Error(
      "Only the connector worker may receive JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN"
    );
  }
  if (
    processRole === "CONNECTOR_WORKER" &&
    rankProviderSubmitEnabled &&
    (!rankBillingSettlementApiToken ||
      rankBillingSettlementApiToken.length < 32)
  ) {
    throw new Error(
      "JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN with at least 32 characters is required when connector rank submit is enabled"
    );
  }
  if (
    rankPreparationEnabled &&
    (!rankManifestApiToken || rankManifestApiToken.length < 32)
  ) {
    throw new Error(
      "JOBS_TO_SEO_RANK_TOKEN with at least 32 characters is required by the rank preparation worker"
    );
  }
  if (
    rankPreparationEnabled &&
    (!rankGrantApiToken || rankGrantApiToken.length < 32)
  ) {
    throw new Error(
      "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN with at least 32 characters is required by the rank preparation worker"
    );
  }
  if (
    rankPreparationEnabled &&
    (!rankResultApiToken || rankResultApiToken.length < 32)
  ) {
    throw new Error(
      "JOBS_TO_SEO_RANK_RESULT_TOKEN with at least 32 characters is required by the rank worker"
    );
  }
  if (rankPreparationEnabled && credentialRole !== "DISABLED") {
    throw new Error(
      "Rank preparation workers must not receive credential decryption capability"
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
  if (!s3Enabled && (s3AccessKeyId || s3SecretAccessKey)) {
    throw new Error(
      "S3 credentials must be absent when S3_ENABLED is false"
    );
  }

  if (
    emailEnabled &&
    (!emailFrom ||
      !emailMessageIdDomain ||
      !smtpHost ||
      !smtpUser ||
      !smtpPassword)
  ) {
    throw new Error("Email is enabled but SMTP configuration is incomplete");
  }
  if (
    !emailEnabled &&
    (emailFrom ||
      emailMessageIdDomain ||
      smtpHost ||
      smtpUser ||
      smtpPassword)
  ) {
    throw new Error(
      "SMTP credentials must be absent when EMAIL_ENABLED is false"
    );
  }
  if (malwareScannerEnabled && !malwareScannerHost) {
    throw new Error(
      "Malware scanner is enabled but MALWARE_SCANNER_HOST is missing"
    );
  }
  if (!malwareScannerEnabled && malwareScannerHost) {
    throw new Error(
      "MALWARE_SCANNER_HOST must be absent when MALWARE_SCANNER_ENABLED is false"
    );
  }
  if (env.INTERNAL_API_TOKEN?.trim()) {
    throw new Error(
      "INTERNAL_API_TOKEN is no longer supported; configure caller/audience tokens"
    );
  }
  if ((natsUser === undefined) !== (natsPassword === undefined)) {
    throw new Error(
      "NATS_USER and NATS_PASSWORD must be configured together"
    );
  }
  if (natsUrl?.includes("@")) {
    throw new Error(
      "NATS_URL must not contain credentials; use NATS_USER and NATS_PASSWORD"
    );
  }
  if (
    nodeEnv === "production" &&
    processRole === "HTTP" &&
    (!platformApiToken || platformApiToken.length < 32)
  ) {
    throw new Error(
      "PLATFORM_API_TO_JOBS_TOKEN with at least 32 characters is required by the Jobs HTTP process"
    );
  }
  if (
    nodeEnv === "production" &&
    processRole === "HTTP" &&
    (
      !automationDispatchApiToken ||
      automationDispatchApiToken.length < 32
    )
  ) {
    throw new Error(
      "JOBS_TO_PLATFORM_AUTOMATION_TOKEN with at least 32 characters is required by the Jobs HTTP process"
    );
  }
  if (
    nodeEnv === "production" &&
    (processRole === "HTTP" ||
      processRole === "IMPORT_WORKER" ||
      processRole === "CRAWL_WORKER" ||
      processRole === "CONNECTOR_WORKER") &&
    (!seoDataApiToken || seoDataApiToken.length < 32)
  ) {
    throw new Error(
      "JOBS_TO_SEO_DATA_TOKEN with at least 32 characters is required by Jobs callers of SEO Data"
    );
  }
  if (
    nodeEnv === "production" &&
    (processRole === "HTTP" || processRole === "AUTH_EMAIL_WORKER") &&
    (!natsUser || !natsPassword)
  ) {
    throw new Error(
      "NATS_USER and NATS_PASSWORD are required by NATS-capable Jobs processes in production"
    );
  }
  if (processRole !== "HTTP" && platformApiToken) {
    throw new Error(
      "Only the Jobs HTTP process may receive PLATFORM_API_TO_JOBS_TOKEN"
    );
  }
  if (processRole !== "HTTP" && automationDispatchApiToken) {
    throw new Error(
      "Only the Jobs HTTP process may receive JOBS_TO_PLATFORM_AUTOMATION_TOKEN"
    );
  }
  if (
    processRole !== "HTTP" &&
    processRole !== "IMPORT_WORKER" &&
    processRole !== "CRAWL_WORKER" &&
    processRole !== "CONNECTOR_WORKER" &&
    seoDataApiToken
  ) {
    throw new Error(
      "Only the Jobs HTTP, import-worker, crawl-worker and connector-worker processes may receive JOBS_TO_SEO_DATA_TOKEN"
    );
  }
  if (processRole !== "AUTH_EMAIL_WORKER" && authEmailApiToken) {
    throw new Error(
      "Only the auth-email worker process may receive JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN"
    );
  }
  if (processRole !== "AUTH_EMAIL_WORKER") {
    const leakedSetting = AUTH_EMAIL_ONLY_ENVIRONMENT_VARIABLES.find(
      (key) => optional(env, key) !== undefined
    );
    if (leakedSetting) {
      throw new Error(
        `Only the auth-email worker process may receive ${leakedSetting}`
      );
    }
  }
  assertProcessAdapterCapabilities(env, processRole, {
    s3Enabled,
    emailEnabled,
    malwareScannerEnabled
  });
  if (
    processRole === "RANK_WORKER" &&
    !rankPreparationEnabled
  ) {
    throw new Error(
      "The rank-worker process requires RANK_PREPARATION_ENABLED=true"
    );
  }
  if (
    processRole !== "RANK_WORKER" &&
    rankPreparationEnabled
  ) {
    throw new Error(
      "Only the rank-worker process may enable rank preparation"
    );
  }
  if (
    processRole === "CONNECTOR_WORKER" &&
    !credentialExecutionEnabled
  ) {
    throw new Error(
      "The connector-worker process requires the EXECUTION credential role"
    );
  }
  if (
    processRole !== "CONNECTOR_WORKER" &&
    credentialExecutionEnabled
  ) {
    throw new Error(
      "Only the connector-worker process may use the EXECUTION credential role"
    );
  }
  if (
    processRole !== "HTTP" &&
    credentialManagementEnabled
  ) {
    throw new Error(
      "Only the Jobs HTTP process may use the MANAGEMENT credential role"
    );
  }
  if (
    processRole !== "CRAWL_WORKER" &&
    [
      "CRAWL_CONTACT_URL",
      "CRAWL_CONCURRENCY",
      "CRAWL_DISPATCH_SECONDS",
      "CRAWL_LEASE_SECONDS",
      "CRAWL_REQUEST_TIMEOUT_MS",
      "CRAWL_MAX_RESPONSE_BYTES",
      "CRAWL_MAX_REDIRECTS"
    ].some((key) => optional(env, key) !== undefined)
  ) {
    throw new Error(
      "Only the crawl-worker process may receive crawler configuration"
    );
  }
  const crawlContactUrl =
    optional(env, "CRAWL_CONTACT_URL") ??
    (nodeEnv === "production" ? undefined : "https://crawler.invalid/crawler");
  if (processRole === "CRAWL_WORKER" && !crawlContactUrl) {
    throw new Error(
      "CRAWL_CONTACT_URL is required by the crawl-worker in production"
    );
  }
  if (crawlContactUrl) {
    let parsedContact: URL;
    try {
      parsedContact = new URL(crawlContactUrl);
    } catch {
      throw new Error("CRAWL_CONTACT_URL must be an absolute HTTPS URL");
    }
    if (
      parsedContact.protocol !== "https:" ||
      parsedContact.username ||
      parsedContact.password
    ) {
      throw new Error("CRAWL_CONTACT_URL must be an absolute HTTPS URL");
    }
  }
  if (processRole === "AUTH_EMAIL_WORKER") {
    const environment = eventEnvironment(
      env.AUTH_EMAIL_EVENT_ENVIRONMENT
    );
    if (!environment) {
      throw new Error(
        "AUTH_EMAIL_EVENT_ENVIRONMENT is required by the auth-email worker"
      );
    }
    if (!authEmailApiToken) {
      throw new Error(
        "JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN is required by the auth-email worker"
      );
    }
    if (!emailEnabled) {
      throw new Error(
        "EMAIL_ENABLED=true is required by the auth-email worker"
      );
    }
    if (!natsUser || !natsPassword) {
      throw new Error(
        "NATS_USER and NATS_PASSWORD are required by the auth-email worker"
      );
    }
    if (optional(env, "REDIS_URL")) {
      throw new Error(
        "AUTH_EMAIL_WORKER must not receive Redis configuration"
      );
    }
  }
  if (
    nodeEnv === "production" &&
    processRole === "HTTP" &&
    !credentialManagementEnabled
  ) {
    throw new Error(
      "The production Jobs HTTP process requires the MANAGEMENT credential role"
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
    rankManifestApiToken &&
    (rankManifestApiToken === platformApiToken ||
      rankManifestApiToken === seoDataApiToken ||
      rankManifestApiToken === integrationCredentialApiToken ||
      rankManifestApiToken === rankGrantApiToken ||
      rankManifestApiToken === rankResultApiToken)
  ) {
    throw new Error(
      "Rank manifest token must differ from all other service tokens"
    );
  }
  if (
    rankGrantApiToken &&
    (rankGrantApiToken === platformApiToken ||
      rankGrantApiToken === seoDataApiToken ||
      rankGrantApiToken === integrationCredentialApiToken)
  ) {
    throw new Error(
      "Rank grant token must differ from all other service tokens"
    );
  }
  if (
    rankResultApiToken &&
    (rankResultApiToken === platformApiToken ||
      rankResultApiToken === seoDataApiToken ||
      rankResultApiToken === integrationCredentialApiToken ||
      rankResultApiToken === rankGrantApiToken)
  ) {
    throw new Error(
      "Rank result token must differ from all other service tokens"
    );
  }
  if (
    rankProviderSubmitEnabled &&
    processRole !== "CONNECTOR_WORKER"
  ) {
    throw new Error(
      "RANK_PROVIDER_SUBMIT_ENABLED may be enabled only for the connector worker"
    );
  }
  if (
    credentialExecutionEnabled &&
    (integrationCredentialFingerprintKeys.size > 0 ||
      integrationCredentialApiToken ||
      platformApiToken ||
      natsUser ||
      natsPassword ||
      s3AccessKeyId ||
      s3SecretAccessKey ||
      smtpUser ||
      smtpPassword)
  ) {
    throw new Error(
      "Execution-only credential workers must not receive management, Platform API, NATS, S3 or SMTP credentials"
    );
  }
  if (
    rankPreparationEnabled &&
    (platformApiToken ||
      seoDataApiToken ||
      integrationCredentialApiToken ||
      natsUser ||
      natsPassword ||
      s3AccessKeyId ||
      s3SecretAccessKey ||
      smtpUser ||
      smtpPassword)
  ) {
    throw new Error(
      "Rank preparation workers must not receive generic internal, credential, NATS, S3 or SMTP secrets"
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
  const integrationValidationConcurrency = boundedInteger(
    env.INTEGRATION_VALIDATION_CONCURRENCY,
    1,
    "INTEGRATION_VALIDATION_CONCURRENCY",
    1,
    32
  );
  const rankConnectorConcurrency = boundedInteger(
    env.RANK_CONNECTOR_CONCURRENCY,
    4,
    "RANK_CONNECTOR_CONCURRENCY",
    1,
    64
  );
  const connectorRuntimeShardCount = boundedInteger(
    env.CONNECTOR_RUNTIME_SHARD_COUNT,
    1,
    "CONNECTOR_RUNTIME_SHARD_COUNT",
    1,
    16
  );
  const connectorRuntimeShardIndex = boundedNonNegativeInteger(
    env.CONNECTOR_RUNTIME_SHARD_INDEX,
    0,
    "CONNECTOR_RUNTIME_SHARD_INDEX",
    0,
    connectorRuntimeShardCount - 1
  );
  const frequencyCollectionConcurrency = boundedInteger(
    env.FREQUENCY_COLLECTION_CONCURRENCY,
    4,
    "FREQUENCY_COLLECTION_CONCURRENCY",
    1,
    64
  );
  const keywordResearchConcurrency = boundedInteger(
    env.KEYWORD_RESEARCH_CONCURRENCY,
    1,
    "KEYWORD_RESEARCH_CONCURRENCY",
    1,
    32
  );
  const databasePoolMax = positiveInteger(
    env.DATABASE_POOL_MAX,
    20,
    "DATABASE_POOL_MAX"
  );
  const rankPreparationLeaseSeconds = boundedInteger(
    env.RANK_PREPARATION_LEASE_SECONDS,
    120,
    "RANK_PREPARATION_LEASE_SECONDS",
    10,
    600
  );
  const internalCommandTimeoutMs = positiveInteger(
    env.SEO_DATA_COMMAND_TIMEOUT_MS,
    60_000,
    "SEO_DATA_COMMAND_TIMEOUT_MS"
  );
  const platformApiCommandTimeoutMs = boundedInteger(
    env.PLATFORM_API_COMMAND_TIMEOUT_MS,
    5_000,
    "PLATFORM_API_COMMAND_TIMEOUT_MS",
    500,
    10_000
  );
  const authEmailEnvironment = eventEnvironment(
    env.AUTH_EMAIL_EVENT_ENVIRONMENT
  );
  const authEmailPublishTimeoutMs = boundedInteger(
    env.AUTH_EMAIL_PUBLISH_TIMEOUT_MS,
    5_000,
    "AUTH_EMAIL_PUBLISH_TIMEOUT_MS",
    250,
    10_000
  );
  const authEmailLeaseSeconds = boundedInteger(
    env.AUTH_EMAIL_LEASE_SECONDS,
    120,
    "AUTH_EMAIL_LEASE_SECONDS",
    30,
    600
  );
  const authEmailRetryBaseMs = boundedInteger(
    env.AUTH_EMAIL_RETRY_BASE_MS,
    5_000,
    "AUTH_EMAIL_RETRY_BASE_MS",
    1_000,
    60_000
  );
  const authEmailRetryMaxMs = boundedInteger(
    env.AUTH_EMAIL_RETRY_MAX_MS,
    6 * 60 * 60 * 1_000,
    "AUTH_EMAIL_RETRY_MAX_MS",
    60_000,
    24 * 60 * 60 * 1_000
  );
  const smtpConnectionTimeoutMs = boundedInteger(
    env.SMTP_CONNECTION_TIMEOUT_MS,
    10_000,
    "SMTP_CONNECTION_TIMEOUT_MS",
    1_000,
    30_000
  );
  const smtpSocketTimeoutMs = boundedInteger(
    env.SMTP_SOCKET_TIMEOUT_MS,
    60_000,
    "SMTP_SOCKET_TIMEOUT_MS",
    5_000,
    120_000
  );
  if (authEmailRetryBaseMs > authEmailRetryMaxMs) {
    throw new Error(
      "AUTH_EMAIL_RETRY_BASE_MS must not exceed AUTH_EMAIL_RETRY_MAX_MS"
    );
  }
  if (
    processRole === "AUTH_EMAIL_WORKER" &&
    authEmailLeaseSeconds * 1_000 <
      platformApiCommandTimeoutMs * 2 +
        smtpConnectionTimeoutMs * 2 +
        smtpSocketTimeoutMs +
        authEmailPublishTimeoutMs +
        5_000
  ) {
    throw new Error(
      "AUTH_EMAIL_LEASE_SECONDS must cover two HTTP calls, SMTP connect, greeting, socket and DLQ publish timeouts plus 5 seconds"
    );
  }
  if (
    rankPreparationEnabled &&
    rankPreparationLeaseSeconds * 1_000 <
    internalCommandTimeoutMs + 5_000
  ) {
    throw new Error(
      "RANK_PREPARATION_LEASE_SECONDS must exceed the SEO Data timeout by at least 5 seconds"
    );
  }
  if (
    integrationValidationLeaseSeconds * 1_000 <
    integrationValidationTimeoutMs + 5_000
  ) {
    throw new Error(
      "INTEGRATION_VALIDATION_LEASE_SECONDS must exceed the provider timeout by at least 5 seconds"
    );
  }
  if (processRole === "CONNECTOR_WORKER") {
    const connectorConcurrency =
      integrationValidationConcurrency +
      rankConnectorConcurrency +
      frequencyCollectionConcurrency +
      keywordResearchConcurrency;
    const minimumDatabasePoolMax = connectorConcurrency + 1;
    if (databasePoolMax < minimumDatabasePoolMax) {
      throw new Error(
        `DATABASE_POOL_MAX must be at least ${minimumDatabasePoolMax} for the configured connector concurrency`
      );
    }
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

  assertDistinctServiceTokens({
    PLATFORM_API_TO_JOBS_TOKEN: platformApiToken,
    JOBS_TO_SEO_DATA_TOKEN: seoDataApiToken,
    PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN:
      integrationCredentialApiToken,
    JOBS_TO_SEO_RANK_TOKEN: rankManifestApiToken,
    JOBS_TO_SEO_RANK_RESULT_TOKEN: rankResultApiToken,
    JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: rankGrantApiToken,
    JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN:
      rankBillingSettlementApiToken,
    JOBS_TO_PLATFORM_AUTOMATION_TOKEN: automationDispatchApiToken,
    JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: authEmailApiToken
  });

  return {
    processRole,
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    bindAddress: bindAddress(
      env.BIND_ADDRESS,
      nodeEnv as AppConfig["nodeEnv"]
    ),
    port: positiveInteger(env.PORT, 4002, "PORT"),
    version: optional(env, "SERVICE_VERSION") || "0.1.0",
    databaseUrl: required(env, "DATABASE_URL"),
    databasePoolMax,
    redisUrl: env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
    ...(xmlStockSoftId ? { xmlStockSoftId } : {}),
    ...(platformApiToken ? { platformApiToken } : {}),
    ...(seoDataApiToken ? { seoDataApiToken } : {}),
    ...(integrationCredentialApiToken
      ? { integrationCredentialApiToken }
      : {}),
    ...(rankManifestApiToken ? { rankManifestApiToken } : {}),
    ...(rankResultApiToken ? { rankResultApiToken } : {}),
    ...(rankGrantApiToken ? { rankGrantApiToken } : {}),
    ...(rankBillingSettlementApiToken
      ? { rankBillingSettlementApiToken }
      : {}),
    ...(automationDispatchApiToken
      ? { automationDispatchApiToken }
      : {}),
    ...(authEmailApiToken ? { authEmailApiToken } : {}),
    internalCommandTimeoutMs,
    platformApiCommandTimeoutMs,
    services: {
      seoData:
        optional(env, "SEO_DATA_URL") || "http://127.0.0.1:4001",
      platformApi:
        optional(env, "PLATFORM_API_URL") || "http://127.0.0.1:4000"
    },
    nats: {
      url: natsUrl || "nats://127.0.0.1:4222",
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
      ...(s3KeyPrefix ? { objectKeyPrefix: s3KeyPrefix } : {}),
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
      ...(emailMessageIdDomain
        ? { messageIdDomain: emailMessageIdDomain }
        : {}),
      ...(smtpHost ? { host: smtpHost } : {}),
      port: boundedInteger(env.SMTP_PORT, 587, "SMTP_PORT", 1, 65_535),
      secure: bool(env.SMTP_SECURE),
      ...(smtpUser ? { user: smtpUser } : {}),
      ...(smtpPassword ? { password: smtpPassword } : {}),
      connectionTimeoutMs: smtpConnectionTimeoutMs,
      socketTimeoutMs: smtpSocketTimeoutMs
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
    platformProviderCredentials: {
      ...(platformXmlstockEnabled &&
      platformXmlstockCredentials
        ? {
            XMLSTOCK: platformXmlstockCredentials
          }
        : {}),
      ...(platformArsenkinEnabled && platformArsenkinApiKeys
        ? {
            ARSENKIN: platformArsenkinApiKeys.map((apiKey) => ({ apiKey }))
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
      concurrency: integrationValidationConcurrency
    },
    connectorRuntime: {
      dispatchIntervalMs: boundedInteger(
        env.CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS,
        1_000,
        "CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS",
        250,
        60_000
      ),
      paidExecutionEnabled: bool(
        env.CONNECTOR_PAID_RUNTIME_ENABLED,
        true
      ),
      shardIndex: connectorRuntimeShardIndex,
      shardCount: connectorRuntimeShardCount,
      rankConcurrency: rankConnectorConcurrency,
      frequencyConcurrency: frequencyCollectionConcurrency,
      keywordResearchConcurrency
    },
    rankPreparation: {
      enabled: rankPreparationEnabled,
      leaseSeconds: rankPreparationLeaseSeconds,
      dispatchSeconds: boundedInteger(
        env.RANK_PREPARATION_DISPATCH_SECONDS,
        15,
        "RANK_PREPARATION_DISPATCH_SECONDS",
        5,
        300
      ),
      resultPersistenceDispatchIntervalMs: boundedInteger(
        env.RANK_RESULT_PERSISTENCE_DISPATCH_INTERVAL_MS,
        1_000,
        "RANK_RESULT_PERSISTENCE_DISPATCH_INTERVAL_MS",
        250,
        60_000
      ),
      concurrency: boundedInteger(
        env.RANK_PREPARATION_CONCURRENCY,
        2,
        "RANK_PREPARATION_CONCURRENCY",
        1,
        16
      )
    },
    rankExecution: {
      submitEnabled: rankProviderSubmitEnabled,
      killSwitchVersion: rankProviderKillSwitchVersion
    },
    crawl: {
      enabled: processRole === "CRAWL_WORKER",
      concurrency: boundedInteger(
        env.CRAWL_CONCURRENCY,
        2,
        "CRAWL_CONCURRENCY",
        1,
        8
      ),
      dispatchSeconds: boundedInteger(
        env.CRAWL_DISPATCH_SECONDS,
        15,
        "CRAWL_DISPATCH_SECONDS",
        5,
        300
      ),
      leaseSeconds: boundedInteger(
        env.CRAWL_LEASE_SECONDS,
        180,
        "CRAWL_LEASE_SECONDS",
        90,
        600
      ),
      requestTimeoutMs: boundedInteger(
        env.CRAWL_REQUEST_TIMEOUT_MS,
        20_000,
        "CRAWL_REQUEST_TIMEOUT_MS",
        1_000,
        120_000
      ),
      maxResponseBytes: boundedInteger(
        env.CRAWL_MAX_RESPONSE_BYTES,
        2_000_000,
        "CRAWL_MAX_RESPONSE_BYTES",
        100_000,
        10_000_000
      ),
      maxRedirects: boundedInteger(
        env.CRAWL_MAX_REDIRECTS,
        5,
        "CRAWL_MAX_REDIRECTS",
        0,
        10
      ),
      userAgent: `SeoPlatformCrawler/1.0 (+${crawlContactUrl ?? "https://crawler.invalid/crawler"})`
    },
    authEmail: {
      enabled: processRole === "AUTH_EMAIL_WORKER",
      ...(authEmailEnvironment
        ? { environment: authEmailEnvironment }
        : {}),
      streamName: "AUTH_EMAIL_EVENTS",
      durableName: "jobs_auth_email_v1",
      deadLetterStreamName: "DOMAIN_EVENTS_DLQ",
      maxAttempts: boundedInteger(
        env.AUTH_EMAIL_MAX_ATTEMPTS,
        6,
        "AUTH_EMAIL_MAX_ATTEMPTS",
        1,
        20
      ),
      leaseSeconds: authEmailLeaseSeconds,
      dispatchMs: boundedInteger(
        env.AUTH_EMAIL_DISPATCH_MS,
        1_000,
        "AUTH_EMAIL_DISPATCH_MS",
        250,
        60_000
      ),
      fetchExpiresMs: boundedInteger(
        env.AUTH_EMAIL_FETCH_EXPIRES_MS,
        1_000,
        "AUTH_EMAIL_FETCH_EXPIRES_MS",
        250,
        30_000
      ),
      publishTimeoutMs: authEmailPublishTimeoutMs,
      retryBaseMs: authEmailRetryBaseMs,
      retryMaxMs: authEmailRetryMaxMs,
      maxPayloadBytes: boundedInteger(
        env.AUTH_EMAIL_MAX_PAYLOAD_BYTES,
        65_536,
        "AUTH_EMAIL_MAX_PAYLOAD_BYTES",
        1_024,
        65_536
      ),
      shutdownGraceMs: boundedInteger(
        env.AUTH_EMAIL_SHUTDOWN_GRACE_MS,
        10_000,
        "AUTH_EMAIL_SHUTDOWN_GRACE_MS",
        1_000,
        30_000
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
        5_000,
        "IMPORT_STAGING_BATCH_ROWS"
      ),
      previewRows: positiveInteger(
        env.IMPORT_PREVIEW_ROWS,
        20,
        "IMPORT_PREVIEW_ROWS"
      ),
      publishBatchRows: positiveInteger(
        env.IMPORT_PUBLISH_BATCH_ROWS,
        5_000,
        "IMPORT_PUBLISH_BATCH_ROWS"
      )
    }
  };
}

function assertDistinctServiceTokens(
  tokens: Readonly<Record<string, string | undefined>>
): void {
  const configured = Object.entries(tokens).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  );
  for (let index = 0; index < configured.length; index += 1) {
    const current = configured[index];
    if (!current) continue;
    for (
      let otherIndex = index + 1;
      otherIndex < configured.length;
      otherIndex += 1
    ) {
      const other = configured[otherIndex];
      if (other && current[1] === other[1]) {
        throw new Error(
          `${current[0]} must differ from ${other[0]}`
        );
      }
    }
  }
}

function assertProcessAdapterCapabilities(
  env: NodeJS.ProcessEnv,
  processRole: Exclude<JobsProcessRole, "SYSTEM_WORKER">,
  enabled: {
    readonly s3Enabled: boolean;
    readonly emailEnabled: boolean;
    readonly malwareScannerEnabled: boolean;
  }
): void {
  const natsConfigured = [
    "NATS_URL",
    "NATS_USER",
    "NATS_PASSWORD"
  ].some((key) => optional(env, key) !== undefined);
  if (
    processRole !== "HTTP" &&
    processRole !== "AUTH_EMAIL_WORKER" &&
    natsConfigured
  ) {
    throw new Error(
      `${processRole} must not receive NATS configuration or credentials`
    );
  }

  const s3ConfigurationPresent = [
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_ENDPOINT",
    "S3_BUCKET_UPLOADS",
    "S3_BUCKET_ARTIFACTS",
    "S3_KEY_PREFIX"
  ].some((key) => optional(env, key) !== undefined);
  if (
    !["HTTP", "IMPORT_WORKER", "INSPECTION_WORKER"].includes(processRole) &&
    (enabled.s3Enabled || s3ConfigurationPresent)
  ) {
    throw new Error(
      `${processRole} must not receive S3 credentials or enable S3`
    );
  }

  const smtpCredentialConfigured =
    optional(env, "SMTP_USER") !== undefined ||
    optional(env, "SMTP_PASSWORD") !== undefined;
  if (
    processRole !== "AUTH_EMAIL_WORKER" &&
    (enabled.emailEnabled || smtpCredentialConfigured)
  ) {
    throw new Error(
      `${processRole} must not receive SMTP credentials or enable email`
    );
  }

  const malwareConfigured =
    enabled.malwareScannerEnabled ||
    optional(env, "MALWARE_SCANNER_HOST") !== undefined;
  if (processRole !== "INSPECTION_WORKER" && malwareConfigured) {
    throw new Error(
      `${processRole} must not receive malware scanner configuration or enable malware scanning`
    );
  }
}
