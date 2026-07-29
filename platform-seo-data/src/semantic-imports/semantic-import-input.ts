import { BadRequestException } from "@nestjs/common";
import {
  semanticImportDuplicatePolicies,
  type InternalApplySemanticImportChunkInput,
  type InternalBeginSemanticImportInput,
  type InternalCompleteSemanticImportInput,
  type InternalNormalizeSemanticKeywordsInput,
  type SemanticImportDuplicatePolicy,
  type SemanticImportFrequencyValue,
  type SemanticImportPublishRow
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const INTEGER_PATTERN = /^(0|[1-9]\d*)$/u;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function normalizeSemanticKeywordsInput(
  value: unknown
): InternalNormalizeSemanticKeywordsInput {
  const input = record(value);
  const rows = array(input.rows, "rows");
  if (rows.length === 0 || rows.length > 500) invalid("rows");
  const parsedRows = rows.map((row, index) => {
    const item = record(row);
    return {
      rowNumber: positiveBigintString(
        item.rowNumber,
        `rows.${index}.rowNumber`
      ),
      text: boundedString(item.text, `rows.${index}.text`, 1_000_000),
      language: language(item.language, `rows.${index}.language`)
    };
  });
  if (new Set(parsedRows.map(({ rowNumber }) => rowNumber)).size !== rows.length) {
    invalid("rows.rowNumber");
  }
  return {
    ...context(input),
    importId: uuid(input.importId, "importId"),
    rows: parsedRows
  };
}

export function beginSemanticImportInput(
  value: unknown
): InternalBeginSemanticImportInput {
  const input = record(value);
  const expectedChunks = positiveInteger(input.expectedChunks, "expectedChunks");
  if (expectedChunks > 1_000_000) invalid("expectedChunks");
  return {
    ...context(input),
    importId: uuid(input.importId, "importId"),
    mappingHash: hash(input.mappingHash, "mappingHash"),
    duplicatePolicy: duplicatePolicy(input.duplicatePolicy),
    expectedChunks,
    expectedUniqueRows: positiveBigintString(
      input.expectedUniqueRows,
      "expectedUniqueRows"
    )
  };
}

export function applySemanticImportChunkInput(
  value: unknown
): InternalApplySemanticImportChunkInput {
  const input = record(value);
  const rows = array(input.rows, "rows");
  if (rows.length === 0 || rows.length > 500) invalid("rows");
  const parsedRows = rows.map((row, index) =>
    publishRow(row, `rows.${index}`)
  );
  const keys = parsedRows.map(
    ({ language: rowLanguage, normalizedHash }) =>
      `${rowLanguage}\u0000${normalizedHash}`
  );
  if (new Set(keys).size !== keys.length) invalid("rows.normalizedHash");
  return {
    ...context(input),
    importId: uuid(input.importId, "importId"),
    chunkIndex: nonNegativeInteger(input.chunkIndex, "chunkIndex"),
    payloadHash: hash(input.payloadHash, "payloadHash"),
    duplicatePolicy: duplicatePolicy(input.duplicatePolicy),
    rows: parsedRows
  };
}

export function completeSemanticImportInput(
  value: unknown
): InternalCompleteSemanticImportInput {
  const input = record(value);
  return {
    ...context(input),
    importId: uuid(input.importId, "importId"),
    ...(input.partial === undefined
      ? {}
      : { partial: boolean(input.partial, "partial") })
  };
}

function publishRow(value: unknown, path: string): SemanticImportPublishRow {
  const input = record(value);
  const groupPath =
    input.groupPath === undefined
      ? undefined
      : array(input.groupPath, `${path}.groupPath`).map((segment, index) =>
          boundedString(segment, `${path}.groupPath.${index}`, 255)
        );
  if (groupPath && (groupPath.length === 0 || groupPath.length > 10)) {
    invalid(`${path}.groupPath`);
  }
  const targetUrl =
    input.targetUrl === undefined
      ? undefined
      : webUrl(input.targetUrl, `${path}.targetUrl`);
  const frequencies =
    input.frequencies === undefined
      ? undefined
      : array(input.frequencies, `${path}.frequencies`).map(
          (frequency, index) =>
            frequencyValue(frequency, `${path}.frequencies.${index}`)
        );
  const observedAt =
    input.observedAt === undefined
      ? undefined
      : isoDate(input.observedAt, `${path}.observedAt`);
  const tags =
    input.tags === undefined
      ? undefined
      : array(input.tags, `${path}.tags`).map((tag, index) =>
          boundedString(tag, `${path}.tags.${index}`, 160)
        );
  if (tags && tags.length > 100) invalid(`${path}.tags`);
  const customValues = stringRecord(input.customValues, `${path}.customValues`);
  return {
    sourceRowNumber: positiveBigintString(
      input.sourceRowNumber,
      `${path}.sourceRowNumber`
    ),
    textOriginal: boundedString(
      input.textOriginal,
      `${path}.textOriginal`,
      1_000_000
    ),
    textNormalized: boundedString(
      input.textNormalized,
      `${path}.textNormalized`,
      1_000_000
    ),
    normalizedHash: hash(
      input.normalizedHash,
      `${path}.normalizedHash`
    ),
    language: language(input.language, `${path}.language`),
    ...(groupPath ? { groupPath } : {}),
    ...(targetUrl ? { targetUrl } : {}),
    ...(frequencies ? { frequencies } : {}),
    ...(observedAt ? { observedAt } : {}),
    ...(tags ? { tags } : {}),
    customValues
  };
}

function frequencyValue(
  value: unknown,
  path: string
): SemanticImportFrequencyValue {
  const input = record(value);
  if (!["BASE", "EXACT", "FIXED"].includes(String(input.type))) {
    invalid(`${path}.type`);
  }
  return {
    type: input.type as SemanticImportFrequencyValue["type"],
    value: bigintString(input.value, `${path}.value`)
  };
}

function context(
  input: Readonly<Record<string, unknown>>
): {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
} {
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId")
  };
}

