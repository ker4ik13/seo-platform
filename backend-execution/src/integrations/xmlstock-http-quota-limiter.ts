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

export type XmlStockHttpProduct =
  | "YANDEX_LIVE"
  | "GOOGLE_LIVE"
  | "YANDEX_SEARCH_API"
  | "WORDSTAT";

export interface XmlStockHttpQuotaPolicy {
  readonly concurrency: number;
  readonly requestsPerSecond: number;
}

export const XMLSTOCK_HTTP_QUOTA_POLICIES: Readonly<
  Record<XmlStockHttpProduct, XmlStockHttpQuotaPolicy>
> = {
  YANDEX_LIVE: { concurrency: 8, requestsPerSecond: 8 },
  GOOGLE_LIVE: { concurrency: 12, requestsPerSecond: 12 },
  YANDEX_SEARCH_API: { concurrency: 30, requestsPerSecond: 60 },
  WORDSTAT: { concurrency: 8, requestsPerSecond: 8 }
};

export const XMLSTOCK_HTTP_QUOTA_NAMESPACE =
  "seo-platform:jobs:v1:provider-rate-limit:xmlstock";
export const XMLSTOCK_HTTP_QUOTA_COMMAND_TIMEOUT_MS = 2_000;

export type XmlStockHttpQuotaPermit =
  | {
      readonly allowed: true;
      readonly credentialId: string;
      readonly product: XmlStockHttpProduct;
      readonly member: string;
    }
  | {
      readonly allowed: false;
      readonly retryAfterSeconds: number;
    };

export interface XmlStockHttpQuotaGate {
  tryAcquire(input: {
    readonly credentialId: string;
    readonly product: XmlStockHttpProduct;
    readonly requestCost?: number;
    readonly leaseMs: number;
  }): Promise<XmlStockHttpQuotaPermit>;
  release(
    permit: Extract<XmlStockHttpQuotaPermit, { readonly allowed: true }>
  ): Promise<void>;
  penalize(input: {
    readonly credentialId: string;
    readonly product: XmlStockHttpProduct;
    readonly retryAfterSeconds?: number;
  }): Promise<void>;
  recordSuccess(input: {
    readonly credentialId: string;
    readonly product: XmlStockHttpProduct;
  }): Promise<void>;
}

type RedisEvalPort = Pick<Redis, "eval">;

const ACQUIRE_SCRIPT = `
local now_parts = redis.call('TIME')
local now_ms = (tonumber(now_parts[1]) * 1000) + math.floor(tonumber(now_parts[2]) / 1000)
local base_concurrency = tonumber(ARGV[1])
local base_rps = tonumber(ARGV[2])
local request_cost = tonumber(ARGV[3])
local lease_ms = tonumber(ARGV[4])
local member = ARGV[5]
local penalty = tonumber(redis.call('GET', KEYS[4]) or '0')
local divisor = 2 ^ penalty
local concurrency = math.max(1, math.floor(base_concurrency / divisor))
local rps = math.max(request_cost, math.floor(base_rps / divisor))

local cooldown_ms = redis.call('PTTL', KEYS[3])
if cooldown_ms > 0 then
  return {0, cooldown_ms, concurrency, rps}
end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now_ms)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now_ms - 1000)

local inflight = redis.call('ZCARD', KEYS[1])
if inflight >= concurrency then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry_ms = math.max(1, math.ceil(tonumber(oldest[2]) - now_ms))
  return {0, retry_ms, concurrency, rps}
end

local recent = redis.call('ZCARD', KEYS[2])
if recent + request_cost > rps then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local retry_ms = math.max(1, math.ceil(tonumber(oldest[2]) + 1000 - now_ms))
  return {0, retry_ms, concurrency, rps}
end

redis.call('ZADD', KEYS[1], now_ms + lease_ms, member)
for index = 1, request_cost do
  redis.call('ZADD', KEYS[2], now_ms, member .. ':' .. tostring(index))
end
redis.call('PEXPIRE', KEYS[1], lease_ms + 5000)
redis.call('PEXPIRE', KEYS[2], 6000)
return {1, 0, concurrency, rps}
`;

const RELEASE_SCRIPT = `
return redis.call('ZREM', KEYS[1], ARGV[1])
`;

