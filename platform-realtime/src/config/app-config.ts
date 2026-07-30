import { ECDH } from "node:crypto";
import { isIP } from "node:net";
import { sessionFamilyRevokedEventSubjectV1 } from "@seo-platform/contracts";

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly redisUrl: string;
  readonly platformApiToken?: string;
  readonly notificationApiToken?: string;
  readonly nats: {
    readonly url: string;
    readonly user?: string;
    readonly password?: string;
  };
  readonly eventConsumer: {
    readonly enabled: boolean;
    readonly environment?: string;
    readonly streamName?: string;
    readonly durableName?: string;
    readonly subject?: string;
    readonly deadLetterStreamName?: string;
    readonly deadLetterSubject?: string;
    readonly fetchExpiresMs: number;
    readonly maxAttempts: number;
    readonly retryBaseMs: number;
    readonly retryMaxMs: number;
    readonly publishTimeoutMs: number;
    readonly maxPayloadBytes: number;
    readonly shutdownGraceMs: number;
  };
  readonly webOrigins: readonly string[];
  readonly webPush: {
    readonly registrationEnabled: boolean;
    readonly applicationServerKey?: string;
    readonly applicationServerKeyVersion?: number;
    readonly endpointOrigins: readonly string[];
    readonly subscriptionKeys: ReadonlyMap<number, Buffer>;
    readonly activeSubscriptionKeyVersion?: number;
    readonly fingerprintKeys: ReadonlyMap<number, Buffer>;
    readonly activeFingerprintKeyVersion?: number;
    readonly maxActiveDevices: number;
  };
}

const EVENT_STREAM_NAME = "IDENTITY_EVENTS";
const EVENT_CONSUMER_DURABLE =
  "realtime_session_family_revoked_v1";
const EVENT_DEAD_LETTER_STREAM_NAME = "DOMAIN_EVENTS_DLQ";
const EVENT_DEAD_LETTER_SUBJECT_SUFFIX =
  "dlq.realtime.identity.session-family.revoked.v1";

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

function requiredExact(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  if (value !== value.trim()) {
    throw new Error(`${key} must not contain surrounding whitespace`);
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

function optional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function isPlaceholderSecret(value: string | undefined): boolean {
  return (
    value !== undefined &&
    /^(?:replace-me|replace-with-|example(?:-|$)|change-?me|your[-_])/iu.test(
      value
    )
  );
}

function serviceToken(
  env: NodeJS.ProcessEnv,
  key: string
): string | undefined {
  const value = env[key];
  if (value === undefined || value === "") return undefined;
  if (isPlaceholderSecret(value)) {
    throw new Error(
      `${key} must be a generated distinct token and must not use an example placeholder`
    );
  }
  if (
    value.length < 32 ||
    value.length > 512 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x21 || code > 0x7e || character === ",";
    })
  ) {
    throw new Error(
      `${key} must contain 32 to 512 visible ASCII characters without whitespace or commas`
    );
  }
  return value;
}

function boundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  key: string,
  maximum: number
): number {
  const parsed = positiveInteger(value, fallback, key);
  if (parsed > maximum) {
    throw new Error(`${key} must be no greater than ${maximum}`);
  }
  return parsed;
}

function boundedIntegerRange(
  value: string | undefined,
  fallback: number,
  key: string,
  minimum: number,
  maximum: number
): number {
  const parsed = boundedPositiveInteger(value, fallback, key, maximum);
  if (parsed < minimum) {
    throw new Error(`${key} must be at least ${minimum}`);
  }
  return parsed;
}

