import { BadRequestException } from "@nestjs/common";
import type { KeywordListQuery } from "@seo-platform/contracts";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,1000}$/u;

export function keywordListQuery(value: unknown): KeywordListQuery {
  const query =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  const limit = optionalSingleString(query.limit, "limit");
  const cursor = optionalSingleString(query.cursor, "cursor");
  const search = optionalSingleString(query.search, "search")?.normalize(
    "NFKC"
  );
  const parsedLimit = limit === undefined ? 100 : Number(limit);
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > 200
  ) {
    invalid("limit");
  }
  if (cursor && !CURSOR_PATTERN.test(cursor)) invalid("cursor");
  if (search && search.length > 200) invalid("search");
  return {
    limit: parsedLimit,
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {})
  };
}

function optionalSingleString(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid query parameter: ${field}`);
}
