export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly version: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly internalApiToken?: string;
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

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test or production");
  }

  const user = env.NATS_USER?.trim();
  const password = env.NATS_PASSWORD?.trim();
  const internalApiToken = env.INTERNAL_API_TOKEN?.trim();
  const jobsToSeoRankToken = env.JOBS_TO_SEO_RANK_TOKEN?.trim();
  const jobsToSeoRankResultToken =
    env.JOBS_TO_SEO_RANK_RESULT_TOKEN?.trim();
  const rankHistoryCursorKey =
    env.RANK_HISTORY_CURSOR_KEY?.trim();
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
    INTERNAL_API_TOKEN: internalApiToken,
    JOBS_TO_SEO_RANK_TOKEN: jobsToSeoRankToken,
    JOBS_TO_SEO_RANK_RESULT_TOKEN: jobsToSeoRankResultToken,
    RANK_HISTORY_CURSOR_KEY: rankHistoryCursorKey
  });

  return {
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    port: positiveInteger(env.PORT, 4001, "PORT"),
    version: env.SERVICE_VERSION?.trim() || "0.1.0",
    databaseUrl: required(env, "DATABASE_URL"),
    databasePoolMax: positiveInteger(
      env.DATABASE_POOL_MAX,
      20,
      "DATABASE_POOL_MAX"
    ),
    ...(internalApiToken ? { internalApiToken } : {}),
    ...(jobsToSeoRankToken ? { jobsToSeoRankToken } : {}),
    ...(jobsToSeoRankResultToken
      ? { jobsToSeoRankResultToken }
      : {}),
    ...(rankHistoryCursorKey ? { rankHistoryCursorKey } : {}),
    nats: {
      url: env.NATS_URL?.trim() || "nats://localhost:4222",
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
