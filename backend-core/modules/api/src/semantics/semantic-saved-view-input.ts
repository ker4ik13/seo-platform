import {
  semanticKeywordIntents,
  semanticKeywordPageSizes,
  semanticKeywordSorts,
  semanticSavedViewDensities,
  semanticSavedViewGroupSidebarWidthMax,
  semanticSavedViewGroupSidebarWidthMin,
  semanticSavedViewScopes,
  semanticSystemColumnKeys,
  type CreateSemanticSavedViewInput,
  type SemanticSavedViewConfig,
  type SemanticSavedViewFilters,
  type UpdateSemanticSavedViewInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createSemanticSavedViewInput(
  value: unknown
): CreateSemanticSavedViewInput {
  const input = exactRecord(value, ["name", "scope", "config"], "$");
  return {
    name: viewName(input.name),
    scope: requiredEnum(
      input.scope,
      semanticSavedViewScopes,
      "scope"
    ),
    config: savedViewConfig(input.config)
  };
}

export function updateSemanticSavedViewInput(
  value: unknown
): UpdateSemanticSavedViewInput {
  const input = exactRecord(value, ["name", "config"], "$");
  if (input.name === undefined && input.config === undefined) {
    invalid("$", "At least one field is required");
  }
  return {
    ...(input.name === undefined ? {} : { name: viewName(input.name) }),
    ...(input.config === undefined
      ? {}
      : { config: savedViewConfig(input.config) })
  };
}

export function savedViewConfig(value: unknown): SemanticSavedViewConfig {
  const input = exactRecord(
    value,
    [
      "schemaVersion",
      "filters",
      "sort",
      "columns",
      "density",
      "columnWidths",
      "pageSize",
      "groupSidebarWidth",
      "expandedGroupIds",
      "selectedGroupIds",
      "appliedViewId"
    ],
    "config"
  );
  if (input.schemaVersion !== 1) {
    invalid("config.schemaVersion", "Only schema version 1 is supported");
  }
  const columns = requiredColumns(input.columns);
  const columnWidths = optionalColumnWidths(input.columnWidths, columns);
  const pageSize = input.pageSize === undefined
    ? undefined
    : requiredNumberMember(input.pageSize, semanticKeywordPageSizes, "config.pageSize");
  const groupSidebarWidth = optionalInteger(
    input.groupSidebarWidth,
    "config.groupSidebarWidth",
    semanticSavedViewGroupSidebarWidthMin,
    semanticSavedViewGroupSidebarWidthMax
  );
  const expandedGroupIds = optionalUuidArray(
    input.expandedGroupIds,
    "config.expandedGroupIds",
    1_000
  );
  const selectedGroupIds = optionalUuidArray(
    input.selectedGroupIds,
    "config.selectedGroupIds",
    100
  );
  const appliedViewId = optionalUuid(
    input.appliedViewId,
    "config.appliedViewId"
  );
  return {
    schemaVersion: 1,
    filters: savedViewFilters(input.filters),
    sort: requiredEnum(input.sort, semanticKeywordSorts, "config.sort"),
    columns,
    density: requiredEnum(
      input.density,
      semanticSavedViewDensities,
      "config.density"
    ),
    ...(columnWidths ? { columnWidths } : {}),
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(groupSidebarWidth === undefined ? {} : { groupSidebarWidth }),
    ...(expandedGroupIds ? { expandedGroupIds } : {}),
    ...(selectedGroupIds ? { selectedGroupIds } : {}),
    ...(appliedViewId ? { appliedViewId } : {})
  };
}

function savedViewFilters(value: unknown): SemanticSavedViewFilters {
  const input = exactRecord(
    value,
    [
      "search",
      "tag",
      "intent",
      "groupId",
      "clusterId",
      "isFavorite",
      "isTracked",
      "priorityMin",
      "priorityMax"
    ],
    "config.filters"
  );
  const search = optionalString(input.search, "search", 200);
  const tag = optionalString(input.tag, "config.filters.tag", 160)
    ?.toLocaleLowerCase();
  const intent =
    input.intent === undefined
      ? undefined
      : requiredEnum(
          input.intent,
          semanticKeywordIntents,
          "config.filters.intent"
        );
  const groupId = optionalUuid(input.groupId, "config.filters.groupId");
  const clusterId = optionalUuid(input.clusterId, "config.filters.clusterId");
  const isFavorite = optionalBoolean(
    input.isFavorite,
    "config.filters.isFavorite"
  );
  const isTracked = optionalBoolean(
    input.isTracked,
    "config.filters.isTracked"
  );
  const priorityMin = optionalPriority(
    input.priorityMin,
    "config.filters.priorityMin"
  );
  const priorityMax = optionalPriority(
    input.priorityMax,
    "config.filters.priorityMax"
  );
  if (
    priorityMin !== undefined &&
    priorityMax !== undefined &&
    priorityMin > priorityMax
  ) {
    invalid(
      "config.filters.priorityMin",
      "Must not be greater than priorityMax"
    );
  }
  return {
    ...(search ? { search } : {}),
    ...(tag ? { tag } : {}),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(isFavorite === undefined ? {} : { isFavorite }),
    ...(isTracked === undefined ? {} : { isTracked }),
    ...(priorityMin === undefined ? {} : { priorityMin }),
    ...(priorityMax === undefined ? {} : { priorityMax })
  };
}

function requiredColumns(
  value: unknown
): SemanticSavedViewConfig["columns"] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 128
  ) {
    invalid("config.columns", "Must contain 1 to 128 columns");
  }
  const columns = value.map((column, index) => {
    if (
      typeof column !== "string" ||
      (!semanticSystemColumnKeys.includes(
        column as (typeof semanticSystemColumnKeys)[number]
      ) &&
        !/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          column
        ))
    ) {
      invalid(`config.columns[${index}]`, "Must be a known column key");
    }
    return column as SemanticSavedViewConfig["columns"][number];
  });
  if (new Set(columns).size !== columns.length || !columns.includes("query")) {
    invalid(
      "config.columns",
      "Columns must be unique and include the query column"
    );
  }
  return columns;
}