function duplicatePolicy(value: unknown): SemanticImportDuplicatePolicy {
  if (
    typeof value !== "string" ||
    !semanticImportDuplicatePolicies.includes(
      value as SemanticImportDuplicatePolicy
    )
  ) {
    invalid("duplicatePolicy");
  }
  return value as SemanticImportDuplicatePolicy;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("A JSON object is required");
  }
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(path);
  return value;
}

function boundedString(value: unknown, path: string, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max
  ) {
    invalid(path);
  }
  return value.trim();
}

function integerString(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !INTEGER_PATTERN.test(value) ||
    BigInt(value) > POSTGRES_BIGINT_MAX
  ) {
    invalid(path);
  }
  return value;
}

function bigintString(value: unknown, path: string): string {
  return integerString(value, path);
}

function positiveBigintString(value: unknown, path: string): string {
  const result = integerString(value, path);
  if (result === "0") invalid(path);
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(path);
  return Number(value);
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path);
  return Number(value);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) invalid(path);
  return value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path);
  return internalUuid(value, path);
}

function language(value: unknown, path: string): string {
  const result = boundedString(value, path, 32);
  if (result !== "und" && !LANGUAGE_PATTERN.test(result)) invalid(path);
  return result;
}

function webUrl(value: unknown, path: string): string {
  const result = boundedString(value, path, 8_192);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    invalid(path);
  }
  if (!["http:", "https:"].includes(url.protocol)) invalid(path);
  return result;
}

function isoDate(value: unknown, path: string): string {
  const result = boundedString(value, path, 64);
  const date = new Date(result);
  if (Number.isNaN(date.getTime())) invalid(path);
  return date.toISOString();
}

function stringRecord(
  value: unknown,
  path: string
): Readonly<Record<string, string>> {
  const input = record(value);
  const entries = Object.entries(input);
  if (entries.length > 500) invalid(path);
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!key.trim() || key.length > 160 || typeof item !== "string") {
      invalid(path);
    }
    if (item.length > 1_000_000) invalid(`${path}.${key}`);
    result[key] = item;
  }
  return result;
}

function invalid(path: string): never {
  throw new BadRequestException(`Invalid field: ${path}`);
}
