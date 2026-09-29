import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/app-config.js";
import type { XmlStockHttpProduct } from "../integrations/xmlstock-http-quota-limiter.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PRODUCT_SET = new Set<string>([
  "YANDEX_LIVE", "YANDEX_TURBO", "GOOGLE_LIVE", "YANDEX_SEARCH_API"
]);

export interface RankPollTicket {
  readonly version: 1;
  readonly keyVersion: number;
  readonly nodeId: string;
  readonly workspaceId: string;
  readonly executionId: string;
  readonly providerTaskId: string;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseGeneration: number;
  readonly executionVersion: number;
  readonly leaseExpiresAt: string;
  readonly requestHash: string;
  readonly physicalKeyScopeId: string;
  readonly product: Exclude<XmlStockHttpProduct, "WORDSTAT">;
  readonly quotaMember: string;
  readonly settlementGrantId: string | null;
}

export function signRankPollTicket(
  config: AppConfig,
  value: Omit<RankPollTicket, "version" | "keyVersion">
): string {
  const keyVersion = config.integrationCredentials.activeKeyVersion;
  if (!keyVersion) throw new Error("Worker ticket key is unavailable");
  const payload: RankPollTicket = { version: 1, keyVersion, ...value };
  validate(payload);
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = signature(config, keyVersion, data);
  return `wrt1.${data}.${mac.toString("base64url")}`;
}

export function verifyRankPollTicket(
  config: AppConfig,
  value: unknown,
  nodeId: string
): RankPollTicket {
  if (typeof value !== "string" || value.length > 4096) invalid();
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "wrt1" ||
    !BASE64URL_PATTERN.test(parts[1] ?? "") ||
    !BASE64URL_PATTERN.test(parts[2] ?? "")) invalid();
  const data = parts[1]!;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as unknown;
  } catch {
    invalid();
  }
  const ticket = validate(payload);
  const actual = Buffer.from(parts[2]!, "base64url");
  const expected = signature(config, ticket.keyVersion, data);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected) ||
    ticket.nodeId !== nodeId ||
    Date.parse(ticket.leaseExpiresAt) <= Date.now()) invalid();
  return ticket;
}

function signature(config: AppConfig, version: number, data: string): Buffer {
  const master = config.integrationCredentials.keys.get(version);
  if (!master || master.length !== 32) invalid();
  const key = hkdfSync(
    "sha256", master, Buffer.alloc(0),
    Buffer.from("seo-platform.worker-rank-ticket.v1", "utf8"), 32
  );
  return createHmac("sha256", Buffer.from(key)).update(data, "ascii").digest();
}

function validate(value: unknown): RankPollTicket {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  const fields = [
    "version", "keyVersion", "nodeId", "workspaceId", "executionId", "providerTaskId",
    "leaseOwner", "leaseToken", "leaseGeneration", "executionVersion",
    "leaseExpiresAt", "requestHash", "physicalKeyScopeId", "product",
    "quotaMember", "settlementGrantId"
  ];
  if (Object.keys(input).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(input, field)) ||
    input.version !== 1 ||
    !integer(input.keyVersion, 1, 255) ||
    !uuid(input.nodeId) || !uuid(input.workspaceId) ||
    !uuid(input.executionId) || !uuid(input.leaseToken) ||
    typeof input.providerTaskId !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/u.test(input.providerTaskId) ||
    !uuid(input.physicalKeyScopeId) || !uuid(input.quotaMember) ||
    !integer(input.leaseGeneration, 1, 2_147_483_647) ||
    !integer(input.executionVersion, 1, 2_147_483_647) ||
    typeof input.leaseOwner !== "string" || !OWNER_PATTERN.test(input.leaseOwner) ||
    typeof input.leaseExpiresAt !== "string" ||
    Number.isNaN(Date.parse(input.leaseExpiresAt)) ||
    typeof input.requestHash !== "string" || !HASH_PATTERN.test(input.requestHash) ||
    typeof input.product !== "string" || !PRODUCT_SET.has(input.product) ||
    (input.settlementGrantId !== null && !uuid(input.settlementGrantId))
  ) invalid();
  return input as unknown as RankPollTicket;
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= min && value <= max;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function invalid(): never {
  throw new TypeError("Invalid worker task ticket");
}