const PENALIZE_SCRIPT = `
local requested_ms = tonumber(ARGV[1])
local level = tonumber(redis.call('GET', KEYS[1]) or '0') + 1
if level > 4 then level = 4 end
local adaptive_ms = math.min(300000, 1000 * (2 ^ (level - 1)))
local cooldown_ms = math.max(requested_ms, adaptive_ms)
local existing_ms = redis.call('PTTL', KEYS[2])
if existing_ms > cooldown_ms then cooldown_ms = existing_ms end
redis.call('SET', KEYS[1], tostring(level), 'PX', 600000)
redis.call('SET', KEYS[2], '1', 'PX', cooldown_ms)
redis.call('DEL', KEYS[3])
return {level, cooldown_ms}
`;

const SUCCESS_SCRIPT = `
local level = tonumber(redis.call('GET', KEYS[1]) or '0')
if level <= 0 then
  redis.call('DEL', KEYS[2])
  return 0
end
local successes = redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], 600000)
if successes >= 20 then
  level = level - 1
  redis.call('DEL', KEYS[2])
  if level <= 0 then
    redis.call('DEL', KEYS[1])
    return 0
  end
  redis.call('SET', KEYS[1], tostring(level), 'PX', 600000)
end
return level
`;

/**
 * Distributed XMLStock capacity keyed by credential and provider product.
 * Different BYOK credentials never share a bucket; every project using the
 * same credential does, because XMLStock applies limits to the API key rather
 * than to this platform's project or worker process.
 */
@Injectable()
export class XmlStockHttpQuotaLimiter
  implements XmlStockHttpQuotaGate, OnModuleDestroy
{
  private readonly logger = new Logger(XmlStockHttpQuotaLimiter.name);
  private readonly connection: Redis;

  public constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.connection = new Redis(config.redisUrl, {
      connectTimeout: 5_000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true
    });
    this.connection.on("error", () => {
      this.logger.error("XMLStock quota limiter Redis connection error");
    });
  }

  public async tryAcquire(input: {
    readonly credentialId: string;
    readonly product: XmlStockHttpProduct;
    readonly requestCost?: number;
    readonly leaseMs: number;
  }): Promise<XmlStockHttpQuotaPermit> {
    try {
      return await acquireXmlStockHttpQuotaPermit(
        this.connection,
        { ...input, member: randomUUID() }
      );
    } catch {
      this.logger.error("XMLStock quota limiter acquisition failed closed");
      return { allowed: false, retryAfterSeconds: 5 };
    }
  }

  public async release(
    permit: Extract<XmlStockHttpQuotaPermit, { readonly allowed: true }>
  ): Promise<void> {
    try {
      await releaseXmlStockHttpQuotaPermit(this.connection, permit);
    } catch {
      // The in-flight member has a bounded lease and therefore self-recovers.
      this.logger.error("XMLStock quota limiter release failed");
    }
  }

  public async penalize(input: {
    readonly credentialId: string;
    readonly product: XmlStockHttpProduct;
    readonly retryAfterSeconds?: number;
  }): Promise<void> {
    try {
      await penalizeXmlStockHttpQuota(this.connection, input);
    } catch {
      this.logger.error("XMLStock quota limiter penalty update failed");
    }
  }

  public async recordSuccess(input: {
    readonly credentialId: string;
    readonly product: XmlStockHttpProduct;
  }): Promise<void> {
    try {
      await recordXmlStockHttpQuotaSuccess(this.connection, input);
    } catch {
      this.logger.error("XMLStock quota limiter recovery update failed");
    }
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.connection.status !== "end") {
      await this.connection.quit();
    }
  }
}

