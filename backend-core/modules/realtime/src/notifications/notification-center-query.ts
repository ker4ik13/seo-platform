import { BadRequestException } from "@nestjs/common";
import type { NotificationListQuery } from "@seo-platform/contracts";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,1000}$/u;

export function notificationListQuery(value: unknown): NotificationListQuery {
  const query =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  const rawLimit = optionalSingleString(query.limit, "limit");
  const cursor = optionalSingleString(query.cursor, "cursor");
  const rawUnread = optionalSingleString(query.unreadOnly, "unreadOnly");
  const limit = rawLimit === undefined ? 30 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    invalid("limit");
  }
  if (cursor && !CURSOR_PATTERN.test(cursor)) invalid("cursor");
  if (
    rawUnread !== undefined &&
    rawUnread !== "true" &&
    rawUnread !== "false"
  ) {
    invalid("unreadOnly");
  }
  return {
    limit,
    ...(cursor ? { cursor } : {}),
    unreadOnly: rawUnread === "true"
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
