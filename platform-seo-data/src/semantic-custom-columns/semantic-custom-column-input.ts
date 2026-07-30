import { BadRequestException } from "@nestjs/common";
import {
  semanticCustomColumnTypes,
  type InternalCreateSemanticCustomColumnInput,
  type InternalDeleteSemanticCustomColumnInput,
  type InternalDeleteSemanticKeywordCustomValueInput,
  type InternalSetSemanticKeywordCustomValueInput,
  type InternalUpdateSemanticCustomColumnInput,
  type SemanticCustomColumnConfig,
  type SemanticCustomColumnOption,
  type SemanticCustomColumnType,
  type SemanticCustomColumnValueData
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const OPTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

export function internalCreateSemanticCustomColumnInput(
  value: unknown
): InternalCreateSemanticCustomColumnInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "name",
    "description",
    "type",
    "config"
  ]);
  const type = columnType(input.type);
  return {
    ...scope(input),
    name: columnName(input.name),
    ...optionalDescription(input.description, false),
    type,
    config: typeConfig(input.config, type)
  };
}

export function internalUpdateSemanticCustomColumnInput(
  value: unknown
): InternalUpdateSemanticCustomColumnInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "version",
    "name",
    "description",
    "config"
  ]);
  if (
    input.name === undefined &&
    input.description === undefined &&
    input.config === undefined
  ) {
    invalid("$");
  }
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
    ...(input.name === undefined ? {} : { name: columnName(input.name) }),
    ...optionalDescription(input.description, true),
    ...(input.config === undefined
      ? {}
      : { config: genericConfig(input.config) })
  };
}

export function internalDeleteSemanticCustomColumnInput(
  value: unknown
): InternalDeleteSemanticCustomColumnInput {
  const input = exactRecord(value, [...scopeFields(), "version"]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version")
  };
}

export function internalSetSemanticKeywordCustomValueInput(
  value: unknown
): InternalSetSemanticKeywordCustomValueInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "expectedVersion",
    "value"
  ]);
  return {
    ...scope(input),
    expectedVersion:
      input.expectedVersion === null
        ? null
        : positiveInteger(input.expectedVersion, "expectedVersion"),
    value: customValue(input.value)
  };
}

export function internalDeleteSemanticKeywordCustomValueInput(
  value: unknown
): InternalDeleteSemanticKeywordCustomValueInput {
  const input = exactRecord(value, [...scopeFields(), "version"]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version")
  };
}

export function typeConfig(
  value: unknown,
  type: SemanticCustomColumnType
): SemanticCustomColumnConfig {
  const config = genericConfig(value);
  const supportsOptions = ["SELECT", "MULTI_SELECT", "STATUS"].includes(type);
  if (supportsOptions && (!config.options || config.options.length === 0)) {
    invalid("config.options");
  }
  if (!supportsOptions && config.options !== undefined) {
    invalid("config.options");
  }
  return config;
}

function genericConfig(value: unknown): SemanticCustomColumnConfig {
  const input = exactRecord(value, ["required", "options"]);
  if (typeof input.required !== "boolean") invalid("config.required");
  return {
    required: input.required,
    ...(input.options === undefined
      ? {}
      : { options: columnOptions(input.options) })
  };
}

function columnOptions(value: unknown): readonly SemanticCustomColumnOption[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    invalid("config.options");
  }
  const options = value.map((item, index) => {
    const option = exactRecord(item, ["id", "label", "color"]);
    if (
      typeof option.id !== "string" ||
      !OPTION_ID_PATTERN.test(option.id) ||
      typeof option.label !== "string"
    ) {
      invalid(`config.options[${index}]`);
    }
    const label = option.label.normalize("NFKC").trim();
    if (!label || label.length > 160) invalid(`config.options[${index}]`);
    if (
      option.color !== undefined &&
      (typeof option.color !== "string" ||
        !COLOR_PATTERN.test(option.color))
    ) {
      invalid(`config.options[${index}].color`);
    }
    return {
      id: option.id,
      label,
      ...(typeof option.color === "string"
        ? { color: option.color.toLowerCase() }
        : {})
    };
  });
  if (new Set(options.map(({ id }) => id)).size !== options.length) {
    invalid("config.options");
  }
  return options;
}

function customValue(value: unknown): SemanticCustomColumnValueData {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 1_000_000
  ) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 100 &&
    value.every(
      (item) =>
        typeof item === "string" && item.length >= 1 && item.length <= 160
    ) &&
    new Set(value).size === value.length
  ) {
    return value as string[];
  }
  return invalid("value");
}

function scopeFields(): readonly string[] {
  return ["workspaceId", "projectId", "actorId"];
}

function scope(input: Readonly<Record<string, unknown>>) {
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId")
  };
}

function columnName(value: unknown): string {
  if (typeof value !== "string") invalid("name");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 160) invalid("name");
  return name;
}

function optionalDescription(
  value: unknown,
  nullable: false
): Readonly<{ description?: string }>;
function optionalDescription(
  value: unknown,
  nullable: true
): Readonly<{ description?: string | null }>;
function optionalDescription(
  value: unknown,
  nullable: boolean
): Readonly<{ description?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { description: null };
  if (typeof value !== "string") invalid("description");
  const description = value.normalize("NFKC").trim();
  if (description.length > 2000) invalid("description");
  return description ? { description } : nullable ? { description: null } : {};
}

function columnType(value: unknown): SemanticCustomColumnType {
  if (
    typeof value !== "string" ||
    !semanticCustomColumnTypes.some((type) => type === value)
  ) {
    invalid("type");
  }
  return value as SemanticCustomColumnType;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function exactRecord(
  value: unknown,
  allowed: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid("$");
  return input;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid semantic custom field: ${field}`);
}
