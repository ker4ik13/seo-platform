import {
  keysSoDatabases,
  keywordResearchSources,
  keywordResearchStatuses,
  wordstatExpansionDevices,
  type KeysSoDatabase,
  type KeywordResearchRowPage,
  type KeywordResearchRunSummary,
  type KeywordResearchRow
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function scopedKeywordResearchRun(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedId?: string
): KeywordResearchRunSummary {
  const input = boundedRecord(
    value,
    [
      "id",
      "workspaceId",
      "projectId",
      "source",
      "provider",
      "maxKeywords",
      "status",
      "collectedKeywords",
      "selectedKeywords",
      "importedKeywords",
      "rows",
      "version",
      "createdAt",
      "updatedAt"
    ],
    [
      "totalAvailable",
      "domain",
      "database",
      "regionCode",
      "device",
      "seedCount",
      "includeRightColumn",
      "overview",
      "competitors",
      "targetGroupPath",
      "retryAt",
      "failureCode",
      "finishedAt",
      "actorId"
    ]
  );
  const id = uuid(input.id);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    (expectedId !== undefined && id !== expectedId) ||
    typeof input.source !== "string" ||
    !keywordResearchSources.includes(input.source as KeywordResearchRunSummary["source"]) ||
    typeof input.status !== "string" ||
    !keywordResearchStatuses.includes(
      input.status as KeywordResearchRunSummary["status"]
    ) ||
    !Array.isArray(input.rows) ||
    input.rows.length > 500
  ) {
    invalid();
  }
  const source = input.source as KeywordResearchRunSummary["source"];
  if (
    (source === "KEYS_SO" &&
      (input.provider !== "KEYS_SO" ||
        typeof input.domain !== "string" ||
        input.domain.length < 1 ||
        input.domain.length > 253 ||
        typeof input.database !== "string" ||
        !keysSoDatabases.includes(
          input.database as KeysSoDatabase
        ))) ||
    (source !== "KEYS_SO" &&
      (input.provider !== (source === "ARSENKIN_WORDSTAT" ? "ARSENKIN" : "XMLSTOCK") ||
        typeof input.regionCode !== "string" ||
        !/^\d{1,10}$/u.test(input.regionCode) ||
        typeof input.device !== "string" ||
        !wordstatExpansionDevices.includes(
          input.device as NonNullable<KeywordResearchRunSummary["device"]>
        ) ||
        typeof input.includeRightColumn !== "boolean"))
  ) {
    invalid();
  }
  return {
    id,
    workspaceId,
    projectId,
    ...(input.actorId === undefined ? {} : { actorId: uuid(input.actorId) }),
    source,
    provider: source === "KEYS_SO"
      ? "KEYS_SO"
      : source === "ARSENKIN_WORDSTAT"
        ? "ARSENKIN"
        : "XMLSTOCK",
    ...(source === "KEYS_SO"
      ? {
          domain: input.domain as string,
          database: input.database as KeysSoDatabase
        }
      : {
          regionCode: input.regionCode as string,
          device: input.device as NonNullable<KeywordResearchRunSummary["device"]>,
          seedCount: integer(input.seedCount, 1, 500),
          includeRightColumn: input.includeRightColumn as boolean
        }),
    ...(input.overview === undefined ? {} : { overview: overview(input.overview) }),
    ...(input.competitors === undefined
      ? {}
      : { competitors: competitors(input.competitors) }),
    maxKeywords: integer(input.maxKeywords, source === "KEYS_SO" ? 25 : 1, source === "KEYS_SO" ? 500 : 10_000),
    status: input.status as KeywordResearchRunSummary["status"],
    ...(input.totalAvailable === undefined
      ? {}
      : { totalAvailable: integer(input.totalAvailable, 0) }),
    collectedKeywords: integer(input.collectedKeywords, 0, 10_000),
    selectedKeywords: integer(input.selectedKeywords, 0, 10_000),
    importedKeywords: integer(input.importedKeywords, 0, 10_000),
    rows: input.rows.map(row),
    ...(input.targetGroupPath === undefined
      ? {}
      : { targetGroupPath: bounded(input.targetGroupPath, 2_048) }),
    ...(input.retryAt === undefined ? {} : { retryAt: iso(input.retryAt) }),
    ...(input.failureCode === undefined
      ? {}
      : { failureCode: code(input.failureCode) }),
    version: integer(input.version, 1),
    createdAt: iso(input.createdAt),
    updatedAt: iso(input.updatedAt),
    ...(input.finishedAt === undefined
      ? {}
      : { finishedAt: iso(input.finishedAt) })
  };
}

