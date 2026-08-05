export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly bindAddress: "127.0.0.1" | "0.0.0.0";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly platformApiToken?: string;
  readonly jobsApiToken?: string;
  readonly jobsToSeoRankToken?: string;
  readonly jobsToSeoRankResultToken?: string;
  readonly rankHistoryCursorKey?: string;
  readonly nats: {
    readonly url: string;
    readonly user?: string;
    readonly password?: string;
  };
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

function isPlaceholderSecret(value: string): boolean {
  return /^(?:replace-me|replace-with-|example(?:-|$)|change-?me|your[-_])/iu.test(
    value
  );
}

function serviceSecret(
  env: NodeJS.ProcessEnv,
  key: string
): string | undefined {
  const value = env[key];
  if (value === undefined || value === "") return undefined;
  if (isPlaceholderSecret(value)) {
    throw new Error(
      `${key} must be generated and must not use an example placeholder`
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
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }

  const user = env.NATS_USER?.trim();
  const password = env.NATS_PASSWORD?.trim();
  const platformApiToken = serviceSecret(
    env,
    "PLATFORM_API_TO_SEO_DATA_TOKEN"
  );
  const jobsApiToken = serviceSecret(env, "JOBS_TO_SEO_DATA_TOKEN");
  const jobsToSeoRankToken = serviceSecret(
    env,
    "JOBS_TO_SEO_RANK_TOKEN"
  );
  const jobsToSeoRankResultToken = serviceSecret(
    env,
    "JOBS_TO_SEO_RANK_RESULT_TOKEN"
  );
  const rankHistoryCursorKey = serviceSecret(
    env,
    "RANK_HISTORY_CURSOR_KEY"
  );
  if (
    nodeEnv === "production" &&
    (!platformApiToken || platformApiToken.length < 32)
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
      "JOBS_TO_SEO_DATA_TOKEN with at least 32 characters is required in production"
    );
  }
  if (env.INTERNAL_API_TOKEN?.trim()) {
    throw new Error(
      "INTERNAL_API_TOKEN is no longer supported; configure caller/audience tokens"
    );
  }
  if (
    nodeEnv === "production" &&
    (!jobsToSeoRankToken || jobsToSeoRankToken.length < 32)
  ) {
    throw new Error(
      "JOBS_TO_SEO_RANK_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    nodeEnv === "production" &&
    (!jobsToSeoRankResultToken ||
      jobsToSeoRankResultToken.length < 32)
  ) {
    throw new Error(
      "JOBS_TO_SEO_RANK_RESULT_TOKEN with at least 32 characters is required in production"
    );
  }
  if (
    nodeEnv === "production" &&
    (!rankHistoryCursorKey || rankHistoryCursorKey.length < 32)
  ) {
    throw new Error(
      "RANK_HISTORY_CURSOR_KEY with at least 32 characters is required in production"
    );
  }
  assertDistinctServiceTokens({
    PLATFORM_API_TO_SEO_DATA_TOKEN: platformApiToken,
    JOBS_TO_SEO_DATA_TOKEN: jobsApiToken,
    JOBS_TO_SEO_RANK_TOKEN: jobsToSeoRankToken,
    JOBS_TO_SEO_RANK_RESULT_TOKEN: jobsToSeoRankResultToken,
    RANK_HISTORY_CURSOR_KEY: rankHistoryCursorKey
  });

  return {
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    bindAddress: bindAddress(
      env.BIND_ADDRESS,
      nodeEnv as AppConfig["nodeEnv"]
    ),
    port: positiveInteger(env.PORT, 4001, "PORT"),
    version: env.SERVICE_VERSION?.trim() || "0.1.0",
    databaseUrl: required(env, "DATABASE_URL"),
    databasePoolMax: positiveInteger(
      env.DATABASE_POOL_MAX,
      20,
      "DATABASE_POOL_MAX"
    ),
    ...(platformApiToken ? { platformApiToken } : {}),
    ...(jobsApiToken ? { jobsApiToken } : {}),
    ...(jobsToSeoRankToken ? { jobsToSeoRankToken } : {}),
    ...(jobsToSeoRankResultToken
      ? { jobsToSeoRankResultToken }
      : {}),
    ...(rankHistoryCursorKey ? { rankHistoryCursorKey } : {}),
    nats: {
      url: env.NATS_URL?.trim() || "nats://127.0.0.1:4222",
      ...(user ? { user } : {}),
      ...(password ? { password } : {})
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
