import {
  processEnvironment,
  type ProcessDefinition
} from "@seo-platform/process-supervisor";

const DATABASE_POOL = ["DATABASE_POOL_MAX"] as const;
const S3_KEYS = [
  "S3_ACCESS_KEY_ID",
  "S3_BUCKET_ARTIFACTS",
  "S3_BUCKET_UPLOADS",
  "S3_ENABLED",
  "S3_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
  "S3_KEY_PREFIX",
  "S3_REGION",
  "S3_SECRET_ACCESS_KEY",
  "S3_SIGNED_URL_TTL_SECONDS"
] as const;
const SEO_KEYS = [
  "JOBS_TO_SEO_DATA_TOKEN",
  "SEO_DATA_COMMAND_TIMEOUT_MS",
  "SEO_DATA_URL"
] as const;
const HTTP_KEYS = [
  ...DATABASE_POOL,
  ...S3_KEYS,
  ...SEO_KEYS,
  "BIND_ADDRESS",
  "INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION",
  "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION",
  "INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS",
  "INTEGRATION_CREDENTIAL_KEYS",
  "INTERNAL_COMMAND_TIMEOUT_MS",
  "JOBS_TO_PLATFORM_AUTOMATION_TOKEN",
  "NATS_URL",
  "PLATFORM_API_COMMAND_TIMEOUT_MS",
  "PLATFORM_API_URL",
  "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
  "PLATFORM_API_TO_JOBS_TOKEN",
  "PLATFORM_ARSENKIN_ENABLED",
  "PLATFORM_ARSENKIN_API_KEY",
  "PLATFORM_ARSENKIN_API_KEYS",
  "PLATFORM_XMLSTOCK_ENABLED",
  "PLATFORM_XMLSTOCK_ACCOUNT_ID",
  "PLATFORM_XMLSTOCK_ACCOUNT_IDS",
  "PLATFORM_XMLSTOCK_API_KEY",
  "PLATFORM_XMLSTOCK_API_KEYS",
  "PLATFORM_XMLSTOCK_SOFT_ID",
  "WORKER_GATEWAY_ENABLED",
  "UPLOAD_EXPIRES_HOURS",
  "UPLOAD_MAX_SIZE_BYTES",
  "UPLOAD_PART_SIZE_BYTES"
] as const;
const IMPORT_KEYS = [
  ...DATABASE_POOL,
  ...S3_KEYS,
  ...SEO_KEYS,
  "UPLOAD_FILE_RETENTION_DAYS",
  "EXPORT_FILE_RETENTION_DAYS",
  "IMPORT_PARSE_CONCURRENCY",
  "IMPORT_PARSE_DISPATCH_SECONDS",
  "IMPORT_PARSE_HEARTBEAT_SECONDS",
  "IMPORT_PARSE_LEASE_MINUTES",
  "IMPORT_PREVIEW_ROWS",
  "IMPORT_PUBLISH_BATCH_ROWS",
  "IMPORT_STAGING_BATCH_ROWS"
] as const;
const INSPECTION_KEYS = [
  ...DATABASE_POOL,
  ...S3_KEYS,
  "MALWARE_SCANNER_CONNECT_TIMEOUT_MS",
  "MALWARE_SCANNER_HOST",
  "MALWARE_SCANNER_PORT",
  "MALWARE_SCANNER_SCAN_TIMEOUT_MS",
  "UPLOAD_INSPECTION_CONCURRENCY",
  "UPLOAD_INSPECTION_DISPATCH_SECONDS",
  "UPLOAD_INSPECTION_HEARTBEAT_SECONDS",
  "UPLOAD_INSPECTION_LEASE_MINUTES"
] as const;
const RANK_KEYS = [
  ...DATABASE_POOL,
  "CONNECTOR_RUNTIME_SHARD_COUNT",
  "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
  "JOBS_TO_SEO_RANK_RESULT_TOKEN",
  "JOBS_TO_SEO_RANK_TOKEN",
  "PLATFORM_API_COMMAND_TIMEOUT_MS",
  "PLATFORM_API_URL",
  "RANK_PREPARATION_CONCURRENCY",
  "RANK_PREPARATION_DISPATCH_SECONDS",
  "RANK_PREPARATION_LEASE_SECONDS",
  "RANK_CONNECTOR_CONCURRENCY",
  "RANK_RESULT_PERSISTENCE_DISPATCH_INTERVAL_MS",
  "RANK_PROVIDER_KILL_SWITCH_VERSION",
  "SEO_DATA_COMMAND_TIMEOUT_MS",
  "SEO_DATA_URL"
] as const;
const CRAWL_KEYS = [
  ...DATABASE_POOL,
  ...SEO_KEYS,
  "CRAWL_CONCURRENCY",
  "CRAWL_CONTACT_URL",
  "CRAWL_DISPATCH_SECONDS",
  "CRAWL_LEASE_SECONDS",
  "CRAWL_MAX_REDIRECTS",
  "CRAWL_MAX_RESPONSE_BYTES",
  "CRAWL_REQUEST_TIMEOUT_MS"
] as const;
const CONNECTOR_KEYS = [
  ...DATABASE_POOL,
  ...SEO_KEYS,
  "JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN",
  "PLATFORM_API_COMMAND_TIMEOUT_MS",
  "PLATFORM_API_URL",
  "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION",
  "INTEGRATION_CREDENTIAL_KEYS",
  "INTEGRATION_VALIDATION_CONCURRENCY",
  "INTEGRATION_VALIDATION_DISPATCH_SECONDS",
  "INTEGRATION_VALIDATION_LEASE_SECONDS",
  "INTEGRATION_VALIDATION_TIMEOUT_MS",
  "CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS",
  "CONNECTOR_PAID_RUNTIME_ENABLED",
  "CONNECTOR_RUNTIME_SHARD_COUNT",
  "CONNECTOR_RUNTIME_SHARD_INDEX",
  "RANK_CONNECTOR_CONCURRENCY",
  "RANK_CONNECTOR_CLAIM_CONCURRENCY",
  "FREQUENCY_COLLECTION_CONCURRENCY",
  "KEYWORD_RESEARCH_CONCURRENCY",
  "XMLSTOCK_GLOBAL_HTTP_CONCURRENCY",
  "RANK_PROVIDER_KILL_SWITCH_VERSION",
  "PLATFORM_XMLSTOCK_SOFT_ID"
] as const;
const AUTH_EMAIL_KEYS = [
  ...DATABASE_POOL,
  "AUTH_EMAIL_DISPATCH_MS",
  "AUTH_EMAIL_EVENT_ENVIRONMENT",
  "AUTH_EMAIL_FETCH_EXPIRES_MS",
  "AUTH_EMAIL_LEASE_SECONDS",
  "AUTH_EMAIL_MAX_ATTEMPTS",
  "AUTH_EMAIL_MAX_PAYLOAD_BYTES",
  "AUTH_EMAIL_PUBLISH_TIMEOUT_MS",
  "AUTH_EMAIL_RETRY_BASE_MS",
  "AUTH_EMAIL_RETRY_MAX_MS",
  "AUTH_EMAIL_SHUTDOWN_GRACE_MS",
  "EMAIL_FROM",
  "EMAIL_MESSAGE_ID_DOMAIN",
  "JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN",
  "NATS_URL",
  "PLATFORM_API_COMMAND_TIMEOUT_MS",
  "PLATFORM_API_URL",
  "SMTP_CONNECTION_TIMEOUT_MS",
  "SMTP_HOST",
  "SMTP_PASSWORD",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_SOCKET_TIMEOUT_MS",
  "SMTP_USER"
] as const;

