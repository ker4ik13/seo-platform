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
  | "YANDEX_TURBO"
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
  YANDEX_LIVE: { concurrency: 20, requestsPerSecond: 10 },
  YANDEX_TURBO: { concurrency: 50, requestsPerSecond: 50 },
  GOOGLE_LIVE: { concurrency: 15, requestsPerSecond: 30 },
  YANDEX_SEARCH_API: { concurrency: 50, requestsPerSecond: 50 },
  WORDSTAT: { concurrency: 10, requestsPerSecond: 10 }
};

export const XMLSTOCK_HTTP_QUOTA_NAMESPACE =
  "seo-platform:jobs:v1:provider-rate-limit:xmlstock";
export const XMLSTOCK_GLOBAL_HTTP_CONCURRENCY = 64;
export const XMLSTOCK_HTTP_QUOTA_COMMAND_TIMEOUT_MS = 2_000;

export type XmlStockHttpQuotaPermit =
  | {
      readonly allowed: true;
      readonly credentialId: string;
      readonly workspaceId: string;
      readonly product: XmlStockHttpProduct;
      readonly member: string;
      readonly nodeId?: string;
    }
  | {
      readonly allowed: false;
      readonly retryAfterSeconds: number;
      readonly retryAfterMilliseconds: number;
    };

