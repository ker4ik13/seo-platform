import {
  maximumPlatformRankKeywordPriceMinor,
  sessionFamilyRevokedEventSubjectV1,
  transactionalEmailEventSubjectV1
} from "@seo-platform/contracts";

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly bindAddress: "127.0.0.1" | "0.0.0.0";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly dependencyTimeoutMs: number;
  readonly internalCommandTimeoutMs: number;
  readonly seoDataApiToken?: string;
  readonly jobsApiToken?: string;
  readonly realtimeApiToken?: string;
  readonly integrationCredentialApiToken?: string;
  readonly realtimeNotificationApiToken?: string;
  readonly realtimeDeliveryAuthorizationApiToken?: string;
  readonly rankExecutionGrantApiToken?: string;
  readonly rankBillingSettlementApiToken?: string;
  readonly automationDispatchApiToken?: string;
  readonly authEmailApiToken?: string;
  readonly webPublicUrl?: string;
  readonly corsOrigins: readonly string[];
  readonly nats: {
    readonly url: string;
    readonly user?: string;
    readonly password?: string;
  };
  readonly outboxPublisher: {
    readonly enabled: boolean;
    readonly eventEnvironment?: string;
    readonly streamName?: string;
    readonly authEmailStreamName?: string;
    readonly pollIntervalMs: number;
    readonly batchSize: number;
    readonly maxAttempts: number;
    readonly retryBaseMs: number;
    readonly retryMaxMs: number;
    readonly publishTimeoutMs: number;
  };
  readonly sessionExpirySweeper: {
    readonly enabled: boolean;
    readonly intervalMs: number;
    readonly batchSize: number;
    readonly transactionTimeoutMs: number;
    readonly lockTimeoutMs: number;
  };
  readonly billing: {
    readonly yookassa: {
      readonly enabled: boolean;
      readonly apiBaseUrl: string;
      readonly shopId?: string;
      readonly secretKey?: string;
      readonly returnUrl?: string;
      readonly requestTimeoutMs: number;
      readonly validateWebhookSourceIp: boolean;
    };
    readonly reconciliation: {
      readonly enabled: boolean;
      readonly intervalMs: number;
      readonly batchSize: number;
    };
    readonly providerUsage: {
      readonly XMLSTOCK: {
        readonly enabled: boolean;
        readonly rankKeywordPriceMinor?: number;
        readonly dailySpendLimitMinor?: number;
        readonly monthlySpendLimitMinor?: number;
      };
      readonly ARSENKIN: {
        readonly enabled: boolean;
        readonly rankKeywordPriceMinor?: number;
        readonly dailySpendLimitMinor?: number;
        readonly monthlySpendLimitMinor?: number;
      };
    };
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

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive safe integer`);
  }

  return parsed;
}

function integerInRange(
  value: string | undefined,
  fallback: number,
  key: string,
  minimum: number,
  maximum: number
): number {
  const parsed = positiveInteger(value, fallback, key);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function optionalPlatformRankKeywordPriceMinor(
  value: string | undefined,
  key: string
): number | undefined {
  const price = optionalPlatformAmountMinor(value, key);
  if (
    price !== undefined &&
    price > maximumPlatformRankKeywordPriceMinor
  ) {
    throw new Error(
      `${key} must be a positive safe integer no greater than ${maximumPlatformRankKeywordPriceMinor}`
    );
  }
  return price;
}

function optionalPlatformAmountMinor(
  value: string | undefined,
  key: string
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (!/^[1-9][0-9]{0,15}$/u.test(value)) {
    throw new Error(`${key} must be a positive safe integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${key} must be a positive safe integer`);
  }
  return parsed;
}

function validatePlatformSpendLimits(
  enabled: boolean,
  dailySpendLimitMinor: number | undefined,
  monthlySpendLimitMinor: number | undefined,
  provider: "XMLSTOCK" | "ARSENKIN"
): void {
  if (!enabled) return;
  if (dailySpendLimitMinor === undefined) {
    throw new Error(
      `PLATFORM_${provider}_DAILY_SPEND_LIMIT_MINOR is required when ${provider} platform usage is enabled`
    );
  }
  if (monthlySpendLimitMinor === undefined) {
    throw new Error(
      `PLATFORM_${provider}_MONTHLY_SPEND_LIMIT_MINOR is required when ${provider} platform usage is enabled`
    );
  }
  if (monthlySpendLimitMinor < dailySpendLimitMinor) {
    throw new Error(
      `PLATFORM_${provider}_MONTHLY_SPEND_LIMIT_MINOR must be greater than or equal to PLATFORM_${provider}_DAILY_SPEND_LIMIT_MINOR`
    );
  }
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

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const natsUser = env.NATS_USER?.trim();
  const natsPassword = env.NATS_PASSWORD?.trim();
  const passwordPepper = env.AUTH_PASSWORD_PEPPER?.trim();
  const dataEncryptionKey = env.AUTH_DATA_ENCRYPTION_KEY?.trim();
  const seoDataApiToken = serviceToken(
    env,
    "PLATFORM_API_TO_SEO_DATA_TOKEN"
  );
  const jobsApiToken = serviceToken(env, "PLATFORM_API_TO_JOBS_TOKEN");
  const realtimeApiToken = serviceToken(
    env,
    "PLATFORM_API_TO_REALTIME_TOKEN"
  );
  const integrationCredentialApiToken = serviceToken(
    env,
    "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN"
  );
  const realtimeNotificationApiToken = serviceToken(
    env,
    "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN"
  );
  const realtimeDeliveryAuthorizationApiToken = serviceToken(
    env,
    "REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN"
  );
  const rankExecutionGrantApiToken = serviceToken(
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
  const webPublicUrl = optionalWebPublicUrl(
    env.WEB_PUBLIC_URL,
    nodeEnv as AppConfig["nodeEnv"]
  );
  const yookassaEnabled = booleanValue(
    env.YOOKASSA_ENABLED,
    false,
    "YOOKASSA_ENABLED"
  );
  const yookassaShopId = env.YOOKASSA_SHOP_ID?.trim();
  const yookassaSecretKey = env.YOOKASSA_SECRET_KEY?.trim();
  const yookassaReturnUrl = optionalYookassaReturnUrl(
    env.YOOKASSA_RETURN_URL,
    webPublicUrl,
    nodeEnv as AppConfig["nodeEnv"]
  );
  const yookassaApiBaseUrl = yookassaBaseUrl(
    env.YOOKASSA_API_BASE_URL,
    nodeEnv as AppConfig["nodeEnv"]
  );
  const yookassaValidateWebhookSourceIp = booleanValue(
    env.YOOKASSA_VALIDATE_WEBHOOK_SOURCE_IP,
    true,
    "YOOKASSA_VALIDATE_WEBHOOK_SOURCE_IP"
  );
  const billingReconciliationEnabled = booleanValue(
    env.BILLING_RECONCILIATION_ENABLED,
    yookassaEnabled,
    "BILLING_RECONCILIATION_ENABLED"
  );
  const platformXmlstockEnabled = booleanValue(
    env.PLATFORM_XMLSTOCK_ENABLED,
    false,
    "PLATFORM_XMLSTOCK_ENABLED"
  );
  const platformArsenkinEnabled = booleanValue(
    env.PLATFORM_ARSENKIN_ENABLED,
    false,
    "PLATFORM_ARSENKIN_ENABLED"
  );
  const platformXmlstockRankKeywordPriceMinor = optionalPlatformRankKeywordPriceMinor(
    env.PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR,
    "PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR"
  );
  const platformArsenkinRankKeywordPriceMinor = optionalPlatformRankKeywordPriceMinor(
    env.PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR,
    "PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR"
  );
  const platformXmlstockDailySpendLimitMinor = optionalPlatformAmountMinor(
    env.PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR,
    "PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR"
  );
  const platformXmlstockMonthlySpendLimitMinor = optionalPlatformAmountMinor(
    env.PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR,
    "PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR"
  );
  const platformArsenkinDailySpendLimitMinor = optionalPlatformAmountMinor(
    env.PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR,
    "PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR"
  );
  const platformArsenkinMonthlySpendLimitMinor = optionalPlatformAmountMinor(
    env.PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR,
    "PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR"
  );
  const outboxPublisherEnabled = booleanValue(
    env.OUTBOX_PUBLISHER_ENABLED,
    false,
    "OUTBOX_PUBLISHER_ENABLED"
  );
  const eventEnvironment = optionalPublisherEnvironment(
    env.NATS_EVENT_ENVIRONMENT
  );
  const outboxStreamName = optionalOutboxStreamName(env.NATS_EVENT_STREAM);
  const authEmailStreamName = optionalOutboxStreamName(
    env.NATS_AUTH_EMAIL_STREAM,
    "NATS_AUTH_EMAIL_STREAM"
  );
  const outboxRetryBaseMs = integerInRange(
    env.OUTBOX_PUBLISH_RETRY_BASE_MS,
    1_000,
    "OUTBOX_PUBLISH_RETRY_BASE_MS",
    100,
    60_000
  );
  const outboxRetryMaxMs = integerInRange(
    env.OUTBOX_PUBLISH_RETRY_MAX_MS,
    300_000,
    "OUTBOX_PUBLISH_RETRY_MAX_MS",
    100,
    3_600_000
  );
  const sessionExpirySweeperEnabled = booleanValue(
    env.SESSION_EXPIRY_SWEEPER_ENABLED,
    false,
    "SESSION_EXPIRY_SWEEPER_ENABLED"
  );
  const sessionExpiryTransactionTimeoutMs = integerInRange(
    env.SESSION_EXPIRY_SWEEPER_TRANSACTION_TIMEOUT_MS,
    10_000,
    "SESSION_EXPIRY_SWEEPER_TRANSACTION_TIMEOUT_MS",
    1_000,
    60_000
  );
  const sessionExpiryLockTimeoutMs = integerInRange(
    env.SESSION_EXPIRY_SWEEPER_LOCK_TIMEOUT_MS,
    500,
    "SESSION_EXPIRY_SWEEPER_LOCK_TIMEOUT_MS",
    50,
    5_000
  );

  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }

  if (outboxPublisherEnabled && !eventEnvironment) {
    throw new Error(
      "NATS_EVENT_ENVIRONMENT is required when the outbox publisher is enabled"
    );
  }
  if (outboxPublisherEnabled && !outboxStreamName) {
    throw new Error(
      "NATS_EVENT_STREAM is required when the outbox publisher is enabled"
    );
  }
  if (outboxPublisherEnabled && !authEmailStreamName) {
    throw new Error(
      "NATS_AUTH_EMAIL_STREAM is required when the outbox publisher is enabled"
    );
  }
  if (
    outboxPublisherEnabled &&
    outboxStreamName === authEmailStreamName
  ) {
    throw new Error(
      "NATS_EVENT_STREAM and NATS_AUTH_EMAIL_STREAM must be distinct"
    );
  }
  if (outboxRetryMaxMs < outboxRetryBaseMs) {
    throw new Error(
      "OUTBOX_PUBLISH_RETRY_MAX_MS must be greater than or equal to OUTBOX_PUBLISH_RETRY_BASE_MS"
    );
  }
  if (sessionExpiryLockTimeoutMs >= sessionExpiryTransactionTimeoutMs) {
    throw new Error(
      "SESSION_EXPIRY_SWEEPER_LOCK_TIMEOUT_MS must be less than SESSION_EXPIRY_SWEEPER_TRANSACTION_TIMEOUT_MS"
    );
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
    (!seoDataApiToken || seoDataApiToken.length < 32)
  ) {
    throw new Error(
      "PLATFORM_API_TO_SEO_DATA_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    nodeEnv === "production" &&
    (!jobsApiToken || jobsApiToken.length < 32)
  ) {
    throw new Error(
      "PLATFORM_API_TO_JOBS_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    nodeEnv === "production" &&
    (!realtimeApiToken || realtimeApiToken.length < 32)
  ) {
    throw new Error(
      "PLATFORM_API_TO_REALTIME_TOKEN with at least 32 characters is required in production"
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
      realtimeNotificationApiToken.length < 32 ||
      isPlaceholderSecret(realtimeNotificationApiToken))
  ) {
    throw new Error(
      "A generated PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    nodeEnv === "production" &&
    (!rankExecutionGrantApiToken ||
      rankExecutionGrantApiToken.length < 32 ||
      isPlaceholderSecret(rankExecutionGrantApiToken))
  ) {
    throw new Error(
      "A generated JOBS_TO_PLATFORM_RANK_GRANT_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    nodeEnv === "production" &&
    (!rankBillingSettlementApiToken ||
      rankBillingSettlementApiToken.length < 32 ||
      isPlaceholderSecret(rankBillingSettlementApiToken))
  ) {
    throw new Error(
      "A generated JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    nodeEnv === "production" &&
    (
      !automationDispatchApiToken ||
      automationDispatchApiToken.length < 32 ||
      isPlaceholderSecret(automationDispatchApiToken)
    )
  ) {
    throw new Error(
      "A generated JOBS_TO_PLATFORM_AUTOMATION_TOKEN with at least 32 characters is required in production"
    );
  }
  if (isPlaceholderSecret(realtimeNotificationApiToken)) {
    throw new Error(
      "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN must not use an example placeholder"
    );
  }
  if (
    nodeEnv === "production" &&
    (!realtimeDeliveryAuthorizationApiToken ||
      realtimeDeliveryAuthorizationApiToken.length < 32 ||
      isPlaceholderSecret(realtimeDeliveryAuthorizationApiToken))
  ) {
    throw new Error(
      "A generated REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN with at least 32 characters is required in production"
    );
  }
  if (isPlaceholderSecret(realtimeDeliveryAuthorizationApiToken)) {
    throw new Error(
      "REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN must not use an example placeholder"
    );
  }
  if (isPlaceholderSecret(rankExecutionGrantApiToken)) {
    throw new Error(
      "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN must not use an example placeholder"
    );
  }
  if (isPlaceholderSecret(rankBillingSettlementApiToken)) {
    throw new Error(
      "JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN must not use an example placeholder"
    );
  }
  if (isPlaceholderSecret(automationDispatchApiToken)) {
    throw new Error(
      "JOBS_TO_PLATFORM_AUTOMATION_TOKEN must not use an example placeholder"
    );
  }
  if (
    nodeEnv === "production" &&
    (!authEmailApiToken ||
      authEmailApiToken.length < 32 ||
      isPlaceholderSecret(authEmailApiToken))
  ) {
    throw new Error(
      "A generated JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN with at least 32 characters is required in production"
    );
  }
  if (isPlaceholderSecret(authEmailApiToken)) {
    throw new Error(
      "JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN must not use an example placeholder"
    );
  }
  if (nodeEnv === "production" && !webPublicUrl) {
    throw new Error("WEB_PUBLIC_URL is required in production");
  }
  if (authEmailApiToken && !webPublicUrl) {
    throw new Error(
      "WEB_PUBLIC_URL is required when auth-email delivery is configured"
    );
  }
  if (yookassaEnabled) {
    if (!yookassaShopId || !/^[0-9]{4,32}$/u.test(yookassaShopId)) {
      throw new Error(
        "YOOKASSA_SHOP_ID must contain 4 to 32 digits when YooKassa is enabled"
      );
    }
    if (
      !yookassaSecretKey ||
      yookassaSecretKey.length < 20 ||
      yookassaSecretKey.length > 512 ||
      isPlaceholderSecret(yookassaSecretKey) ||
      [...yookassaSecretKey].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 0x21 || code > 0x7e;
      })
    ) {
      throw new Error(
        "YOOKASSA_SECRET_KEY must be a non-placeholder visible ASCII secret when YooKassa is enabled"
      );
    }
    if (!yookassaReturnUrl) {
      throw new Error(
        "YOOKASSA_RETURN_URL or WEB_PUBLIC_URL is required when YooKassa is enabled"
      );
    }
  }
  if (billingReconciliationEnabled && !yookassaEnabled) {
    throw new Error(
      "BILLING_RECONCILIATION_ENABLED requires YOOKASSA_ENABLED"
    );
  }
  if (
    platformXmlstockEnabled &&
    platformXmlstockRankKeywordPriceMinor === undefined
  ) {
    throw new Error(
      "PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR is required when XMLStock platform usage is enabled"
    );
  }
  if (
    platformArsenkinEnabled &&
    platformArsenkinRankKeywordPriceMinor === undefined
  ) {
    throw new Error(
      "PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR is required when Arsenkin platform usage is enabled"
    );
  }
  validatePlatformSpendLimits(
    platformXmlstockEnabled,
    platformXmlstockDailySpendLimitMinor,
    platformXmlstockMonthlySpendLimitMinor,
    "XMLSTOCK"
  );
  validatePlatformSpendLimits(
    platformArsenkinEnabled,
    platformArsenkinDailySpendLimitMinor,
    platformArsenkinMonthlySpendLimitMinor,
    "ARSENKIN"
  );
  if (
    nodeEnv === "production" &&
    yookassaEnabled &&
    !billingReconciliationEnabled
  ) {
    throw new Error(
      "BILLING_RECONCILIATION_ENABLED is required with YooKassa in production"
    );
  }
  if (
    nodeEnv === "production" &&
    yookassaEnabled &&
    !yookassaValidateWebhookSourceIp
  ) {
    throw new Error(
      "YOOKASSA_VALIDATE_WEBHOOK_SOURCE_IP cannot be disabled in production"
    );
  }
  if (env.INTERNAL_API_TOKEN?.trim()) {
    throw new Error(
      "INTERNAL_API_TOKEN is no longer supported; configure caller/audience tokens"
    );
  }
  const internalTokens = [
    seoDataApiToken,
    jobsApiToken,
    realtimeApiToken,
    integrationCredentialApiToken,
    realtimeNotificationApiToken,
    realtimeDeliveryAuthorizationApiToken,
    rankExecutionGrantApiToken,
    rankBillingSettlementApiToken,
    automationDispatchApiToken,
    authEmailApiToken
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
  if (nodeEnv === "production" && !outboxPublisherEnabled) {
    throw new Error("OUTBOX_PUBLISHER_ENABLED=true is required in production");
  }
  if (nodeEnv === "production" && !sessionExpirySweeperEnabled) {
    throw new Error(
      "SESSION_EXPIRY_SWEEPER_ENABLED=true is required in production"
    );
  }

  return {
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    bindAddress: bindAddress(
      env.BIND_ADDRESS,
      nodeEnv as AppConfig["nodeEnv"]
    ),
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
    ...(seoDataApiToken ? { seoDataApiToken } : {}),
    ...(jobsApiToken ? { jobsApiToken } : {}),
    ...(realtimeApiToken ? { realtimeApiToken } : {}),
    ...(integrationCredentialApiToken
      ? { integrationCredentialApiToken }
      : {}),
    ...(realtimeNotificationApiToken
      ? { realtimeNotificationApiToken }
      : {}),
    ...(realtimeDeliveryAuthorizationApiToken
      ? { realtimeDeliveryAuthorizationApiToken }
      : {}),
    ...(rankExecutionGrantApiToken
      ? { rankExecutionGrantApiToken }
      : {}),
    ...(rankBillingSettlementApiToken
      ? { rankBillingSettlementApiToken }
      : {}),
    ...(automationDispatchApiToken
      ? { automationDispatchApiToken }
      : {}),
    ...(authEmailApiToken ? { authEmailApiToken } : {}),
    ...(webPublicUrl ? { webPublicUrl } : {}),
    corsOrigins: (env.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    nats: {
      url: env.NATS_URL?.trim() || "nats://127.0.0.1:4222",
      ...(natsUser ? { user: natsUser } : {}),
      ...(natsPassword ? { password: natsPassword } : {})
    },
    outboxPublisher: {
      enabled: outboxPublisherEnabled,
      ...(eventEnvironment ? { eventEnvironment } : {}),
      ...(outboxStreamName ? { streamName: outboxStreamName } : {}),
      ...(authEmailStreamName ? { authEmailStreamName } : {}),
      pollIntervalMs: integerInRange(
        env.OUTBOX_PUBLISH_INTERVAL_MS,
        1_000,
        "OUTBOX_PUBLISH_INTERVAL_MS",
        100,
        60_000
      ),
      batchSize: integerInRange(
        env.OUTBOX_PUBLISH_BATCH_SIZE,
        20,
        "OUTBOX_PUBLISH_BATCH_SIZE",
        1,
        100
      ),
      maxAttempts: integerInRange(
        env.OUTBOX_PUBLISH_MAX_ATTEMPTS,
        10,
        "OUTBOX_PUBLISH_MAX_ATTEMPTS",
        1,
        100
      ),
      retryBaseMs: outboxRetryBaseMs,
      retryMaxMs: outboxRetryMaxMs,
      publishTimeoutMs: integerInRange(
        env.OUTBOX_PUBLISH_ACK_TIMEOUT_MS,
        5_000,
        "OUTBOX_PUBLISH_ACK_TIMEOUT_MS",
        100,
        30_000
      )
    },
    sessionExpirySweeper: {
      enabled: sessionExpirySweeperEnabled,
      intervalMs: integerInRange(
        env.SESSION_EXPIRY_SWEEPER_INTERVAL_MS,
        60_000,
        "SESSION_EXPIRY_SWEEPER_INTERVAL_MS",
        1_000,
        3_600_000
      ),
      batchSize: integerInRange(
        env.SESSION_EXPIRY_SWEEPER_BATCH_SIZE,
        50,
        "SESSION_EXPIRY_SWEEPER_BATCH_SIZE",
        1,
        100
      ),
      transactionTimeoutMs: sessionExpiryTransactionTimeoutMs,
      lockTimeoutMs: sessionExpiryLockTimeoutMs
    },
    billing: {
      yookassa: {
        enabled: yookassaEnabled,
        apiBaseUrl: yookassaApiBaseUrl,
        ...(yookassaShopId ? { shopId: yookassaShopId } : {}),
        ...(yookassaSecretKey ? { secretKey: yookassaSecretKey } : {}),
        ...(yookassaReturnUrl ? { returnUrl: yookassaReturnUrl } : {}),
        requestTimeoutMs: integerInRange(
          env.YOOKASSA_REQUEST_TIMEOUT_MS,
          10_000,
          "YOOKASSA_REQUEST_TIMEOUT_MS",
          1_000,
          30_000
        ),
        validateWebhookSourceIp: yookassaValidateWebhookSourceIp
      },
      reconciliation: {
        enabled: billingReconciliationEnabled,
        intervalMs: integerInRange(
          env.BILLING_RECONCILIATION_INTERVAL_MS,
          60_000,
          "BILLING_RECONCILIATION_INTERVAL_MS",
          10_000,
          3_600_000
        ),
        batchSize: integerInRange(
          env.BILLING_RECONCILIATION_BATCH_SIZE,
          25,
          "BILLING_RECONCILIATION_BATCH_SIZE",
          1,
          100
        )
      },
      providerUsage: {
        XMLSTOCK: {
          enabled: platformXmlstockEnabled,
          ...(platformXmlstockRankKeywordPriceMinor !== undefined
            ? {
                rankKeywordPriceMinor:
                  platformXmlstockRankKeywordPriceMinor
              }
            : {}),
          ...(platformXmlstockDailySpendLimitMinor !== undefined
            ? { dailySpendLimitMinor: platformXmlstockDailySpendLimitMinor }
            : {}),
          ...(platformXmlstockMonthlySpendLimitMinor !== undefined
            ? {
                monthlySpendLimitMinor:
                  platformXmlstockMonthlySpendLimitMinor
              }
            : {})
        },
        ARSENKIN: {
          enabled: platformArsenkinEnabled,
          ...(platformArsenkinRankKeywordPriceMinor !== undefined
            ? {
                rankKeywordPriceMinor:
                  platformArsenkinRankKeywordPriceMinor
              }
            : {}),
          ...(platformArsenkinDailySpendLimitMinor !== undefined
            ? { dailySpendLimitMinor: platformArsenkinDailySpendLimitMinor }
            : {}),
          ...(platformArsenkinMonthlySpendLimitMinor !== undefined
            ? {
                monthlySpendLimitMinor:
                  platformArsenkinMonthlySpendLimitMinor
              }
            : {})
        }
      }
    },
    services: {
      seoData:
        env.SEO_DATA_INTERNAL_URL?.trim() || "http://127.0.0.1:4001",
      jobs: env.JOBS_INTERNAL_URL?.trim() || "http://127.0.0.1:4002",
      realtime:
        env.REALTIME_INTERNAL_URL?.trim() || "http://127.0.0.1:4003"
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
      totpIssuer: env.AUTH_TOTP_ISSUER?.trim() || "SEOньорита",
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

function optionalPublisherEnvironment(
  value: string | undefined
): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (value !== value.trim() || isPlaceholderSecret(value)) {
    throw new Error(
      "NATS_EVENT_ENVIRONMENT must be an explicit safe environment identifier"
    );
  }
  try {
    sessionFamilyRevokedEventSubjectV1(value);
    transactionalEmailEventSubjectV1(
      value,
      "identity.email-verification.requested.v1"
    );
  } catch {
    throw new Error(
      "NATS_EVENT_ENVIRONMENT must be an explicit safe environment identifier"
    );
  }
  return value;
}

function optionalOutboxStreamName(
  value: string | undefined,
  key = "NATS_EVENT_STREAM"
): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (
    value !== value.trim() ||
    isPlaceholderSecret(value) ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(value)
  ) {
    throw new Error(
      `${key} must contain 1 to 64 ASCII letters, digits, underscores or hyphens`
    );
  }
  return value;
}

function optionalWebPublicUrl(
  value: string | undefined,
  nodeEnv: AppConfig["nodeEnv"]
): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (value !== value.trim() || isPlaceholderSecret(value)) {
    throw new Error("WEB_PUBLIC_URL must be an explicit canonical origin");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("WEB_PUBLIC_URL must be an explicit canonical origin");
  }
  if (
    parsed.origin !== value ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (nodeEnv === "production" && parsed.protocol !== "https:") ||
    (parsed.protocol !== "https:" && parsed.protocol !== "http:")
  ) {
    throw new Error("WEB_PUBLIC_URL must be an explicit canonical origin");
  }
  return value;
}

function yookassaBaseUrl(
  value: string | undefined,
  nodeEnv: AppConfig["nodeEnv"]
): string {
  const candidate = value?.trim() || "https://api.yookassa.ru/v3";
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("YOOKASSA_API_BASE_URL must be an explicit HTTPS URL");
  }
  if (
    parsed.origin + parsed.pathname.replace(/\/$/u, "") !== candidate ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.protocol !== "https:" &&
      !(nodeEnv === "test" && parsed.protocol === "http:"))
  ) {
    throw new Error("YOOKASSA_API_BASE_URL must be an explicit HTTPS URL");
  }
  if (
    nodeEnv === "production" &&
    candidate !== "https://api.yookassa.ru/v3"
  ) {
    throw new Error(
      "YOOKASSA_API_BASE_URL must use the official YooKassa v3 endpoint in production"
    );
  }
  return candidate;
}

function optionalYookassaReturnUrl(
  value: string | undefined,
  webPublicUrl: string | undefined,
  nodeEnv: AppConfig["nodeEnv"]
): string | undefined {
  const candidate =
    value?.trim() ||
    (webPublicUrl
      ? `${webPublicUrl}/app/settings/billing?checkout=return`
      : undefined);
  if (!candidate) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("YOOKASSA_RETURN_URL must be an explicit return URL");
  }
  if (
    parsed.toString() !== candidate ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    (parsed.protocol !== "https:" &&
      !(nodeEnv !== "production" && parsed.protocol === "http:")) ||
    (webPublicUrl && parsed.origin !== webPublicUrl)
  ) {
    throw new Error("YOOKASSA_RETURN_URL must be an explicit return URL");
  }
  return candidate;
}
