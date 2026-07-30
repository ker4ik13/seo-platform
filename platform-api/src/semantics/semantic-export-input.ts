import {
  semanticExportFormats,
  semanticExportLocales,
  semanticExportScopes,
  semanticKeywordIntents,
  semanticKeywordSorts,
  semanticSystemColumnKeys,
  type CreateSemanticExportInput,
  type SemanticExportFilters,
  type SemanticSavedViewColumnKey
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CUSTOM_COLUMN_PATTERN =
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createSemanticExportInput(
  value: unknown
): CreateSemanticExportInput {
  const input = exactRecord(
    value,
    [
      "format",
      "scope",
      "locale",
      "columns",
      "filters",
      "sort",
      "keywordIds",
      "includeBom"
    ],
    "$"
  );
  const scope = requiredEnum(input.scope, semanticExportScopes, "scope");
  const filters =
    input.filters === undefined
      ? undefined
      : exportFilters(input.filters);
  const keywordIds =
    input.keywordIds === undefined
      ? undefined
      : exportKeywordIds(input.keywordIds);

  if (
    (scope === "SELECTED" || scope === "CURRENT_PAGE") &&
    keywordIds === undefined
  ) {
    invalid("keywordIds", "Selected and current-page exports require IDs");
  }
  if (
    scope !== "SELECTED" &&
    scope !== "CURRENT_PAGE" &&
    keywordIds !== undefined
  ) {
    invalid("keywordIds", "IDs are not supported for this export scope");
  }
  if (scope === "GROUP_SUBTREE" && !filters?.groupId) {
    invalid(
      "filters.groupId",
      "Group subtree export requires a group identifier"
    );
  }
  if (scope === "FULL_CORE" && filters !== undefined) {
    invalid("filters", "Full-core export does not accept filters");
  }

  return {
    format: requiredEnum(input.format, semanticExportFormats, "format"),
    scope,
    locale: requiredEnum(input.locale, semanticExportLocales, "locale"),
    columns: exportColumns(input.columns),
    ...(filters ? { filters } : {}),
    ...(input.sort === undefined
      ? {}
      : {
          sort: requiredEnum(input.sort, semanticKeywordSorts, "sort")
        }),
    ...(keywordIds ? { keywordIds } : {}),
    ...(input.includeBom === undefined
      ? {}
      : { includeBom: requiredBoolean(input.includeBom, "includeBom") })
  };
}

function exportFilters(value: unknown): SemanticExportFilters {
  const input = exactRecord(
    value,
    [
      "search",
      "intent",
      "groupId",
      "isFavorite",
      "isTracked",
      "priorityMin",
      "priorityMax"
    ],
    "filters"
  );
  const search = optionalString(input.search, "filters.search", 200);
  const intent =
    input.intent === undefined
      ? undefined
      : requiredEnum(input.intent, semanticKeywordIntents, "filters.intent");
  const groupId = optionalUuid(input.groupId, "filters.groupId");
  const isFavorite = optionalBoolean(
    input.isFavorite,
    "filters.isFavorite"
  );
  const isTracked = optionalBoolean(input.isTracked, "filters.isTracked");
  const priorityMin = optionalPriority(
    input.priorityMin,
    "filters.priorityMin"
  );
  const priorityMax = optionalPriority(
    input.priorityMax,
    "filters.priorityMax"
  );
  if (
    priorityMin !== undefined &&
    priorityMax !== undefined &&
    priorityMin > priorityMax
  ) {
    invalid(
      "filters.priorityMin",
      "Must not be greater than priorityMax"
    );
  }
  return {
    ...(search ? { search } : {}),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(isFavorite === undefined ? {} : { isFavorite }),
    ...(isTracked === undefined ? {} : { isTracked }),
    ...(priorityMin === undefined ? {} : { priorityMin }),
    ...(priorityMax === undefined ? {} : { priorityMax })
  };
}

function exportColumns(
  value: unknown
): readonly SemanticSavedViewColumnKey[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 108) {
    invalid("columns", "Must contain 1 to 108 columns");
  }
  const columns = value.map((column, index) => {
    if (
      typeof column !== "string" ||
      (!semanticSystemColumnKeys.includes(
        column as (typeof semanticSystemColumnKeys)[number]
      ) &&
        !CUSTOM_COLUMN_PATTERN.test(column))
    ) {
      invalid(`columns[${index}]`, "Must be a known column key");
    }
    return column as SemanticSavedViewColumnKey;
  });
  if (new Set(columns).size !== columns.length) {
    invalid("columns", "Columns must be unique");
  }
  return columns;
}

function exportKeywordIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) {
    invalid("keywordIds", "Must contain 1 to 200 keyword IDs");
  }
  const ids = value.map((item, index) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      invalid(`keywordIds[${index}]`, "Must be a UUID");
    }
    return item.toLowerCase();
  });
  if (new Set(ids).size !== ids.length) {
    invalid("keywordIds", "Keyword IDs must be unique");
  }
  return ids;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(field, "Must be a string");
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > maxLength) {
    invalid(field, `Must contain at most ${maxLength} characters`);
  }
  return normalized || undefined;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid(field, "Must be a UUID");
  }
  return value.toLowerCase();
}

function optionalBoolean(
  value: unknown,
  field: string
): boolean | undefined {
  if (value === undefined) return undefined;
  return requiredBoolean(value, field);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field, "Must be a boolean");
  return value;
}

function optionalPriority(
  value: unknown,
  field: string
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100) {
    invalid(field, "Must be an integer between 0 and 100");
  }
  return Number(value);
}

function requiredEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    invalid(field, `Must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  field: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(field, "Must be a JSON object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    invalid(field, "Contains unsupported fields");
  }
  return input;
}

function invalid(path: string, message: string): never {
  throw validationError(path, "INVALID_SEMANTIC_EXPORT", message);
}
