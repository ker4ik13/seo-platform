import { BadRequestException } from "@nestjs/common";
import {
  arsenkinWordstatExpansionResultLimit,
  arsenkinWordstatExpansionSeedLimit,
  keywordResearchRowPageDefaultSize,
  keywordResearchRowPageMaxSize,
  keysSoDatabases,
  semanticImportDuplicatePolicies,
  wordstatImportDistributionModes,
  wordstatExpansionDevices,
  type ConfirmKeywordResearchRunInput,
  type CreateKeywordResearchRunInput,
  type KeysSoDatabase,
  type SemanticImportDuplicatePolicy,
  type WordstatExpansionDevice
} from "@seo-platform/contracts";

const HOST_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

export function keywordResearchRowsQuery(
  cursor: unknown,
  limit: unknown
): Readonly<{ cursor?: number; limit: number }> {
  const parsedCursor = cursor === undefined
    ? undefined
    : queryInteger(cursor, "cursor", 1, arsenkinWordstatExpansionResultLimit);
  return {
    ...(parsedCursor === undefined ? {} : { cursor: parsedCursor }),
    limit: limit === undefined
      ? keywordResearchRowPageDefaultSize
      : queryInteger(limit, "limit", 1, keywordResearchRowPageMaxSize)
  };
}

export function createKeywordResearchRunInput(
  value: unknown
): CreateKeywordResearchRunInput {
  const source = sourceOf(value);
  if (source !== "KEYS_SO") {
    const raw = value as Readonly<Record<string, unknown>>;
    const input = exact(value, [
      "source",
      ...(Object.hasOwn(raw, "credentialId") ? ["credentialId"] : []),
      "queries",
      "regionCode",
      "device",
      "minusWords",
      "clearMinusPhrases",
      "includeRightColumn",
      "clearPlus",
      "maxKeywords"
    ]);
    return {
      source,
      ...(input.credentialId === undefined
        ? {}
        : { credentialId: uuid(input.credentialId, "credentialId") }),
      queries: phrases(
        input.queries,
        "queries",
        arsenkinWordstatExpansionSeedLimit,
        400
      ),
      regionCode: regionCode(input.regionCode),
      device: wordstatDevice(input.device),
      minusWords: phrases(input.minusWords, "minusWords", 100, 100, true),
      clearMinusPhrases: boolean(input.clearMinusPhrases, "clearMinusPhrases"),
      includeRightColumn: boolean(input.includeRightColumn, "includeRightColumn"),
      clearPlus: boolean(input.clearPlus, "clearPlus"),
      maxKeywords: integer(
        input.maxKeywords,
        "maxKeywords",
        1,
        arsenkinWordstatExpansionResultLimit
      )
    };
  }
  const raw = value as Readonly<Record<string, unknown>>;
  const input = exact(value, [
    ...(sourceOf(value, true) === undefined ? [] : ["source"]),
    ...(Object.hasOwn(raw, "credentialId") ? ["credentialId"] : []),
    "domain",
    "database",
    "maxKeywords"
  ]);
  return {
    source: "KEYS_SO",
    ...(input.credentialId === undefined
      ? {}
      : { credentialId: uuid(input.credentialId, "credentialId") }),
    domain: domain(input.domain),
    database: database(input.database),
    maxKeywords: integer(input.maxKeywords, "maxKeywords", 25, 500)
  };
}

export function confirmKeywordResearchRunInput(
  value: unknown
): ConfirmKeywordResearchRunInput {
  const input = allowed(value, [
    "selectionMode",
    "selectedRowIds",
    "excludedRowIds",
    "duplicatePolicy",
    "targetGroupPath",
    "rowDestinations",
    "distributionMode"
  ]);
  const selectionMode =
    input.selectionMode === undefined
      ? "SELECTED"
      : choice(input.selectionMode, "selectionMode", ["ALL", "SELECTED"] as const);
  const selectedRowIds = optionalIds(input.selectedRowIds, "selectedRowIds");
  const excludedRowIds = optionalIds(input.excludedRowIds, "excludedRowIds");
  if (selectionMode === "SELECTED" && selectedRowIds.length < 1) {
    invalid("selectedRowIds");
  }
  if (selectionMode === "ALL" && selectedRowIds.length > 0) {
    invalid("selectedRowIds");
  }
  if (selectionMode === "SELECTED" && excludedRowIds.length > 0) {
    invalid("excludedRowIds");
  }
  const targetGroupPath = optionalBounded(
    input.targetGroupPath,
    "targetGroupPath",
    2_048
  );
  const rowDestinations = optionalRowDestinations(input.rowDestinations);
  const distributionMode = input.distributionMode === undefined
    ? "SINGLE_GROUP"
    : choice(
        input.distributionMode,
        "distributionMode",
        wordstatImportDistributionModes
      );
  if (
    selectionMode === "SELECTED" &&
    rowDestinations.some(({ rowId }) => !selectedRowIds.includes(rowId))
  ) {
    invalid("rowDestinations");
  }
  if (
    selectionMode === "ALL" &&
    rowDestinations.some(({ rowId }) => excludedRowIds.includes(rowId))
  ) {
    invalid("rowDestinations");
  }
  return {
    selectionMode,
    ...(selectedRowIds.length > 0 ? { selectedRowIds } : {}),
    ...(excludedRowIds.length > 0 ? { excludedRowIds } : {}),
    duplicatePolicy: duplicatePolicy(input.duplicatePolicy),
    ...(targetGroupPath ? { targetGroupPath } : {}),
    ...(rowDestinations.length > 0 ? { rowDestinations } : {}),
    distributionMode
  };
}