function optionalColumnWidths(
  value: unknown,
  columns: SemanticSavedViewConfig["columns"]
): SemanticSavedViewConfig["columnWidths"] | undefined {
  if (value === undefined) return undefined;
  const input = exactRecord(value, columns, "config.columnWidths");
  const entries = Object.entries(input);
  if (entries.length > columns.length) invalid("config.columnWidths", "Too many widths");
  const result: Record<string, number> = {};
  for (const [key, width] of entries) {
    if (!Number.isSafeInteger(width) || Number(width) < 56 || Number(width) > 1_200) {
      invalid(`config.columnWidths.${key}`, "Must be an integer between 56 and 1200");
    }
    result[key] = Number(width);
  }
  return result as SemanticSavedViewConfig["columnWidths"];
}

function optionalUuidArray(
  value: unknown,
  field: string,
  maximum: number
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(field, `Must contain at most ${maximum} identifiers`);
  }
  const values = value.map((item, index) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      invalid(`${field}[${index}]`, "Must be a UUID");
    }
    return item.toLowerCase();
  });
  if (new Set(values).size !== values.length) invalid(field, "Must be unique");
  return values;
}

function viewName(value: unknown): string {
  if (typeof value !== "string") invalid("name", "Must be a string");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 160) {
    invalid("name", "Must contain 1 to 160 characters");
  }
  return name;
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

function optionalInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    invalid(field, `Must be an integer between ${minimum} and ${maximum}`);
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

function requiredNumberMember<T extends number>(
  value: unknown,
  values: readonly T[],
  field: string
): T {
  if (typeof value !== "number" || !values.includes(value as T)) {
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
  throw validationError(path, "INVALID_SAVED_VIEW", message);
}
