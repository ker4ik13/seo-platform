import {
  keysSoDatabases,
  keywordResearchStatuses,
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
      "provider",
      "domain",
      "database",
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
      "retryAt",
      "failureCode",
      "finishedAt"
    ]
  );
  const id = uuid(input.id);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    (expectedId !== undefined && id !== expectedId) ||
    input.provider !== "KEYS_SO" ||
    typeof input.domain !== "string" ||
    input.domain.length < 1 ||
    input.domain.length > 253 ||
    typeof input.database !== "string" ||
    !keysSoDatabases.includes(
      input.database as KeywordResearchRunSummary["database"]
    ) ||
    typeof input.status !== "string" ||
    !keywordResearchStatuses.includes(
      input.status as KeywordResearchRunSummary["status"]
    ) ||
    !Array.isArray(input.rows) ||
    input.rows.length > 500
  ) {
    invalid();
  }
  return {
    id,
    workspaceId,
    projectId,
    provider: "KEYS_SO",
    domain: input.domain,
    database: input.database as KeywordResearchRunSummary["database"],
    maxKeywords: integer(input.maxKeywords, 25, 500),
    status: input.status as KeywordResearchRunSummary["status"],
    ...(input.totalAvailable === undefined
      ? {}
      : { totalAvailable: integer(input.totalAvailable, 0) }),
    collectedKeywords: integer(input.collectedKeywords, 0, 500),
    selectedKeywords: integer(input.selectedKeywords, 0, 500),
    importedKeywords: integer(input.importedKeywords, 0, 500),
    rows: input.rows.map(row),
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

function row(value: unknown): KeywordResearchRow {
  const input = boundedRecord(
    value,
    ["id", "keyword", "selected"],
    [
      "url",
      "frequencyBase",
      "frequencyExact",
      "frequencyFixed",
      "position",
      "kei"
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
    selected: input.selected
  };
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