export function executionProcessDefinitions(
  env: NodeJS.ProcessEnv
): readonly ProcessDefinition[] {
  const connectorWorkerProcesses = processCount(
    env.CONNECTOR_WORKER_PROCESSES,
    "CONNECTOR_WORKER_PROCESSES",
    2,
    16
  );
  const rankConnectorConcurrency = processCount(
    env.RANK_CONNECTOR_CONCURRENCY,
    "RANK_CONNECTOR_CONCURRENCY",
    32,
    64
  );
  const definitions: ProcessDefinition[] = [
    definition(env, "http", "./http.main.js", HTTP_KEYS, {
      BIND_ADDRESS: env.BIND_ADDRESS ?? "0.0.0.0",
      PORT: env.PORT ?? "4002",
      INTEGRATION_CREDENTIAL_ROLE:
        env.JOBS_HTTP_INTEGRATION_CREDENTIAL_ROLE === "BOTH"
          ? "BOTH"
          : "MANAGEMENT",
      ...(env.JOBS_HTTP_INTEGRATION_CREDENTIAL_ROLE === "BOTH"
        ? { JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN:
            required(env, "JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN") }
        : {}),
      DATABASE_URL: required(env, "EXECUTION_HTTP_DATABASE_URL"),
      DATABASE_POOL_MAX: env.EXECUTION_HTTP_DATABASE_POOL_MAX,
      REDIS_URL: required(env, "EXECUTION_HTTP_REDIS_URL"),
      NATS_USER: env.EXECUTION_HTTP_NATS_USER,
      NATS_PASSWORD: env.EXECUTION_HTTP_NATS_PASSWORD
    }),
    definition(
      env,
      "system-worker",
      "./worker.main.js",
      ["SYSTEM_WORKER_CONCURRENCY"],
      { REDIS_URL: required(env, "EXECUTION_SYSTEM_REDIS_URL") }
    ),
    definition(env, "import-worker", "./import-worker.main.js", IMPORT_KEYS, {
      DATABASE_URL: required(env, "EXECUTION_IMPORT_DATABASE_URL"),
      DATABASE_POOL_MAX: env.EXECUTION_IMPORT_DATABASE_POOL_MAX,
      REDIS_URL: required(env, "EXECUTION_IMPORT_REDIS_URL")
    }),
    ...repeatedDefinitions(
      env,
      "rank-worker",
      "./rank-worker.main.js",
      RANK_KEYS,
      {
        DATABASE_URL: required(env, "EXECUTION_RANK_DATABASE_URL"),
        DATABASE_POOL_MAX: env.EXECUTION_RANK_DATABASE_POOL_MAX,
        REDIS_URL: required(env, "EXECUTION_RANK_REDIS_URL"),
        CONNECTOR_RUNTIME_SHARD_COUNT: String(connectorWorkerProcesses),
        RANK_CONNECTOR_CONCURRENCY: String(rankConnectorConcurrency),
        RANK_PREPARATION_ENABLED: "true",
        RANK_PROVIDER_SUBMIT_ENABLED: "false",
        INTEGRATION_CREDENTIAL_ROLE: "DISABLED"
      },
      processCount(env.RANK_WORKER_PROCESSES, "RANK_WORKER_PROCESSES", 1, 8)
    ),
    definition(env, "crawl-worker", "./crawl-worker.main.js", CRAWL_KEYS, {
      DATABASE_URL: required(env, "EXECUTION_CRAWL_DATABASE_URL"),
      DATABASE_POOL_MAX: env.EXECUTION_CRAWL_DATABASE_POOL_MAX,
      REDIS_URL: required(env, "EXECUTION_CRAWL_REDIS_URL")
    }),
    ...repeatedDefinitions(
      env,
      "connector-worker",
      "./connector-worker.main.js",
      CONNECTOR_KEYS,
      {
        DATABASE_URL: required(env, "EXECUTION_CONNECTOR_DATABASE_URL"),
        DATABASE_POOL_MAX: env.EXECUTION_CONNECTOR_DATABASE_POOL_MAX,
        REDIS_URL: required(env, "EXECUTION_CONNECTOR_REDIS_URL"),
        INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
        RANK_PROVIDER_SUBMIT_ENABLED:
          env.RANK_PROVIDER_SUBMIT_ENABLED ?? "true",
        RANK_CONNECTOR_CONCURRENCY: String(rankConnectorConcurrency)
      },
      connectorWorkerProcesses,
      (index) => ({
        CONNECTOR_MAINTENANCE_ENABLED: index === 0 ? "true" : "false",
        CONNECTOR_PAID_RUNTIME_ENABLED:
          env.CONNECTOR_PAID_RUNTIME_ENABLED ?? "true",
        CONNECTOR_RUNTIME_SHARD_INDEX: String(index),
        CONNECTOR_RUNTIME_SHARD_COUNT: String(connectorWorkerProcesses)
      })
    )
  ];

  if (env.INSPECTION_WORKER_ENABLED === "true") {
    definitions.push(
      definition(
        env,
        "inspection-worker",
        "./inspection-worker.main.js",
        INSPECTION_KEYS,
        {
          DATABASE_URL: required(env, "EXECUTION_INSPECTION_DATABASE_URL"),
          DATABASE_POOL_MAX: env.EXECUTION_INSPECTION_DATABASE_POOL_MAX,
          REDIS_URL: required(env, "EXECUTION_INSPECTION_REDIS_URL"),
          MALWARE_SCANNER_ENABLED: "true"
        }
      )
    );
  }
  if (env.EMAIL_ENABLED === "true") {
    definitions.push(
      definition(
        env,
        "auth-email-worker",
        "./auth-email-worker.main.js",
        AUTH_EMAIL_KEYS,
        {
          DATABASE_URL: required(env, "EXECUTION_AUTH_EMAIL_DATABASE_URL"),
          DATABASE_POOL_MAX: env.EXECUTION_AUTH_EMAIL_DATABASE_POOL_MAX,
          NATS_USER: required(env, "EXECUTION_AUTH_EMAIL_NATS_USER"),
          NATS_PASSWORD: required(env, "EXECUTION_AUTH_EMAIL_NATS_PASSWORD"),
          EMAIL_ENABLED: "true"
        }
      )
    );
  }
  return definitions;
}

function repeatedDefinitions(
  env: NodeJS.ProcessEnv,
  name: string,
  entrypoint: string,
  keys: readonly string[],
  overrides: Readonly<Record<string, string | undefined>>,
  count: number,
  instanceOverrides: (
    index: number
  ) => Readonly<Record<string, string | undefined>> = () => ({})
): readonly ProcessDefinition[] {
  return Array.from({ length: count }, (_, index) =>
    definition(
      env,
      index === 0 ? name : `${name}-${index + 1}`,
      entrypoint,
      keys,
      { ...overrides, ...instanceOverrides(index) }
    )
  );
}

function processCount(
  value: string | undefined,
  key: string,
  fallback: number,
  maximum: number
): number {
  const count = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > maximum) {
    throw new Error(`${key} must be an integer between 1 and ${maximum}`);
  }
  return count;
}

function definition(
  env: NodeJS.ProcessEnv,
  name: string,
  entrypoint: string,
  keys: readonly string[],
  overrides: Readonly<Record<string, string | undefined>>
): ProcessDefinition {
  return {
    name,
    moduleUrl: new URL(entrypoint, import.meta.url),
    environment: processEnvironment(env, keys, overrides)
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required by backend-execution`);
  return value;
}
