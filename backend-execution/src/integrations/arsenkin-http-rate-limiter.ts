import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy
} from "@nestjs/common";
import { Redis } from "ioredis";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export const ARSENKIN_HTTP_RATE_LIMIT = 30;
export const ARSENKIN_HTTP_RATE_WINDOW_MS = 60_000;
export const ARSENKIN_HTTP_RATE_LIMIT_COMMAND_TIMEOUT_MS = 2_000;
export const ARSENKIN_HTTP_RATE_LIMIT_KEY =
  "seo-platform:jobs:v1:integration-credential-validation:provider-rate-limit:arsenkin-http";

export type ArsenkinHttpRateLimitPermit =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface ArsenkinHttpRateLimitGate {
  tryAcquire(scopeId?: string): Promise<ArsenkinHttpRateLimitPermit>;
}

type RedisEvalPort = Pick<Redis, "eval">;

const SLIDING_WINDOW_SCRIPT = `
local now_parts = redis.call('TIME')
local now_ms = (tonumber(now_parts[1]) * 1000) + math.floor(tonumber(now_parts[2]) / 1000)
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local cutoff_ms = now_ms - window_ms

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff_ms)
local current = redis.call('ZCARD', KEYS[1])
if current >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry_after_ms = math.max(1, math.ceil(tonumber(oldest[2]) + window_ms - now_ms))
  redis.call('PEXPIRE', KEYS[1], window_ms + 1000)
  return {0, retry_after_ms}
end

redis.call('ZADD', KEYS[1], now_ms, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window_ms + 1000)
return {1, 0}
`;

/**
 * One fail-closed rolling window per physical Arsenkin API key.
 * The Redis key is inside the connector worker's exact ACL namespace, so the
 * limit is shared by connector kinds and by horizontally scaled workers.
 */
@Injectable()
export class ArsenkinHttpRateLimiter
  implements ArsenkinHttpRateLimitGate, OnModuleDestroy
{
  private readonly logger = new Logger(ArsenkinHttpRateLimiter.name);
  private readonly connection: Redis;

  public constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.connection = new Redis(config.redisUrl, {
      connectTimeout: 5_000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true
    });
    this.connection.on("error", () => {
      this.logger.error("Arsenkin rate limiter Redis connection error");
    });
  }

  public tryAcquire(scopeId?: string): Promise<ArsenkinHttpRateLimitPermit> {
    return acquireArsenkinHttpRateLimitPermit(
      this.connection,
      randomUUID(),
      scopeId
    );
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.connection.status !== "end") {
      await this.connection.quit();
    }
  }
}

export async function acquireArsenkinHttpRateLimitPermit(
  redis: RedisEvalPort,
  member: string,
  scopeId?: string
): Promise<ArsenkinHttpRateLimitPermit> {
  if (!UUID_PATTERN.test(member)) {
    throw new TypeError("Invalid Arsenkin rate limit member");
  }
  const response = await commandWithTimeout(
    redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      arsenkinHttpRateLimitKey(scopeId),
      String(ARSENKIN_HTTP_RATE_LIMIT),
      String(ARSENKIN_HTTP_RATE_WINDOW_MS),
      member
    )
  );
  if (
    !Array.isArray(response) ||
    response.length !== 2 ||
    (response[0] !== 0 && response[0] !== 1) ||
    typeof response[1] !== "number" ||
    !Number.isSafeInteger(response[1]) ||
    response[1] < 0
  ) {
    throw new Error("Invalid Arsenkin rate limiter response");
  }
  if (response[0] === 1) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(response[1] / 1_000))
  };
}

export function arsenkinHttpRateLimitKey(scopeId?: string): string {
  if (scopeId === undefined) return ARSENKIN_HTTP_RATE_LIMIT_KEY;
  if (!UUID_PATTERN.test(scopeId)) {
    throw new TypeError("Invalid Arsenkin rate limit scope");
  }
  return `${ARSENKIN_HTTP_RATE_LIMIT_KEY}:${scopeId.toLowerCase()}`;
}

async function commandWithTimeout<T>(command: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      command,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Arsenkin rate limiter command timed out")),
          ARSENKIN_HTTP_RATE_LIMIT_COMMAND_TIMEOUT_MS
        );
        timeout.unref();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
