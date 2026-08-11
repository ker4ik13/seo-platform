import { Injectable } from "@nestjs/common";
import type {
  CreateSemanticExportInput,
  KeywordListQuery,
  SemanticExportDataset,
  SemanticKeywordListItem,
  SemanticKeywordSort
} from "@seo-platform/contracts";
import type { InternalProjectContext } from "../authorization/project-tenant.js";
import { DomainError } from "../common/domain-error.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { semanticExportDocument } from "./semantic-export-document.js";

const PAGE_SIZE = 200;
const MAX_SYNCHRONOUS_EXPORT_ROWS = 2_000;

@Injectable()
export class SemanticExportService {
  public constructor(private readonly seoData: SeoDataClient) {}

  public async create(
    context: InternalProjectContext,
    input: CreateSemanticExportInput
  ) {
    const [items, customColumns] = await Promise.all([
      this.exportItems(context, input),
      this.seoData.listSemanticCustomColumns(context)
    ]);
    const dataset: SemanticExportDataset = {
      items,
      customColumnNames: Object.fromEntries(
        customColumns.map(({ id, name }) => [id, name])
      )
    };
    return semanticExportDocument(dataset, input);
  }

  private async exportItems(
    context: InternalProjectContext,
    input: CreateSemanticExportInput
  ): Promise<readonly SemanticKeywordListItem[]> {
    if (input.scope === "SELECTED" || input.scope === "CURRENT_PAGE") {
      return this.selectedItems(context, input.keywordIds!, input.sort);
    }
    if (input.scope === "GROUP_SUBTREE") {
      return this.groupSubtreeItems(context, input);
    }
    return this.allItems(context, {
      limit: PAGE_SIZE,
      ...(input.scope === "CURRENT_FILTER" ? input.filters : {}),
      sort: input.sort ?? "CREATED_DESC"
    });
  }

  private async selectedItems(
    context: InternalProjectContext,
    keywordIds: readonly string[],
    sort: SemanticKeywordSort | undefined
  ): Promise<readonly SemanticKeywordListItem[]> {
    const wanted = new Set(keywordIds);
    const found = new Map<string, SemanticKeywordListItem>();
    let cursor: string | undefined;
    let scanned = 0;
    do {
      const result = await this.seoData.listKeywords(context, {
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        sort: sort ?? "CREATED_DESC"
      });
      scanned += result.data.length;
      for (const item of result.data) {
        if (wanted.has(item.id)) found.set(item.id, item);
      }
      if (found.size === wanted.size) break;
      if (!result.page.hasNext) break;
      if (
        !result.page.nextCursor ||
        scanned >= MAX_SYNCHRONOUS_EXPORT_ROWS
      ) {
        throw synchronousLimit();
      }
      cursor = result.page.nextCursor;
    } while (cursor);

    if (found.size !== wanted.size) {
      throw new DomainError({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "One or more selected semantic keywords are unavailable",
        details: { missingCount: wanted.size - found.size }
      });
    }
    const items = keywordIds.map((id) => found.get(id)!);
    return sort ? [...items].sort(keywordComparator(sort)) : items;
  }

  private async groupSubtreeItems(
    context: InternalProjectContext,
    input: CreateSemanticExportInput
  ): Promise<readonly SemanticKeywordListItem[]> {
    const groups = await this.seoData.listKeywordGroups(context);
    const rootId = input.filters!.groupId!;
    if (!groups.some(({ id }) => id === rootId)) {
      throw new DomainError({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Semantic keyword group not found"
      });
    }
    const descendants = new Set([rootId]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const group of groups) {
        if (
          group.parentId &&
          descendants.has(group.parentId) &&
          !descendants.has(group.id)
        ) {
          descendants.add(group.id);
          changed = true;
        }
      }
    }
    const byId = new Map<string, SemanticKeywordListItem>();
    for (const groupId of descendants) {
      const rows = await this.allItems(context, {
        limit: PAGE_SIZE,
        ...input.filters,
        groupId,
        sort: input.sort ?? "CREATED_DESC"
      });
      for (const row of rows) {
        byId.set(row.id, row);
        if (byId.size > MAX_SYNCHRONOUS_EXPORT_ROWS) {
          throw synchronousLimit();
        }
      }
    }
    return [...byId.values()].sort(keywordComparator(input.sort));
  }

  private async allItems(
    context: InternalProjectContext,
    query: KeywordListQuery
  ): Promise<readonly SemanticKeywordListItem[]> {
    const items: SemanticKeywordListItem[] = [];
    let cursor: string | undefined;
    const observedCursors = new Set<string>();
    do {
      const result = await this.seoData.listKeywords(context, {
        ...query,
        ...(cursor ? { cursor } : {})
      });
      if (
        items.length + result.data.length >
        MAX_SYNCHRONOUS_EXPORT_ROWS
      ) {
        throw synchronousLimit();
      }
      items.push(...result.data);
      if (!result.page.hasNext) break;
      const nextCursor = result.page.nextCursor;
      if (!nextCursor || observedCursors.has(nextCursor)) {
        throw new DomainError({
          statusCode: 502,
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Semantic pagination did not make progress",
          retryable: true
        });
      }
      observedCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);
    return items;
  }
}