export async function acquireXmlStockHttpQuotaPermit(
  redis: RedisEvalPort,
  input: {
    readonly credentialId: string;
    readonly product: XmlStockHttpProduct;
    readonly requestCost?: number;
    readonly leaseMs: number;
    readonly member: string;
  }
): Promise<XmlStockHttpQuotaPermit> {
  const scope = quotaScope(input.credentialId, input.product);
  const requestCost = input.requestCost ?? 1;
  if (
    !Number.isSafeInteger(requestCost) ||
    requestCost < 1 ||
    requestCost > 10 ||
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1_000 ||
    input.leaseMs > 120_000 ||
    !UUID_PATTERN.test(input.member)
  ) {
    throw new TypeError("Invalid XMLStock quota acquisition");
  }
  const policy = XMLSTOCK_HTTP_QUOTA_POLICIES[input.product];
  const response = await commandWithTimeout(
    redis.eval(
      ACQUIRE_SCRIPT,
      5,
      `${scope}:inflight`,
      `${scope}:rps`,
      `${scope}:cooldown`,
      `${scope}:penalty`,
      `${scope}:success`,
      String(policy.concurrency),
      String(policy.requestsPerSecond),
      String(requestCost),
      String(input.leaseMs),
      input.member
    )
  );
  if (
    !Array.isArray(response) ||
    response.length !== 4 ||
    (response[0] !== 0 && response[0] !== 1) ||
    !response.slice(1).every(nonNegativeSafeInteger)
  ) {
    throw new Error("Invalid XMLStock quota limiter response");
  }
  if (response[0] === 1) {
    return {
      allowed: true,
      credentialId: input.credentialId.toLowerCase(),
      product: input.product,
      member: input.member.toLowerCase()
    };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(Number(response[1]) / 1_000))
  };
}

export async function releaseXmlStockHttpQuotaPermit(
  redis: RedisEvalPort,
  permit: Extract<XmlStockHttpQuotaPermit, { readonly allowed: true }>
): Promise<void> {
  const scope = quotaScope(permit.credentialId, permit.product);
  if (!UUID_PATTERN.test(permit.member)) {
    throw new TypeError("Invalid XMLStock quota permit");
  }
  const response = await commandWithTimeout(
    redis.eval(RELEASE_SCRIPT, 1, `${scope}:inflight`, permit.member)
  );
  if (response !== 0 && response !== 1) {
    throw new Error("Invalid XMLStock quota release response");
  }
}

export async function penalizeXmlStockHttpQuota(
  redis: RedisEvalPort,
  input: {
    readonly credentialId: string;
    readonly product: XmlStockHttpProduct;
    readonly retryAfterSeconds?: number;
  }
): Promise<void> {
  const scope = quotaScope(input.credentialId, input.product);
  const retryAfterSeconds = input.retryAfterSeconds ?? 1;
  if (
    !Number.isSafeInteger(retryAfterSeconds) ||
    retryAfterSeconds < 1 ||
    retryAfterSeconds > 3_600
  ) {
    throw new TypeError("Invalid XMLStock quota penalty");
  }
  const response = await commandWithTimeout(
    redis.eval(
      PENALIZE_SCRIPT,
      3,
      `${scope}:penalty`,
      `${scope}:cooldown`,
      `${scope}:success`,
      String(retryAfterSeconds * 1_000)
    )
  );
  if (
    !Array.isArray(response) ||
    response.length !== 2 ||
    !response.every(nonNegativeSafeInteger)
  ) {
    throw new Error("Invalid XMLStock quota penalty response");
  }
}

export async function recordXmlStockHttpQuotaSuccess(
  redis: RedisEvalPort,
  input: {
    readonly credentialId: string;
    readonly product: XmlStockHttpProduct;
  }
): Promise<void> {
  const scope = quotaScope(input.credentialId, input.product);
  const response = await commandWithTimeout(
    redis.eval(
      SUCCESS_SCRIPT,
      2,
      `${scope}:penalty`,
      `${scope}:success`
    )
  );
  if (!nonNegativeSafeInteger(response)) {
    throw new Error("Invalid XMLStock quota success response");
  }
}

export function xmlStockHttpQuotaKey(
  credentialId: string,
  product: XmlStockHttpProduct
): string {
  return quotaScope(credentialId, product);
}

function quotaScope(
  credentialId: string,
  product: XmlStockHttpProduct
): string {
  if (
    !UUID_PATTERN.test(credentialId) ||
    !Object.hasOwn(XMLSTOCK_HTTP_QUOTA_POLICIES, product)
  ) {
    throw new TypeError("Invalid XMLStock quota scope");
  }
  return `${XMLSTOCK_HTTP_QUOTA_NAMESPACE}:${credentialId.toLowerCase()}:${product.toLowerCase()}`;
}

async function commandWithTimeout<T>(command: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      command,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("XMLStock quota limiter command timed out")),
          XMLSTOCK_HTTP_QUOTA_COMMAND_TIMEOUT_MS
        );
        timeout.unref();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function nonNegativeSafeInteger(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
