import {
  redactRankHistoryItem,
  type RankHistoryCursorPage,
  type RankHistoryItem,
  type RankHistoryQuery
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import { isOpaqueRankHistoryCursor } from "./rank-history-query.js";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface RankHistoryPage {
  readonly data: readonly RankHistoryItem[];
  readonly page: RankHistoryCursorPage;
}

export function rankHistoryPage(
  payload: unknown,
  workspaceId: string,
  projectId: string,
  query: RankHistoryQuery
): RankHistoryPage {
  const response = exactRecord(payload, ["data", "meta"]);
  apiMeta(response.meta);
  const collection = exactRecord(response.data, [
    "workspaceId",
    "projectId",
    "items",
    "page"
  ]);
  if (
    !canonicalUuidV7(collection.workspaceId) ||
    !canonicalUuidV7(collection.projectId) ||
    collection.workspaceId !== workspaceId ||
    collection.projectId !== projectId ||
    !Array.isArray(collection.items) ||
    collection.items.length > query.limit
  ) {
    throw invalidResponse();
  }

  const data = collection.items.map(safeHistoryItem);
  assertHistoryItems(data, query);
  const page = historyPage(
    collection.page,
    data.length,
    query
  );
  return { data, page };
}

function safeHistoryItem(value: unknown): RankHistoryItem {
  try {
    return redactRankHistoryItem(value as RankHistoryItem);
  } catch {
    throw invalidResponse();
  }
}

function assertHistoryItems(
  items: readonly RankHistoryItem[],
  query: RankHistoryQuery
): void {
  const from = Date.parse(query.observedFrom);
  const before = Date.parse(query.observedBefore);
  const snapshotIds = new Set<string>();
  let previous: RankHistoryItem | undefined;

  for (const item of items) {
    const observedAt = Date.parse(item.observedAt);
    if (
      observedAt < from ||
      observedAt >= before ||
      (query.trackingContextId !== undefined &&
        item.trackingContextId !== query.trackingContextId) ||
      (query.keywordId !== undefined &&
        item.keywordId !== query.keywordId) ||
      (query.dimensionKey !== undefined && item.dimensionKey !== query.dimensionKey) ||
      (query.mode === "SERP" && !item.serpResults?.length) ||
      snapshotIds.has(item.snapshotId)
    ) {
      throw invalidResponse();
    }
    if (previous) {
      const previousObservedAt = Date.parse(previous.observedAt);
      if (
        observedAt > previousObservedAt ||
        (observedAt === previousObservedAt &&
          item.snapshotId >= previous.snapshotId)
      ) {
        throw invalidResponse();
      }
    }
    snapshotIds.add(item.snapshotId);
    previous = item;
  }
}

function historyPage(
  value: unknown,
  itemCount: number,
  query: RankHistoryQuery
): RankHistoryCursorPage {
  const page = exactRecord(value, ["hasNext", "nextCursor"]);
  if (typeof page.hasNext !== "boolean") {
    throw invalidResponse();
  }
  const nextCursor = page.nextCursor;
  if (page.hasNext) {
    if (
      itemCount !== query.limit ||
      !isOpaqueRankHistoryCursor(nextCursor) ||
      nextCursor === query.cursor
    ) {
      throw invalidResponse();
    }
    return {
      hasNext: true,
      nextCursor
    };
  }
  if (nextCursor !== undefined) throw invalidResponse();
  return { hasNext: false };
}

function apiMeta(value: unknown): void {
  const meta = exactRecord(value, ["requestId", "version"]);
  if (
    typeof meta.requestId !== "string" ||
    meta.requestId.length < 1 ||
    (meta.version !== undefined &&
      (!Number.isSafeInteger(meta.version) ||
        Number(meta.version) < 1))
  ) {
    throw invalidResponse();
  }
}

function canonicalUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw invalidResponse();
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).some((key) => !allowedKeys.includes(key))
  ) {
    throw invalidResponse();
  }
  return input;
}

function invalidResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO data service returned an invalid rank history response",
    retryable: true
  });
}
