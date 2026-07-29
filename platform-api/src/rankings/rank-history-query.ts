import { Buffer } from "node:buffer";
import {
  rankHistoryMaxPageSize,
  type RankHistoryQuery
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,4096}$/u;
const LIMIT_PATTERN =
  /^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/u;
const ALLOWED_QUERY_KEYS = [
  "observedFrom",
  "observedBefore",
  "trackingContextId",
  "keywordId",
  "limit",
  "cursor"
] as const;

export function rankHistoryQuery(value: unknown): RankHistoryQuery {
  const input = exactQueryRecord(value);
  const observedFrom = canonicalIsoInstant(
    input.observedFrom,
    "observedFrom"
  );
  const observedBefore = canonicalIsoInstant(
    input.observedBefore,
    "observedBefore"
  );
  if (Date.parse(observedFrom) >= Date.parse(observedBefore)) {
    invalid(
      "observedBefore",
      "Must be later than observedFrom"
    );
  }

  const trackingContextId = optionalUuidV7(
    input.trackingContextId,
    "trackingContextId"
  );
  const keywordId = optionalUuidV7(input.keywordId, "keywordId");
  const cursor = optionalCursor(input.cursor);
  const limit = pageLimit(input.limit);

  return {
    observedFrom,
    observedBefore,
    ...(trackingContextId ? { trackingContextId } : {}),
    ...(keywordId ? { keywordId } : {}),
    limit,
    ...(cursor ? { cursor } : {})
  };
}

export function isOpaqueRankHistoryCursor(
  value: unknown
): value is string {
  if (typeof value !== "string" || !CURSOR_PATTERN.test(value)) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    return (
      decoded.length > 0 &&
      decoded.toString("base64url") === value
    );
  } catch {
    return false;
  }
}

function exactQueryRecord(
  value: unknown
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    invalid("$query", "Must be a query object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).some(
      (key) => !ALLOWED_QUERY_KEYS.includes(
        key as (typeof ALLOWED_QUERY_KEYS)[number]
      )
    )
  ) {
    invalid("$query", "Contains unsupported query parameters");
  }
  return input;
}

function canonicalIsoInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length !== 24) {
    invalid(field, "Must be a canonical ISO 8601 instant");
  }
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    invalid(field, "Must be a canonical ISO 8601 instant");
  }
  return value;
}

function optionalUuidV7(
  value: unknown,
  field: "trackingContextId" | "keywordId"
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    invalid(field, "Must be a UUIDv7");
  }
  return value.toLowerCase();
}

function optionalCursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isOpaqueRankHistoryCursor(value)) {
    invalid(
      "cursor",
      "Must be an opaque base64url cursor of at most 4096 characters"
    );
  }
  return value;
}

function pageLimit(value: unknown): number {
  if (value === undefined) return 100;
  if (typeof value !== "string" || !LIMIT_PATTERN.test(value)) {
    invalid(
      "limit",
      `Must be an integer between 1 and ${rankHistoryMaxPageSize}`
    );
  }
  return Number(value);
}

function invalid(path: string, message: string): never {
  throw validationError(
    path,
    "INVALID_QUERY_PARAMETER",
    message
  );
}
