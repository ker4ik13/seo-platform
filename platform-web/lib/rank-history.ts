import {
  rankHistoryMaxPageSize,
  redactRankHistoryItem,
  type RankHistoryItem,
  type RankHistoryQuery
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  type BrowserApiCollection,
  type BrowserCursorPage
} from "./browser-api.ts";

export const rankHistoryPageSize = 50 as const;
export const rankHistoryKeywordPageSize = 100 as const;

export interface RankHistoryDateSelection {
  readonly fromDate: string;
  readonly toDate: string;
}

export interface RankHistoryRequest {
  readonly observedFrom: string;
  readonly observedBefore: string;
  readonly trackingContextId?: string;
  readonly keywordId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ParsedRankHistoryCollection {
  readonly data: readonly RankHistoryItem[];
  readonly page: BrowserCursorPage;
}

export function rankHistoryReturnTo(projectId: string): string {
  if (!projectId.trim()) {
    throw new TypeError("Project id is required");
  }
  return "/app/semantics";
}

export function defaultRankHistoryDateSelection(
  now = new Date()
): RankHistoryDateSelection {
  if (Number.isNaN(now.getTime())) {
    throw new TypeError("Invalid current date");
  }
  const to = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return {
    fromDate: utcDateInputValue(from),
    toDate: utcDateInputValue(to)
  };
}

export function rankHistoryRangeFromDates(
  fromDate: string,
  toDate: string
): Pick<RankHistoryQuery, "observedFrom" | "observedBefore"> {
  const from = parseUtcDateInput(fromDate);
  const to = parseUtcDateInput(toDate);
  if (!from || !to || from.getTime() > to.getTime()) {
    throw new TypeError("Invalid rank history date range");
  }
  const before = new Date(to);
  before.setUTCDate(before.getUTCDate() + 1);
  return {
    observedFrom: from.toISOString(),
    observedBefore: before.toISOString()
  };
}

export function rankHistoryApiPath(
  projectId: string,
  request: RankHistoryRequest
): string {
  const limit = request.limit ?? rankHistoryPageSize;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > rankHistoryMaxPageSize ||
    !canonicalIsoInstant(request.observedFrom) ||
    !canonicalIsoInstant(request.observedBefore) ||
    Date.parse(request.observedFrom) >=
      Date.parse(request.observedBefore)
  ) {
    throw new TypeError("Invalid rank history request");
  }
  const query = new URLSearchParams({
    observedFrom: request.observedFrom,
    observedBefore: request.observedBefore,
    limit: String(limit)
  });
  if (request.trackingContextId) {
    query.set("trackingContextId", request.trackingContextId);
  }
  if (request.keywordId) query.set("keywordId", request.keywordId);
  if (request.cursor) query.set("cursor", request.cursor);
  return `/app/api/projects/${encodeURIComponent(projectId)}/rank-history?${query.toString()}`;
}

export function parseRankHistoryItem(value: unknown): RankHistoryItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidHistoryResponse();
  }
  try {
    return redactRankHistoryItem(value as RankHistoryItem);
  } catch {
    throw invalidHistoryResponse();
  }
}

export function parseRankHistoryCollection(
  collection: BrowserApiCollection<unknown>
): ParsedRankHistoryCollection {
  if (
    collection.data.length > rankHistoryMaxPageSize ||
    (collection.page.hasNext &&
      !collection.page.nextCursor) ||
    (!collection.page.hasNext &&
      collection.page.nextCursor !== undefined)
  ) {
    throw invalidHistoryResponse();
  }
  const data = collection.data.map(parseRankHistoryItem);
  if (
    new Set(data.map(({ snapshotId }) => snapshotId)).size !==
      data.length ||
    !strictRankHistoryOrder(data)
  ) {
    throw invalidHistoryResponse();
  }
  return {
    data,
    page: {
      hasNext: collection.page.hasNext,
      ...(collection.page.nextCursor
        ? { nextCursor: collection.page.nextCursor }
        : {})
    }
  };
}

export function mergeRankHistoryItems(
  current: readonly RankHistoryItem[],
  next: readonly RankHistoryItem[]
): readonly RankHistoryItem[] {
  const currentIds = new Set(current.map(({ snapshotId }) => snapshotId));
  if (
    !strictRankHistoryOrder(current) ||
    !strictRankHistoryOrder(next) ||
    next.some(({ snapshotId }) => currentIds.has(snapshotId)) ||
    (current.length > 0 &&
      next.length > 0 &&
      !rankHistoryItemComesBefore(
        current[current.length - 1]!,
        next[0]!
      ))
  ) {
    throw invalidHistoryResponse();
  }
  return [...current, ...next];
}

function strictRankHistoryOrder(
  items: readonly RankHistoryItem[]
): boolean {
  return items.every(
    (item, index) =>
      index === 0 ||
      rankHistoryItemComesBefore(items[index - 1]!, item)
  );
}

function rankHistoryItemComesBefore(
  left: RankHistoryItem,
  right: RankHistoryItem
): boolean {
  const observedDifference =
    Date.parse(left.observedAt) - Date.parse(right.observedAt);
  return (
    observedDifference > 0 ||
    (observedDifference === 0 &&
      left.snapshotId > right.snapshotId)
  );
}

function parseUtcDateInput(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const [yearValue, monthValue, dayValue] = value.split("-");
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));
  return utcDateInputValue(date) === value ? date : undefined;
}

function utcDateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function canonicalIsoInstant(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length === 24 &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function invalidHistoryResponse(): BrowserApiError {
  return new BrowserApiError(
    502,
    "INVALID_RESPONSE",
    "Сервис вернул некорректную историю позиций"
  );
}
