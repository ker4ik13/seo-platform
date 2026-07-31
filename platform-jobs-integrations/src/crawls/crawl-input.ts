import { BadRequestException } from "@nestjs/common";
import type {
  InternalCancelTechnicalCrawlInput,
  InternalCreateTechnicalCrawlInput,
  TechnicalCrawlConfig
} from "@seo-platform/contracts";
import { assertSafeCrawlUrl } from "./public-http.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;

export function internalCreateTechnicalCrawlInput(
  value: unknown
): InternalCreateTechnicalCrawlInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey",
    "correlationId",
    "startUrls",
    "maxUrls",
    "maxDepth",
    "requestsPerMinute",
    "obeyRobots"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey: patternString(
      input.idempotencyKey,
      "idempotencyKey",
      KEY_PATTERN
    ),
    correlationId: boundedString(input.correlationId, "correlationId", 100),
    ...crawlConfig(input)
  };
}

export function internalCancelTechnicalCrawlInput(
  value: unknown
): InternalCancelTechnicalCrawlInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    version: integer(input.version, "version", 1, Number.MAX_SAFE_INTEGER)
  };
}

export function crawlConfig(
  value: Readonly<Record<string, unknown>>
): TechnicalCrawlConfig {
  if (!Array.isArray(value.startUrls) || value.startUrls.length < 1 ||
      value.startUrls.length > 20) {
    invalid("startUrls");
  }
  const urls = value.startUrls.map((item, index) => {
    if (typeof item !== "string") invalid(`startUrls.${index}`);
    try {
      return assertSafeCrawlUrl(item).toString();
    } catch {
      invalid(`startUrls.${index}`);
    }
  });
  const origins = new Set(urls.map((url) => new URL(url).origin));
  if (origins.size !== 1 || new Set(urls).size !== urls.length) {
    invalid("startUrls");
  }
  if (value.obeyRobots !== true) invalid("obeyRobots");
  return {
    startUrls: urls,
    maxUrls: integer(value.maxUrls, "maxUrls", 1, 1_000),
    maxDepth: integer(value.maxDepth, "maxDepth", 0, 10),
    requestsPerMinute: integer(
      value.requestsPerMinute,
      "requestsPerMinute",
      1,
      60
    ),
    obeyRobots: true
  };
}

function record(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !keys.includes(key))) invalid("body");
  return input;
}

function uuid(value: unknown, field: string): string {
  return patternString(value, field, UUID_PATTERN).toLowerCase();
}

function patternString(
  value: unknown,
  field: string,
  pattern: RegExp
): string {
  if (typeof value !== "string" || !pattern.test(value)) invalid(field);
  return value;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) invalid(field);
  return normalized;
}

function integer(
  value: unknown,
  field: string,
  min: number,
  max: number
): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    invalid(field);
  }
  return Number(value);
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid technical crawl field: ${field}`);
}
