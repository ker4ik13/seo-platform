import { BadRequestException } from "@nestjs/common";
import {
  aiAnswerHistoryMaxPageSize,
  type AiAnswerHistoryQuery
} from "@seo-platform/contracts";

export function aiAnswerHistoryQuery(value: unknown): AiAnswerHistoryQuery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("query");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !["limit", "cursor"].includes(key))) {
    invalid("query");
  }
  const parsed =
    typeof input.limit === "number"
      ? input.limit
      : typeof input.limit === "string" &&
          /^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/u.test(input.limit)
        ? Number(input.limit)
        : Number.NaN;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > aiAnswerHistoryMaxPageSize
  ) {
    invalid("limit");
  }
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== "string" ||
      input.cursor.length < 1 ||
      input.cursor.length > 4_096 ||
      !/^[A-Za-z0-9_-]+$/u.test(input.cursor))
  ) {
    invalid("cursor");
  }
  return {
    limit: parsed,
    ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {})
  };
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid AI answer history query field: ${field}`);
}