function keywordComparator(
  sort: SemanticKeywordSort | undefined
): (left: SemanticKeywordListItem, right: SemanticKeywordListItem) => number {
  const selected = sort ?? "CREATED_DESC";
  return (left, right) => {
    switch (selected) {
      case "CREATED_ASC":
        return compare(left.createdAt, right.createdAt) || compare(left.id, right.id);
      case "UPDATED_DESC":
        return compare(right.updatedAt, left.updatedAt) || compare(right.id, left.id);
      case "UPDATED_ASC":
        return compare(left.updatedAt, right.updatedAt) || compare(left.id, right.id);
      case "TEXT_ASC":
        return (
          compare(left.textNormalized, right.textNormalized) ||
          compare(left.id, right.id)
        );
      case "TEXT_DESC":
        return (
          compare(right.textNormalized, left.textNormalized) ||
          compare(right.id, left.id)
        );
      case "PRIORITY_DESC":
        return right.priority - left.priority || compare(right.id, left.id);
      case "PRIORITY_ASC":
        return left.priority - right.priority || compare(left.id, right.id);
      case "SOURCE_ASC":
        return compare(left.sourceMode, right.sourceMode) || compare(left.id, right.id);
      case "SOURCE_DESC":
        return compare(right.sourceMode, left.sourceMode) || compare(right.id, left.id);
      case "TAGS_ASC":
      case "TAGS_DESC":
        return compareTags(left, right, selected);
      case "FREQUENCY_BASE_DESC":
      case "FREQUENCY_BASE_ASC":
      case "FREQUENCY_EXACT_DESC":
      case "FREQUENCY_EXACT_ASC":
      case "FREQUENCY_FIXED_DESC":
      case "FREQUENCY_FIXED_ASC":
        return compareMetric(left, right, selected);
      case "YANDEX_POSITION_ASC":
      case "YANDEX_POSITION_DESC":
      case "GOOGLE_POSITION_ASC":
      case "GOOGLE_POSITION_DESC":
        return comparePosition(left, right, selected);
      case "YANDEX_CHECKED_AT_ASC":
      case "YANDEX_CHECKED_AT_DESC":
      case "GOOGLE_CHECKED_AT_ASC":
      case "GOOGLE_CHECKED_AT_DESC":
        return compareCheckedAt(left, right, selected);
      case "CREATED_DESC":
        return compare(right.createdAt, left.createdAt) || compare(right.id, left.id);
    }
  };
}

function compareTags(
  left: SemanticKeywordListItem,
  right: SemanticKeywordListItem,
  sort: SemanticKeywordSort
): number {
  const firstTag = (item: SemanticKeywordListItem) =>
    item.tags
      .map((tag) => tag.normalize("NFKC").toLocaleLowerCase())
      .sort()[0] ?? null;
  const leftValue = firstTag(left);
  const rightValue = firstTag(right);
  if (leftValue === null || rightValue === null) {
    if (leftValue === rightValue) return compare(left.id, right.id);
    return leftValue === null ? 1 : -1;
  }
  const comparison = compare(leftValue, rightValue);
  return (sort === "TAGS_ASC" ? comparison : -comparison) ||
    compare(left.id, right.id);
}

function compareMetric(
  left: SemanticKeywordListItem,
  right: SemanticKeywordListItem,
  sort: SemanticKeywordSort
): number {
  const type = sort.includes("_EXACT_") ? "EXACT" : sort.includes("_FIXED_") ? "FIXED" : "BASE";
  const value = (item: SemanticKeywordListItem) => {
    const raw = item.frequencies?.find((entry) => entry.type === type)?.value;
    return raw === undefined ? null : BigInt(raw);
  };
  const leftValue = value(left);
  const rightValue = value(right);
  if (leftValue === null || rightValue === null) {
    if (leftValue === rightValue) return compare(left.id, right.id);
    return leftValue === null ? 1 : -1;
  }
  const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  return (sort.endsWith("_ASC") ? comparison : -comparison) || compare(left.id, right.id);
}

function comparePosition(
  left: SemanticKeywordListItem,
  right: SemanticKeywordListItem,
  sort: SemanticKeywordSort
): number {
  const engine = sort.startsWith("YANDEX") ? "YANDEX" : "GOOGLE";
  const value = (item: SemanticKeywordListItem) =>
    item.positions?.find((entry) => entry.searchEngine === engine)?.position ?? null;
  const leftValue = value(left);
  const rightValue = value(right);
  if (leftValue === null || rightValue === null) {
    if (leftValue === rightValue) return compare(left.id, right.id);
    return leftValue === null ? 1 : -1;
  }
  const comparison = leftValue - rightValue;
  return (sort.endsWith("_ASC") ? comparison : -comparison) || compare(left.id, right.id);
}

function compareCheckedAt(
  left: SemanticKeywordListItem,
  right: SemanticKeywordListItem,
  sort: SemanticKeywordSort
): number {
  const engine = sort.startsWith("YANDEX") ? "YANDEX" : "GOOGLE";
  const value = (item: SemanticKeywordListItem) =>
    item.positions?.find((entry) => entry.searchEngine === engine)?.observedAt ?? null;
  const leftValue = value(left);
  const rightValue = value(right);
  if (leftValue === null || rightValue === null) {
    if (leftValue === rightValue) return compare(left.id, right.id);
    return leftValue === null ? 1 : -1;
  }
  const comparison = compare(leftValue, rightValue);
  return (sort.endsWith("_ASC") ? comparison : -comparison) || compare(left.id, right.id);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function synchronousLimit(): DomainError {
  return new DomainError({
    statusCode: 413,
    code: "FILE_TOO_LARGE",
    message:
      "This export exceeds the synchronous limit and must run as a background job",
    details: {
      limitRows: MAX_SYNCHRONOUS_EXPORT_ROWS,
      asynchronousExportRequired: true
    }
  });
}