function optionalRowDestinations(
  value: unknown
): NonNullable<ConfirmKeywordResearchRunInput["rowDestinations"]> {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > arsenkinWordstatExpansionResultLimit
  ) {
    invalid("rowDestinations");
  }
  const destinations = value.map((item, index) => {
    const input = exact(item, ["rowId", "targetGroupPath"]);
    return {
      rowId: uuid(input.rowId, `rowDestinations.${index}.rowId`),
      targetGroupPath: requiredBounded(
        input.targetGroupPath,
        `rowDestinations.${index}.targetGroupPath`,
        2_048
      )
    };
  });
  if (new Set(destinations.map(({ rowId }) => rowId)).size !== destinations.length) {
    invalid("rowDestinations");
  }
  return destinations;
}

function optionalIds(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > arsenkinWordstatExpansionResultLimit) {
    invalid(field);
  }
  const ids = value.map((item, index) => {
    return uuid(item, `${field}.${index}`);
  });
  if (new Set(ids).size !== ids.length) {
    invalid(field);
  }
  return ids;
}

function uuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    invalid(field);
  }
  return value.toLowerCase();
}

function requiredBounded(value: unknown, field: string, max: number): string {
  const normalized = optionalBounded(value, field, max);
  if (!normalized) invalid(field);
  return normalized;
}

export function assertEmptyKeywordResearchCancelInput(value: unknown): void {
  exact(value, []);
}

function domain(value: unknown): string {
  if (typeof value !== "string") invalid("domain");
  let normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  try {
    if (normalized.includes("://")) {
      const url = new URL(normalized);
      if (
        url.username ||
        url.password ||
        url.port ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      ) {
        invalid("domain");
      }
      normalized = url.hostname;
    }
  } catch {
    invalid("domain");
  }
  if (normalized.length > 253 || !HOST_PATTERN.test(normalized)) {
    invalid("domain");
  }
  return normalized;
}

function database(value: unknown): KeysSoDatabase {
  if (
    typeof value !== "string" ||
    !keysSoDatabases.includes(value as KeysSoDatabase)
  ) {
    invalid("database");
  }
  return value as KeysSoDatabase;
}

function sourceOf(value: unknown): CreateKeywordResearchRunInput["source"];
function sourceOf(
  value: unknown,
  optional: true
): CreateKeywordResearchRunInput["source"] | undefined;
function sourceOf(
  value: unknown,
  optional = false
): CreateKeywordResearchRunInput["source"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const source = (value as Readonly<Record<string, unknown>>).source;
  if (source === undefined && optional) return undefined;
  if (source === undefined) return "KEYS_SO";
  return choice(
    source,
    "source",
    ["KEYS_SO", "ARSENKIN_WORDSTAT", "XMLSTOCK_WORDSTAT"] as const
  );
}

function wordstatDevice(value: unknown): WordstatExpansionDevice {
  return choice(value, "device", wordstatExpansionDevices);
}

function regionCode(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,10}$/u.test(value)) {
    invalid("regionCode");
  }
  return value;
}

function phrases(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
  allowEmpty = false
): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length < 1) || value.length > maxItems) {
    invalid(field);
  }
  const result = value.map((item, index) => {
    if (typeof item !== "string") invalid(`${field}.${index}`);
    const normalized = item.trim().replace(/\s+/gu, " ");
    if (!normalized || normalized.length > maxLength) invalid(`${field}.${index}`);
    return normalized;
  });
  if (new Set(result.map((item) => item.toLocaleLowerCase("ru-RU"))).size !== result.length) {
    invalid(field);
  }
  return result;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function choice<const T extends readonly string[]>(
  value: unknown,
  field: string,
  choices: T
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) invalid(field);
  return value as T[number];
}

function duplicatePolicy(value: unknown): SemanticImportDuplicatePolicy {
  return choice(value, "duplicatePolicy", semanticImportDuplicatePolicies);
}

function optionalBounded(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim().replace(/\s*\/\s*/gu, " / ");
  if (!normalized || normalized.length > max) invalid(field);
  return normalized;
}

function integer(
  value: unknown,
  field: string,
  min: number,
  max: number
): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    invalid(field);
  }
  return Number(value);
}

function queryInteger(
  value: unknown,
  field: string,
  min: number,
  max: number
): number {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) invalid(field);
  return integer(Number(value), field, min, max);
}

function exact(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !fields.includes(field))
  ) {
    invalid("body");
  }
  return input;
}

function allowed(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((field) => !fields.includes(field))) {
    invalid("body");
  }
  return input;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid keyword research field: ${field}`);
}
