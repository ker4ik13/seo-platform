import { ECDH } from "node:crypto";
import { isIP } from "node:net";

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly redisUrl: string;
  readonly internalApiToken?: string;
  readonly notificationApiToken?: string;
  readonly nats: {
    readonly url: string;
    readonly user?: string;
    readonly password?: string;
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
    /^(?:replace-me|replace-with-)/iu.test(value)
  );
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

  const natsUser = optional(env, "NATS_USER");
  const natsPassword = optional(env, "NATS_PASSWORD");
  const internalApiToken = optional(env, "INTERNAL_API_TOKEN");
  const notificationApiToken = optional(
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
    (!internalApiToken || internalApiToken.length < 32)
  ) {
    throw new Error(
      "INTERNAL_API_TOKEN with at least 32 characters is required in production"
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
      notificationApiToken === internalApiToken ||
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

  return {
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    port: positiveInteger(env.PORT, 4003, "PORT"),
    version: env.SERVICE_VERSION?.trim() || "0.1.0",
    databaseUrl: required(env, "DATABASE_URL"),
    databasePoolMax: positiveInteger(
      env.DATABASE_POOL_MAX,
      20,
      "DATABASE_POOL_MAX"
    ),
    redisUrl: env.REDIS_URL?.trim() || "redis://localhost:6379",
    ...(internalApiToken ? { internalApiToken } : {}),
    ...(notificationApiToken ? { notificationApiToken } : {}),
    nats: {
      url: env.NATS_URL?.trim() || "nats://localhost:4222",
      ...(natsUser ? { user: natsUser } : {}),
      ...(natsPassword ? { password: natsPassword } : {})
    },
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
