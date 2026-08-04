import type {
  KeywordResearchRunSummary,
  KeywordResearchRow as KeywordResearchRowSummary,
  SemanticCapacityEntitlement
} from "@seo-platform/contracts";
import type {
  KeywordResearchRow,
  KeywordResearchRun,
  Prisma
} from "../generated/prisma/client.js";

export function keywordResearchSummary(
  run: KeywordResearchRun,
  rows: readonly KeywordResearchRow[]
): KeywordResearchRunSummary {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    provider: provider(run.provider),
    domain: run.domain,
    database: run.database as KeywordResearchRunSummary["database"],
    maxKeywords: run.maxKeywords,
    status: run.status,
    ...(run.totalAvailable === null
      ? {}
      : { totalAvailable: run.totalAvailable }),
    collectedKeywords: run.collectedKeywords,
    selectedKeywords: run.selectedKeywords,
    importedKeywords: run.importedKeywords,
    rows: rows.map(keywordResearchRow),
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

function keywordResearchRow(row: KeywordResearchRow): KeywordResearchRowSummary {
  return {
    id: row.id,
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
    selected: row.selected
  };
}

function provider(value: string): "KEYS_SO" {
  if (value !== "KEYS_SO") {
    throw new TypeError("Stored keyword research provider is invalid");
  }
  return value;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