export function scopedKeywordResearchRowPage(
  value: unknown,
  cursor: number | undefined,
  limit: number
): KeywordResearchRowPage {
  const input = boundedRecord(value, ["rows", "page"], []);
  if (!Array.isArray(input.rows) || input.rows.length > limit) invalid();
  const rows = input.rows.map(row);
  const ordinals = rows.map(({ ordinal }) => ordinal);
  if (
    ordinals.some((ordinal, index) =>
      ordinal <= (index === 0 ? (cursor ?? 0) : ordinals[index - 1]!)
    )
  ) {
    invalid();
  }
  const page = boundedRecord(input.page, ["hasNext"], ["nextCursor"]);
  if (typeof page.hasNext !== "boolean") invalid();
  if (page.hasNext) {
    const nextCursor = bounded(page.nextCursor, 16);
    if (
      rows.length !== limit ||
      nextCursor !== String(rows.at(-1)?.ordinal)
    ) {
      invalid();
    }
    return { rows, page: { hasNext: true, nextCursor } };
  }
  if (page.nextCursor !== undefined) invalid();
  return { rows, page: { hasNext: false } };
}

function row(value: unknown): KeywordResearchRow {
  const input = boundedRecord(
    value,
    ["id", "ordinal", "keyword", "selected"],
    [
      "url",
      "frequencyBase",
      "frequencyExact",
      "frequencyFixed",
      "position",
      "kei",
      "sourceQuery",
      "sourceColumn"
    ]
  );
  if (
    typeof input.keyword !== "string" ||
    input.keyword.length < 1 ||
    input.keyword.length > 2_000 ||
    typeof input.selected !== "boolean" ||
    (input.url !== undefined &&
      (typeof input.url !== "string" || input.url.length > 8_192))
  ) {
    invalid();
  }
  return {
    id: uuid(input.id),
    ordinal: integer(input.ordinal, 1, 10_000),
    keyword: input.keyword,
    ...(input.url === undefined ? {} : { url: input.url }),
    ...(input.frequencyBase === undefined
      ? {}
      : { frequencyBase: integer(input.frequencyBase, 0) }),
    ...(input.frequencyExact === undefined
      ? {}
      : { frequencyExact: integer(input.frequencyExact, 0) }),
    ...(input.frequencyFixed === undefined
      ? {}
      : { frequencyFixed: integer(input.frequencyFixed, 0) }),
    ...(input.position === undefined
      ? {}
      : { position: integer(input.position, 1) }),
    ...(input.kei === undefined ? {} : { kei: number(input.kei) }),
    ...(input.sourceQuery === undefined
      ? {}
      : { sourceQuery: bounded(input.sourceQuery, 400) }),
    ...(input.sourceColumn === undefined
      ? {}
      : { sourceColumn: sourceColumn(input.sourceColumn) }),
    selected: input.selected
  };
}

function overview(value: unknown): NonNullable<KeywordResearchRunSummary["overview"]> {
  const input = boundedRecord(
    value,
    ["top1", "top3", "top5", "top10", "top50"],
    ["visibility", "pagesInIndex", "aiAnswers"]
  );
  return {
    top1: integer(input.top1, 0),
    top3: integer(input.top3, 0),
    top5: integer(input.top5, 0),
    top10: integer(input.top10, 0),
    top50: integer(input.top50, 0),
    ...(input.visibility === undefined ? {} : { visibility: number(input.visibility) }),
    ...(input.pagesInIndex === undefined ? {} : { pagesInIndex: integer(input.pagesInIndex, 0) }),
    ...(input.aiAnswers === undefined ? {} : { aiAnswers: integer(input.aiAnswers, 0) })
  };
}

function competitors(value: unknown): NonNullable<KeywordResearchRunSummary["competitors"]> {
  if (!Array.isArray(value) || value.length > 100) invalid();
  return value.map((item) => {
    const input = boundedRecord(
      item,
      ["domain", "commonKeywords"],
      ["similarity", "thematicity", "top10", "top50", "visibility"]
    );
    return {
      domain: bounded(input.domain, 253),
      commonKeywords: integer(input.commonKeywords, 0),
      ...(input.similarity === undefined ? {} : { similarity: number(input.similarity) }),
      ...(input.thematicity === undefined ? {} : { thematicity: number(input.thematicity) }),
      ...(input.top10 === undefined ? {} : { top10: integer(input.top10, 0) }),
      ...(input.top50 === undefined ? {} : { top50: integer(input.top50, 0) }),
      ...(input.visibility === undefined ? {} : { visibility: number(input.visibility) })
    };
  });
}

function bounded(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) invalid();
  return value;
}

function sourceColumn(value: unknown): "LEFT" | "RIGHT" {
  if (value !== "LEFT" && value !== "RIGHT") invalid();
  return value;
}

function boundedRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((field) => !(field in input)) ||
    Object.keys(input).some((field) => !allowed.has(field))
  ) {
    invalid();
  }
  return input;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    invalid();
  }
  return Number(value);
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalid();
  }
  return value;
}

function iso(value: unknown): string {
  if (typeof value !== "string") invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid();
  return value;
}

function code(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(value)) {
    invalid();
  }
  return value;
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs service returned an invalid keyword research response",
    retryable: true
  });
}
