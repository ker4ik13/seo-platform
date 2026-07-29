import type { NotificationListQuery } from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

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
    invalid("limit", "OUT_OF_RANGE");
  }
  if (cursor && !CURSOR_PATTERN.test(cursor)) {
    invalid("cursor", "INVALID_CURSOR");
  }
  if (
    rawUnread !== undefined &&
    rawUnread !== "true" &&
    rawUnread !== "false"
  ) {
    invalid("unreadOnly", "INVALID_BOOLEAN");
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
  if (typeof value !== "string" || !value.trim()) {
    invalid(field, "SINGLE_VALUE_REQUIRED");
  }
  return value.trim();
}

function invalid(path: string, code: string): never {
  throw validationError(path, code, "Notification list filter is invalid");
}
