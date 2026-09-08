import { parseSemanticRankDimensionKey } from "@seo-platform/contracts";
import { BadRequestException } from "@nestjs/common";
import type { RankHistoryQuery } from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function rankHistoryQuery(value: unknown): RankHistoryQuery {
  const input = record(value);
  const allowed = new Set([
    "observedFrom",
    "observedBefore",
    "trackingContextId",
    "dimensionKey",
    "mode",
    "keywordId",
    "limit",
    "cursor"
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    invalid("query");
  }
  const observedFrom = isoInstant(
    input.observedFrom,
    "observedFrom"
  );
  const observedBefore = isoInstant(
    input.observedBefore,
    "observedBefore"
  );
  if (Date.parse(observedFrom) >= Date.parse(observedBefore)) {
    invalid("observedBefore");
  }
  if (input.dimensionKey !== undefined && !parseSemanticRankDimensionKey(input.dimensionKey)) invalid("dimensionKey");
  if (input.mode !== undefined && input.mode !== "SERP") invalid("mode");
  if (input.mode === "SERP" && Number(input.limit ?? 200) > 10) invalid("limit");
  return {
    ...(typeof input.dimensionKey === "string" ? { dimensionKey: input.dimensionKey } : {}),
    ...(input.mode === "SERP" ? { mode: "SERP" as const } : {}),
    observedFrom,
    observedBefore,
    ...optionalUuid(input.trackingContextId, "trackingContextId"),
    ...optionalKeywordId(input.keywordId),
    limit: pageLimit(input.limit),
    ...optionalCursor(input.cursor)
  };
}

function optionalUuid(
  value: unknown,
  field: "trackingContextId"
): { readonly trackingContextId?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string") invalid(field);
  const uuid = internalUuid(value, field);
  if (!UUID_V7_PATTERN.test(uuid)) invalid(field);
  return { trackingContextId: uuid };
}

function optionalKeywordId(
  value: unknown
): { readonly keywordId?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string") invalid("keywordId");
  const uuid = internalUuid(value, "keywordId");
  if (!UUID_V7_PATTERN.test(uuid)) invalid("keywordId");
  return { keywordId: uuid };
}

function optionalCursor(
  value: unknown
): { readonly cursor?: string } {
  if (value === undefined) return {};
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4_096
  ) {
    invalid("cursor");
  }
  return { cursor: value };
}

function pageLimit(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          /^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > 200
  ) {
    invalid("limit");
  }
  return parsed;
}

function isoInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length !== 24) {
    invalid(field);
  }
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    invalid(field);
  }
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    invalid("query");
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalid(field: string): never {
  throw new BadRequestException(
    `Invalid rank history query field: ${field}`
  );
}
