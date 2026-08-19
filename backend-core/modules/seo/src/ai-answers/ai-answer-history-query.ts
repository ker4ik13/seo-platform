import { BadRequestException } from "@nestjs/common";
import {
  aiAnswerHistoryMaxPageSize,
  type AiAnswerHistoryQuery
} from "@seo-platform/contracts";

export function aiAnswerHistoryQuery(value: unknown): AiAnswerHistoryQuery {
  const input = record(value);
  if (Object.keys(input).some((key) => !["limit", "cursor"].includes(key))) {
    invalid("query");
  }
  return {
    limit: pageLimit(input.limit),
    ...(input.cursor === undefined ? {} : { cursor: opaqueCursor(input.cursor) })
  };
}

function pageLimit(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > aiAnswerHistoryMaxPageSize
  ) {
    invalid("limit");
  }
  return parsed;
}

function opaqueCursor(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4_096 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    invalid("cursor");
  }
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("query");
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid AI answer history query field: ${field}`);
}