function boundedEventConsumerConfig(
  env: NodeJS.ProcessEnv,
  nodeEnv: AppConfig["nodeEnv"]
): AppConfig["eventConsumer"] {
  const enabled = bool(env.NATS_EVENT_CONSUMER_ENABLED);
  if (nodeEnv === "production" && !enabled) {
    throw new Error(
      "NATS_EVENT_CONSUMER_ENABLED=true is required in production"
    );
  }

  const fetchExpiresMs = boundedIntegerRange(
    env.NATS_EVENT_FETCH_EXPIRES_MS,
    1_000,
    "NATS_EVENT_FETCH_EXPIRES_MS",
    1_000,
    30_000
  );
  const maxAttempts = boundedPositiveInteger(
    env.NATS_EVENT_MAX_ATTEMPTS,
    8,
    "NATS_EVENT_MAX_ATTEMPTS",
    100
  );
  const retryBaseMs = boundedIntegerRange(
    env.NATS_EVENT_RETRY_BASE_MS,
    1_000,
    "NATS_EVENT_RETRY_BASE_MS",
    100,
    60_000
  );
  const retryMaxMs = boundedIntegerRange(
    env.NATS_EVENT_RETRY_MAX_MS,
    60_000,
    "NATS_EVENT_RETRY_MAX_MS",
    100,
    600_000
  );
  const publishTimeoutMs = boundedIntegerRange(
    env.NATS_EVENT_PUBLISH_TIMEOUT_MS,
    5_000,
    "NATS_EVENT_PUBLISH_TIMEOUT_MS",
    100,
    30_000
  );
  const maxPayloadBytes = boundedPositiveInteger(
    env.NATS_EVENT_MAX_PAYLOAD_BYTES,
    65_536,
    "NATS_EVENT_MAX_PAYLOAD_BYTES",
    65_536
  );
  const shutdownGraceMs = boundedIntegerRange(
    env.NATS_EVENT_SHUTDOWN_GRACE_MS,
    10_000,
    "NATS_EVENT_SHUTDOWN_GRACE_MS",
    100,
    30_000
  );
  if (retryMaxMs < retryBaseMs) {
    throw new Error(
      "NATS_EVENT_RETRY_MAX_MS must be greater than or equal to NATS_EVENT_RETRY_BASE_MS"
    );
  }

  if (!enabled) {
    return {
      enabled,
      fetchExpiresMs,
      maxAttempts,
      retryBaseMs,
      retryMaxMs,
      publishTimeoutMs,
      maxPayloadBytes,
      shutdownGraceMs
    };
  }

  const environment = requiredExact(env, "NATS_EVENT_ENVIRONMENT");
  const streamName = requiredExact(env, "NATS_EVENT_STREAM");
  const durableName = requiredExact(
    env,
    "NATS_EVENT_CONSUMER_DURABLE"
  );
  const deadLetterStreamName = requiredExact(
    env,
    "NATS_EVENT_DLQ_STREAM"
  );
  const deadLetterSubject = requiredExact(
    env,
    "NATS_EVENT_DLQ_SUBJECT"
  );
  const environmentPattern =
    /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;
  if (
    !environmentPattern.test(environment) ||
    isPlaceholderSecret(environment)
  ) {
    throw new Error(
      "NATS_EVENT_ENVIRONMENT must be a canonical lowercase NATS token"
    );
  }
  if (streamName !== EVENT_STREAM_NAME) {
    throw new Error(
      `NATS_EVENT_STREAM must be exactly ${EVENT_STREAM_NAME}`
    );
  }
  if (durableName !== EVENT_CONSUMER_DURABLE) {
    throw new Error(
      `NATS_EVENT_CONSUMER_DURABLE must be exactly ${EVENT_CONSUMER_DURABLE}`
    );
  }
  if (deadLetterStreamName !== EVENT_DEAD_LETTER_STREAM_NAME) {
    throw new Error(
      `NATS_EVENT_DLQ_STREAM must be exactly ${EVENT_DEAD_LETTER_STREAM_NAME}`
    );
  }
  const subject = sessionFamilyRevokedEventSubjectV1(environment);
  const expectedDeadLetterSubject =
    `${environment}.${EVENT_DEAD_LETTER_SUBJECT_SUFFIX}`;
  if (deadLetterSubject !== expectedDeadLetterSubject) {
    throw new Error(
      `NATS_EVENT_DLQ_SUBJECT must be exactly ${expectedDeadLetterSubject}`
    );
  }

  return {
    enabled,
    environment,
    streamName,
    durableName,
    subject,
    deadLetterStreamName,
    deadLetterSubject,
    fetchExpiresMs,
    maxAttempts,
    retryBaseMs,
    retryMaxMs,
    publishTimeoutMs,
    maxPayloadBytes,
    shutdownGraceMs
  };
}

function keyVersion(
  value: string | undefined,
  environmentVariable: string
): number | undefined {
  if (value === undefined) return undefined;
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
      key.toString("base64url") !== match[2] ||
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

function pushEndpointOrigins(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        throw new Error(
          "WEB_PUSH_ENDPOINT_ORIGINS must contain valid HTTPS origins"
        );
      }
      const hostname = url.hostname.replace(/^\[|\]$/gu, "");
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        isIP(hostname) !== 0
      ) {
        throw new Error(
          "WEB_PUSH_ENDPOINT_ORIGINS must contain public HTTPS origins without paths, credentials or custom ports"
        );
      }
      return url.origin;
    });
  if (new Set(origins).size !== origins.length) {
    throw new Error("WEB_PUSH_ENDPOINT_ORIGINS must be unique");
  }
  return origins;
}

function applicationServerKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{87}$/u.test(value)) {
    throw new Error(
      "WEB_PUSH_VAPID_PUBLIC_KEY must be canonical base64url"
    );
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== 65 ||
    decoded[0] !== 4 ||
    decoded.toString("base64url") !== value
  ) {
    throw new Error(
      "WEB_PUSH_VAPID_PUBLIC_KEY must encode an uncompressed P-256 key"
    );
  }
  try {
    ECDH.convertKey(
      decoded,
      "prime256v1",
      undefined,
      undefined,
      "uncompressed"
    );
  } catch {
    throw new Error(
      "WEB_PUSH_VAPID_PUBLIC_KEY must encode a valid P-256 point"
    );
  }
  return value;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }
  const typedNodeEnv = nodeEnv as AppConfig["nodeEnv"];

  const natsUser = optional(env, "NATS_USER");
  const natsPassword = optional(env, "NATS_PASSWORD");
  const platformApiToken = serviceToken(
    env,
    "PLATFORM_API_TO_REALTIME_TOKEN"
  );
  const notificationApiToken = serviceToken(
    env,
    "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN"
  );
  const registrationEnabled = bool(env.WEB_PUSH_REGISTRATION_ENABLED);
  const vapidPublicKey = applicationServerKey(
    optional(env, "WEB_PUSH_VAPID_PUBLIC_KEY")
  );
  const vapidKeyVersion = keyVersion(
    optional(env, "WEB_PUSH_VAPID_KEY_VERSION"),
    "WEB_PUSH_VAPID_KEY_VERSION"
  );
  const subscriptionKeys = versionedKeyring(
    env.WEB_PUSH_SUBSCRIPTION_KEYS,
    "WEB_PUSH_SUBSCRIPTION_KEYS"
  );
  const activeSubscriptionKeyVersion = keyVersion(
    optional(env, "WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION"),
    "WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION"
  );
  const fingerprintKeys = versionedKeyring(
    env.WEB_PUSH_FINGERPRINT_KEYS,
    "WEB_PUSH_FINGERPRINT_KEYS"
  );
  const activeFingerprintKeyVersion = keyVersion(
    optional(env, "WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION"),
    "WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION"
  );
  const endpointOrigins = pushEndpointOrigins(
    env.WEB_PUSH_ENDPOINT_ORIGINS
  );
  const webOrigins = (env.WEB_ORIGINS ?? "http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (webOrigins.length === 0) {
    throw new Error("WEB_ORIGINS must contain at least one origin");
  }
  if (
    nodeEnv === "production" &&
    (!platformApiToken || platformApiToken.length < 32)
  ) {
    throw new Error(
      "PLATFORM_API_TO_REALTIME_TOKEN with at least 32 characters is required in production"
    );
  }
  if (env.INTERNAL_API_TOKEN?.trim()) {
    throw new Error(
      "INTERNAL_API_TOKEN is no longer supported; configure caller/audience tokens"
    );
  }
  if (
    nodeEnv === "production" &&
    (!notificationApiToken ||
      notificationApiToken.length < 32 ||
      isPlaceholderSecret(notificationApiToken))
  ) {
    throw new Error(
      "A generated PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    notificationApiToken &&
    (notificationApiToken.length < 32 ||
      notificationApiToken === platformApiToken ||
      isPlaceholderSecret(notificationApiToken))
  ) {
    throw new Error(
      "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN must be a generated distinct token with at least 32 characters"
    );
  }
  if (
    registrationEnabled &&
    (!notificationApiToken ||
      !vapidPublicKey ||
      vapidKeyVersion === undefined ||
      endpointOrigins.length === 0 ||
      activeSubscriptionKeyVersion === undefined ||
      !subscriptionKeys.has(activeSubscriptionKeyVersion) ||
      activeFingerprintKeyVersion === undefined ||
      !fingerprintKeys.has(activeFingerprintKeyVersion))
  ) {
    throw new Error(
      "Web Push registration is enabled but its API token, VAPID key, endpoint origins or active crypto keyrings are incomplete"
    );
  }
  if (
    [...subscriptionKeys.values()].some((encryptionKey) =>
      [...fingerprintKeys.values()].some((fingerprintKey) =>
        encryptionKey.equals(fingerprintKey)
      )
    )
  ) {
    throw new Error(
      "Web Push encryption and fingerprint keyrings must use distinct key material"
    );
  }
  const eventConsumer = boundedEventConsumerConfig(env, typedNodeEnv);

  return {
    nodeEnv: typedNodeEnv,
    port: positiveInteger(env.PORT, 4003, "PORT"),
    version: env.SERVICE_VERSION?.trim() || "0.1.0",
    databaseUrl: required(env, "DATABASE_URL"),
    databasePoolMax: positiveInteger(
      env.DATABASE_POOL_MAX,
      20,
      "DATABASE_POOL_MAX"
    ),
    redisUrl: env.REDIS_URL?.trim() || "redis://localhost:6379",
    ...(platformApiToken ? { platformApiToken } : {}),
    ...(notificationApiToken ? { notificationApiToken } : {}),
    nats: {
      url: env.NATS_URL?.trim() || "nats://localhost:4222",
      ...(natsUser ? { user: natsUser } : {}),
      ...(natsPassword ? { password: natsPassword } : {})
    },
    eventConsumer,
    webOrigins,
    webPush: {
      registrationEnabled,
      ...(vapidPublicKey
        ? { applicationServerKey: vapidPublicKey }
        : {}),
      ...(vapidKeyVersion !== undefined
        ? { applicationServerKeyVersion: vapidKeyVersion }
        : {}),
      endpointOrigins,
      subscriptionKeys,
      ...(activeSubscriptionKeyVersion !== undefined
        ? { activeSubscriptionKeyVersion }
        : {}),
      fingerprintKeys,
      ...(activeFingerprintKeyVersion !== undefined
        ? { activeFingerprintKeyVersion }
        : {}),
      maxActiveDevices: boundedPositiveInteger(
        env.WEB_PUSH_MAX_ACTIVE_DEVICES,
        20,
        "WEB_PUSH_MAX_ACTIVE_DEVICES",
        100
      )
    }
  };
}
