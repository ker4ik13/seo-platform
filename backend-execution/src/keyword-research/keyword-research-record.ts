import type {
  KeysSoCompetitor,
  KeysSoDomainOverview,
  KeysSoDatabase,
  KeywordResearchRunSummary,
  KeywordResearchRow as KeywordResearchRowSummary,
  KeywordResearchRowPage,
  SemanticCapacityEntitlement,
  WordstatExpansionDevice
} from "@seo-platform/contracts";
import type {
  KeywordResearchRow,
  KeywordResearchRun,
  Prisma
} from "../generated/prisma/client.js";
import type { Job } from "../generated/prisma/client.js";
import {
  storedXmlStockOperationUsage,
  xmlStockUsageWithActual
} from "../integrations/xmlstock-pricing.js";

export function keywordResearchSummary(
  run: KeywordResearchRun,
  rows: readonly KeywordResearchRow[],
  job?: Pick<Job, "scopeSnapshot" | "attempt">
): KeywordResearchRunSummary {
  const source = researchSource(run.source);
  const snapshot = inputSnapshot(run.inputSnapshot, source);
  const storedUsage = storedXmlStockOperationUsage(
    jsonRecordOptional(job?.scopeSnapshot)?.providerUsage
  );
  const successfulRequests = snapshot.source === "XMLSTOCK_WORDSTAT"
    ? Math.min(snapshot.queries.length, Math.max(0, run.nextPage - 1))
    : 0;
  const providerUsage = snapshot.source === "XMLSTOCK_WORDSTAT"
    ? xmlStockUsageWithActual(
        storedUsage,
        successfulRequests,
        successfulRequests + Math.max(0, job?.attempt ?? 0)
      )
    : undefined;
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    actorId: run.actorId,
    source,
    provider: provider(run.provider),
    ...(providerUsage ? { providerUsage } : {}),
    ...(run.domain ? { domain: run.domain } : {}),
    ...(run.database
      ? { database: run.database as KeysSoDatabase }
      : {}),
    ...(snapshot.source !== "KEYS_SO"
      ? {
          regionCode: snapshot.regionCode,
          device: snapshot.device,
          seedCount: snapshot.queries.length,
          includeRightColumn: snapshot.includeRightColumn
        }
      : {}),
    ...(run.overview ? { overview: overview(run.overview) } : {}),
    ...(run.competitors ? { competitors: competitors(run.competitors) } : {}),
    maxKeywords: run.maxKeywords,
    status: run.status,
    ...(run.totalAvailable === null
      ? {}
      : { totalAvailable: run.totalAvailable }),
    collectedKeywords: run.collectedKeywords,
    selectedKeywords: run.selectedKeywords,
    importedKeywords: run.importedKeywords,
    rows: rows.map(keywordResearchRow),
    ...(run.targetGroupPath ? { targetGroupPath: run.targetGroupPath } : {}),
    ...(run.retryAt ? { retryAt: run.retryAt.toISOString() } : {}),
    ...(run.failureCode ? { failureCode: run.failureCode } : {}),
    version: run.version,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {})
  };
}

export function entitlementJson(
  entitlement: SemanticCapacityEntitlement
): Prisma.InputJsonValue {
  return entitlement as unknown as Prisma.InputJsonValue;
}

export function storedEntitlement(value: Prisma.JsonValue | null) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Stored keyword research entitlement is invalid");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const fields = [
    "planCode",
    "planVersion",
    "storedKeywords",
    "keywordsPerProject",
    "foldersPerProject",
    "trackedContextPairs"
  ] as const;
  if (
    Object.keys(input).some((key) => !fields.includes(key as never)) ||
    typeof input.planCode !== "string" ||
    input.planCode.length < 1 ||
    input.planCode.length > 64 ||
    fields.slice(1).some((key) => !nonNegativeInteger(input[key])) ||
    Number(input.planVersion) < 1
  ) {
    throw new TypeError("Stored keyword research entitlement is invalid");
  }
  return {
    planCode: input.planCode,
    planVersion: Number(input.planVersion),
    storedKeywords: Number(input.storedKeywords),
    keywordsPerProject: Number(input.keywordsPerProject),
    foldersPerProject: Number(input.foldersPerProject),
    trackedContextPairs: Number(input.trackedContextPairs)
  } satisfies SemanticCapacityEntitlement;
}

export function keywordResearchRow(row: KeywordResearchRow): KeywordResearchRowSummary {
  return {
    id: row.id,
    ordinal: row.ordinal,
    keyword: row.keyword,
    ...(row.url ? { url: row.url } : {}),
    ...(row.frequencyBase === null ? {} : { frequencyBase: row.frequencyBase }),
    ...(row.frequencyExact === null
      ? {}
      : { frequencyExact: row.frequencyExact }),
    ...(row.frequencyFixed === null
      ? {}
      : { frequencyFixed: row.frequencyFixed }),
    ...(row.position === null ? {} : { position: row.position }),
    ...(row.kei === null ? {} : { kei: row.kei }),
    ...(row.sourceQuery === null ? {} : { sourceQuery: row.sourceQuery }),
    ...(row.sourceColumn === null
      ? {}
      : { sourceColumn: sourceColumn(row.sourceColumn) }),
    selected: row.selected
  };
}