export interface XmlStockHttpQuotaGate {
  tryAcquire(input: {
    readonly credentialId: string;
    readonly workspaceId: string;
    readonly product: XmlStockHttpProduct;
    readonly requestCost?: number;
    readonly leaseMs: number;
    /** Bounded wait to fill a pre-reserved batch under the provider's rolling RPS window. */
    readonly maxWaitMs?: number;
    /** Omit for the main Compose; remote nodes receive independent HTTP caps. */
    readonly nodeId?: string;
    readonly nodeConcurrency?: number;
    /** The Gateway already reserves the remote node; keep only shared physical-key limits here. */
    readonly physicalOnly?: boolean;
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

const NODE_SLOT_LUA=`
local function acquire_node_slot(inflight_key, waiters_key, ceiling, physical_key, member, lease_ms, now_ms)
  redis.call('ZREMRANGEBYSCORE', inflight_key, '-inf', now_ms)
  redis.call('ZREMRANGEBYSCORE', waiters_key, '-inf', now_ms)
  redis.call('ZADD', waiters_key, now_ms + 2000, physical_key)
  redis.call('PEXPIRE', waiters_key, 5000)
  local active_keys = {}
  local own = 0
  local members = redis.call('ZRANGE', inflight_key, 0, -1)
  for _, item in ipairs(members) do
    local key = string.sub(item, 1, 36)
    if string.sub(item, 37, 37) ~= ':' then key = 'legacy' end
    active_keys[key] = true
    if key == physical_key then own = own + 1 end
  end
  local other_waiting = false
  for _, key in ipairs(redis.call('ZRANGE', waiters_key, 0, -1)) do
    active_keys[key] = true
    if key ~= physical_key then other_waiting = true end
  end
  local count = 0
  for _ in pairs(active_keys) do count = count + 1 end
  local share = math.max(1, math.ceil(ceiling / count))
  if #members >= ceiling or (other_waiting and own >= share) then return 0, 250 end
  redis.call('ZADD', inflight_key, now_ms + lease_ms, physical_key .. ':' .. member)
  if own + 1 >= share then redis.call('ZREM', waiters_key, physical_key) end
  redis.call('PEXPIRE', inflight_key, math.max(redis.call('PTTL', inflight_key), lease_ms + 5000))
  return 1, 0
end
`;
const NODE_ONLY_ACQUIRE_SCRIPT=`${NODE_SLOT_LUA}
local parts=redis.call('TIME')
local now_ms=tonumber(parts[1])*1000+math.floor(tonumber(parts[2])/1000)
local allowed,retry=acquire_node_slot(KEYS[1],KEYS[2],tonumber(ARGV[1]),ARGV[2],ARGV[3],tonumber(ARGV[4]),now_ms)
return {allowed,retry}
`;

const ACQUIRE_SCRIPT = `
${NODE_SLOT_LUA}
local now_parts = redis.call('TIME')
local now_ms = (tonumber(now_parts[1]) * 1000) + math.floor(tonumber(now_parts[2]) / 1000)
local base_concurrency = tonumber(ARGV[1])
local base_rps = tonumber(ARGV[2])
local request_cost = tonumber(ARGV[3])
local lease_ms = tonumber(ARGV[4])
local member = ARGV[5]
local global_concurrency = tonumber(ARGV[6])
local physical_key = ARGV[7]
local workspace_id = ARGV[8]
local enforce_node = ARGV[9] ~= '1'
local smoothing_window_ms = 100
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
redis.call('ZREMRANGEBYSCORE', KEYS[6], '-inf', now_ms - smoothing_window_ms)
redis.call('ZREMRANGEBYSCORE', KEYS[7], '-inf', now_ms)
redis.call('ZREMRANGEBYSCORE', KEYS[8], '-inf', now_ms)
redis.call('ZREMRANGEBYSCORE', KEYS[9], '-inf', now_ms)

-- Workspaces sharing one physical key share both its concurrent requests and
-- its one-second budget. Idle shares may be borrowed until another workspace
-- actually requests capacity.
redis.call('ZADD', KEYS[9], now_ms + 2000, workspace_id)
redis.call('PEXPIRE', KEYS[9], 5000)
local local_keys = {}
local own_local_inflight = 0
local local_members = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, local_member in ipairs(local_members) do
  local key = string.sub(local_member, 1, 36)
  if string.sub(local_member, 37, 37) ~= ':' then key = 'legacy' end
  local_keys[key] = true
  if key == workspace_id then own_local_inflight = own_local_inflight + 1 end
end
local own_recent = 0
local recent_members = redis.call('ZRANGE', KEYS[2], 0, -1)
for _, recent_member in ipairs(recent_members) do
  local key = string.sub(recent_member, 1, 36)
  if string.sub(recent_member, 74, 74) ~= ':' then key = 'legacy' end
  local_keys[key] = true
  if key == workspace_id then own_recent = own_recent + 1 end
end
local other_local_waiting = false
for _, waiting_workspace in ipairs(redis.call('ZRANGE', KEYS[9], 0, -1)) do
  local_keys[waiting_workspace] = true
  if waiting_workspace ~= workspace_id then other_local_waiting = true end
end
local local_count = 0
for _ in pairs(local_keys) do local_count = local_count + 1 end
local local_fair_concurrency = math.max(1, math.ceil(concurrency / local_count))
local local_fair_rps = math.max(request_cost, math.ceil(rps / local_count))
if #local_members >= concurrency or
   (other_local_waiting and own_local_inflight >= local_fair_concurrency) or
   (other_local_waiting and own_recent + request_cost > local_fair_rps) then
  return {0, 250, concurrency, rps}
end

if #recent_members + request_cost > rps then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local retry_ms = math.max(1, math.ceil(tonumber(oldest[2]) + 1000 - now_ms))
  return {0, retry_ms, concurrency, rps}
end

local smoothing_limit = math.max(request_cost, math.ceil(rps / 10))
local smoothed_recent = redis.call('ZCARD', KEYS[6])
if smoothed_recent + request_cost > smoothing_limit then
  local oldest = redis.call('ZRANGE', KEYS[6], 0, 0, 'WITHSCORES')
  local retry_ms = math.max(1, math.ceil(tonumber(oldest[2]) + smoothing_window_ms - now_ms))
  return {0, retry_ms, concurrency, rps}
end

if enforce_node then
  local allowed, retry=acquire_node_slot(KEYS[7],KEYS[8],global_concurrency,physical_key,member,lease_ms,now_ms)
  if allowed == 0 then return {0,retry,concurrency,rps} end
end

redis.call('ZADD', KEYS[1], now_ms + lease_ms, workspace_id .. ':' .. member)
if own_local_inflight + 1 >= local_fair_concurrency and
   own_recent + request_cost >= local_fair_rps then
  redis.call('ZREM', KEYS[9], workspace_id)
end
for index = 1, request_cost do
  redis.call('ZADD', KEYS[2], now_ms, workspace_id .. ':' .. member .. ':' .. tostring(index))
  redis.call('ZADD', KEYS[6], now_ms, member .. ':' .. tostring(index))
end
redis.call('PEXPIRE', KEYS[1], lease_ms + 5000)
redis.call('PEXPIRE', KEYS[2], 6000)
redis.call('PEXPIRE', KEYS[6], 1000)
return {1, 0, concurrency, rps}
`;

const RELEASE_SCRIPT = `
local removed = redis.call('ZREM', KEYS[1], ARGV[3] .. ':' .. ARGV[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[2] .. ':' .. ARGV[1], ARGV[1])
return removed
`;

const PENALIZE_SCRIPT = `
local requested_ms = tonumber(ARGV[1])
local level = tonumber(redis.call('GET', KEYS[1]) or '0')
local existing_ms = redis.call('PTTL', KEYS[2])
-- Several in-flight requests can report one provider overload at once. Treat
-- the whole cooldown window as one signal, not one penalty per response.
if existing_ms > 0 then
  if requested_ms > existing_ms then
    redis.call('SET', KEYS[2], '1', 'PX', requested_ms)
    existing_ms = requested_ms
  end
  return {level, existing_ms}
end
level = level + 1
if level > 4 then level = 4 end
local adaptive_ms = math.min(300000, 1000 * (2 ^ (level - 1)))
local cooldown_ms = math.max(requested_ms, adaptive_ms)
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
 * Distributed XMLStock capacity keyed by physical credential scope, product,
 * and one shared platform HTTP ceiling. Equal BYOK keys use the same opaque
 * HMAC scope across workspaces.
 */
@Injectable()
export class XmlStockHttpQuotaLimiter
  implements XmlStockHttpQuotaGate, OnModuleDestroy
{
  private readonly logger = new Logger(XmlStockHttpQuotaLimiter.name);
  private readonly connection: Redis;
  private readonly globalConcurrency: number;

  public constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.globalConcurrency = config.connectorRuntime.xmlStockGlobalHttpConcurrency;
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
    readonly workspaceId: string;
    readonly product: XmlStockHttpProduct;
    readonly requestCost?: number;
    readonly leaseMs: number;
    readonly maxWaitMs?: number;
    readonly nodeId?: string;
    readonly nodeConcurrency?: number;
    readonly physicalOnly?: boolean;
  }): Promise<XmlStockHttpQuotaPermit> {
    try {
      const startedAt = Date.now();
      const maxWaitMs = input.maxWaitMs ?? 500;
      if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > 4_000) {
        throw new TypeError("Invalid XMLStock quota wait budget");
      }
      while (true) {
        const permit = await acquireXmlStockHttpQuotaPermit(
          this.connection,
          { ...input, member: randomUUID(), globalConcurrency: input.nodeConcurrency ?? this.globalConcurrency }
        );
        if (permit.allowed) return permit;
        if (!xmlStockQuotaShouldWait(
          permit.retryAfterMilliseconds,Date.now()-startedAt,maxWaitMs,input.maxWaitMs !== undefined
        )) {
          return permit;
        }
        await wait(permit.retryAfterMilliseconds);
      }
    } catch {
      this.logger.error("XMLStock quota limiter acquisition failed closed");
      return {
        allowed: false,
        retryAfterSeconds: 5,
        retryAfterMilliseconds: 5_000
      };
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

  public async acquireLocalNodeSlot(physicalKey:string,leaseMs:number):Promise<{allowed:true;member:string;physicalKey:string}|{allowed:false}> {
    if(!UUID_PATTERN.test(physicalKey) || !Number.isSafeInteger(leaseMs) || leaseMs<1000 || leaseMs>120_000) throw new TypeError("Invalid local HTTP reservation");
    try {
      const member=randomUUID();const value=await commandWithTimeout(this.connection.eval(NODE_ONLY_ACQUIRE_SCRIPT,2,
        `${XMLSTOCK_HTTP_QUOTA_NAMESPACE}:global:inflight`,`${XMLSTOCK_HTTP_QUOTA_NAMESPACE}:global:waiters`,String(this.globalConcurrency),physicalKey,member,String(leaseMs)));
      if(!Array.isArray(value) || value.length!==2 || ![0,1].includes(Number(value[0]))) throw new Error("Invalid local HTTP permit");
      return value[0]===1 ? {allowed:true,member,physicalKey} : {allowed:false};
    } catch {this.logger.error("Local HTTP capacity reservation failed closed");return {allowed:false};}
  }

  public async releaseLocalNodeSlot(permit:{member:string;physicalKey:string}):Promise<void> {
    try {await commandWithTimeout(this.connection.eval("return redis.call('ZREM',KEYS[1],ARGV[1])",1,`${XMLSTOCK_HTTP_QUOTA_NAMESPACE}:global:inflight`,`${permit.physicalKey}:${permit.member}`));}
    catch {this.logger.warn("Local HTTP reservation will recover after its lease");}
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

export function xmlStockQuotaShouldWait(retryMs:number,elapsedMs:number,budgetMs:number,explicitBudget:boolean):boolean {
  return (explicitBudget || retryMs<=250) && elapsedMs+retryMs<=budgetMs;
}

export async function acquireXmlStockHttpQuotaPermit(
  redis: RedisEvalPort,
  input: {
    readonly credentialId: string;
    readonly workspaceId: string;
    readonly product: XmlStockHttpProduct;
    readonly requestCost?: number;
    readonly leaseMs: number;
    readonly member: string;
    readonly globalConcurrency?: number;
    readonly nodeId?: string;
    readonly physicalOnly?: boolean;
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
    !UUID_PATTERN.test(input.member) ||
    !UUID_PATTERN.test(input.workspaceId)
    || (input.nodeId !== undefined && !UUID_PATTERN.test(input.nodeId))
    || (input.globalConcurrency !== undefined &&
      (!Number.isSafeInteger(input.globalConcurrency) ||
        input.globalConcurrency < 1 || input.globalConcurrency > 512))
  ) {
    throw new TypeError("Invalid XMLStock quota acquisition");
  }
  const policy = XMLSTOCK_HTTP_QUOTA_POLICIES[input.product];
  const nodeNamespace = input.nodeId
    ? `${XMLSTOCK_HTTP_QUOTA_NAMESPACE}:node:${input.nodeId.toLowerCase()}`
    : `${XMLSTOCK_HTTP_QUOTA_NAMESPACE}:global`;
  const response = await commandWithTimeout(
    redis.eval(
      ACQUIRE_SCRIPT,
      9,
      `${scope}:inflight`,
      `${scope}:rps`,
      `${scope}:cooldown`,
      `${scope}:penalty`,
      `${scope}:success`,
      `${scope}:smoothing`,
      `${nodeNamespace}:inflight`,
      `${nodeNamespace}:waiters`,
      `${scope}:workspace-waiters`,
      String(policy.concurrency),
      String(policy.requestsPerSecond),
      String(requestCost),
      String(input.leaseMs),
      input.member,
      String(input.globalConcurrency ?? XMLSTOCK_GLOBAL_HTTP_CONCURRENCY),
      input.credentialId.toLowerCase(),
      input.workspaceId.toLowerCase(),
      input.physicalOnly===true ? "1" : "0"
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
      workspaceId: input.workspaceId.toLowerCase(),
      product: input.product,
      member: input.member.toLowerCase(),
      ...(input.nodeId ? { nodeId: input.nodeId.toLowerCase() } : {})
    };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(Number(response[1]) / 1_000)),
    retryAfterMilliseconds: Math.max(1, Number(response[1]))
  };
}

export async function releaseXmlStockHttpQuotaPermit(
  redis: RedisEvalPort,
  permit: Extract<XmlStockHttpQuotaPermit, { readonly allowed: true }>
): Promise<void> {
  const scope = quotaScope(permit.credentialId, permit.product);
  if (!UUID_PATTERN.test(permit.member) || !UUID_PATTERN.test(permit.workspaceId) ||
    (permit.nodeId !== undefined && !UUID_PATTERN.test(permit.nodeId))) {
    throw new TypeError("Invalid XMLStock quota permit");
  }
  const response = await commandWithTimeout(
    redis.eval(
      RELEASE_SCRIPT,
      2,
      `${scope}:inflight`,
      `${permit.nodeId
        ? `${XMLSTOCK_HTTP_QUOTA_NAMESPACE}:node:${permit.nodeId.toLowerCase()}`
        : `${XMLSTOCK_HTTP_QUOTA_NAMESPACE}:global`}:inflight`,
      permit.member,
      permit.credentialId.toLowerCase(),
      permit.workspaceId.toLowerCase()
    )
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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