export function keywordResearchRowPage(
  rows: readonly KeywordResearchRow[],
  limit: number
): KeywordResearchRowPage {
  const hasNext = rows.length > limit;
  const visible = hasNext ? rows.slice(0, limit) : rows;
  const nextCursor = hasNext ? visible.at(-1)?.ordinal : undefined;
  return {
    rows: visible.map(keywordResearchRow),
    page: {
      hasNext,
      ...(nextCursor === undefined ? {} : { nextCursor: String(nextCursor) })
    }
  };
}

function provider(value: string): "KEYS_SO" | "ARSENKIN" | "XMLSTOCK" {
  if (value !== "KEYS_SO" && value !== "ARSENKIN" && value !== "XMLSTOCK") {
    throw new TypeError("Stored keyword research provider is invalid");
  }
  return value;
}

function researchSource(value: string): KeywordResearchRunSummary["source"] {
  if (
    value !== "KEYS_SO" &&
    value !== "ARSENKIN_WORDSTAT" &&
    value !== "XMLSTOCK_WORDSTAT"
  ) {
    throw new TypeError("Stored keyword research source is invalid");
  }
  return value;
}

function inputSnapshot(
  value: Prisma.JsonValue,
  source: KeywordResearchRunSummary["source"]
): StoredInputSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Stored keyword research input is invalid");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (input.source !== source) {
    throw new TypeError("Stored keyword research input source is invalid");
  }
  if (source !== "KEYS_SO") {
    if (
      !Array.isArray(input.queries) ||
      input.queries.some((item) => typeof item !== "string") ||
      typeof input.regionCode !== "string" ||
      !["ALL", "DESKTOP", "MOBILE", "PHONE_ONLY", "TABLET_ONLY"].includes(
        String(input.device)
      ) ||
      typeof input.includeRightColumn !== "boolean"
    ) {
      throw new TypeError("Stored Wordstat input is invalid");
    }
    return {
      source,
      queries: input.queries as readonly string[],
      regionCode: input.regionCode,
      device: input.device as WordstatExpansionDevice,
      includeRightColumn: input.includeRightColumn
    };
  }
  return { source };
}

type StoredInputSnapshot =
  | { readonly source: "KEYS_SO" }
  | {
      readonly source: "ARSENKIN_WORDSTAT" | "XMLSTOCK_WORDSTAT";
      readonly queries: readonly string[];
      readonly regionCode: string;
      readonly device: WordstatExpansionDevice;
      readonly includeRightColumn: boolean;
    };

function overview(value: Prisma.JsonValue): KeysSoDomainOverview {
  const input = jsonRecord(value, "overview");
  const visibility = optionalStoredNumber(input.visibility);
  const pagesInIndex = optionalStoredInteger(input.pagesInIndex);
  const aiAnswers = optionalStoredInteger(input.aiAnswers);
  return {
    top1: storedInteger(input.top1),
    top3: storedInteger(input.top3),
    top5: storedInteger(input.top5),
    top10: storedInteger(input.top10),
    top50: storedInteger(input.top50),
    ...(visibility === undefined ? {} : { visibility }),
    ...(pagesInIndex === undefined ? {} : { pagesInIndex }),
    ...(aiAnswers === undefined ? {} : { aiAnswers })
  };
}

function competitors(value: Prisma.JsonValue): readonly KeysSoCompetitor[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("Stored Keys.so competitors are invalid");
  }
  return value.map((item) => {
    const input = jsonRecord(item, "competitor");
    if (typeof input.domain !== "string" || !input.domain) {
      throw new TypeError("Stored Keys.so competitor is invalid");
    }
    const similarity = optionalStoredNumber(input.similarity);
    const thematicity = optionalStoredNumber(input.thematicity);
    const top10 = optionalStoredInteger(input.top10);
    const top50 = optionalStoredInteger(input.top50);
    const visibility = optionalStoredNumber(input.visibility);
    return {
      domain: input.domain,
      commonKeywords: storedInteger(input.commonKeywords),
      ...(similarity === undefined ? {} : { similarity }),
      ...(thematicity === undefined ? {} : { thematicity }),
      ...(top10 === undefined ? {} : { top10 }),
      ...(top50 === undefined ? {} : { top50 }),
      ...(visibility === undefined ? {} : { visibility })
    };
  });
}

function jsonRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Stored keyword research ${label} is invalid`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function jsonRecordOptional(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function storedInteger(value: unknown): number {
  if (!nonNegativeInteger(value)) {
    throw new TypeError("Stored keyword research integer is invalid");
  }
  return Number(value);
}

function optionalStoredInteger(value: unknown): number | undefined {
  return value === undefined ? undefined : storedInteger(value);
}

function optionalStoredNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError("Stored keyword research number is invalid");
  }
  return value;
}

function sourceColumn(value: string): "LEFT" | "RIGHT" {
  if (value !== "LEFT" && value !== "RIGHT") {
    throw new TypeError("Stored Wordstat source column is invalid");
  }
  return value;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
