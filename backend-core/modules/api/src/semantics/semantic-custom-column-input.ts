import {
  semanticCustomColumnTypes,
  type CreateSemanticCustomColumnInput,
  type SemanticCustomColumnConfig,
  type SemanticCustomColumnOption,
  type SemanticCustomColumnValueData,
  type SetSemanticKeywordCustomValueInput,
  type UpdateSemanticCustomColumnInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const OPTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

export function createSemanticCustomColumnInput(
  value: unknown
): CreateSemanticCustomColumnInput {
  const input = exactRecord(
    value,
    ["name", "description", "type", "config"],
    "$"
  );
  const type = requiredType(input.type);
  return {
    name: columnName(input.name),
    ...optionalDescription(input.description, false),
    type,
    config: columnConfig(input.config, type)
  };
}

export function updateSemanticCustomColumnInput(
  value: unknown
): UpdateSemanticCustomColumnInput {
  const input = exactRecord(
    value,
    ["name", "description", "config"],
    "$"
  );
  if (
    input.name === undefined &&
    input.description === undefined &&
    input.config === undefined
  ) {
    invalid("$", "At least one field is required");
  }
  return {
    ...(input.name === undefined ? {} : { name: columnName(input.name) }),
    ...optionalDescription(input.description, true),
    ...(input.config === undefined
      ? {}
      : { config: genericColumnConfig(input.config) })
  };
}

export function setSemanticKeywordCustomValueInput(
  value: unknown
): SetSemanticKeywordCustomValueInput {
  const input = exactRecord(value, ["expectedVersion", "value"], "$");
  const expectedVersion =
    input.expectedVersion === null
      ? null
      : positiveInteger(input.expectedVersion, "expectedVersion");
  return {
    expectedVersion,
    value: customValue(input.value)
  };
}

function genericColumnConfig(value: unknown): SemanticCustomColumnConfig {
  const input = exactRecord(value, ["required", "options"], "config");
  if (typeof input.required !== "boolean") {
    invalid("config.required", "Must be a boolean");
  }
  return {
    required: input.required,
    ...(input.options === undefined
      ? {}
      : { options: columnOptions(input.options) })
  };
}

function columnConfig(
  value: unknown,
  type: CreateSemanticCustomColumnInput["type"]
): SemanticCustomColumnConfig {
  const config = genericColumnConfig(value);
  const supportsOptions = ["SELECT", "MULTI_SELECT", "STATUS"].includes(type);
  if (supportsOptions && (!config.options || config.options.length === 0)) {
    invalid("config.options", "This column type requires options");
  }
  if (!supportsOptions && config.options !== undefined) {
    invalid("config.options", "This column type does not support options");
  }
  return config;
}

function columnOptions(value: unknown): readonly SemanticCustomColumnOption[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    invalid("config.options", "Must contain 1 to 100 options");
  }
  const options = value.map((item, index) => {
    const option = exactRecord(
      item,
      ["id", "label", "color"],
      `config.options[${index}]`
    );
    if (
      typeof option.id !== "string" ||
      !OPTION_ID_PATTERN.test(option.id)
    ) {
      invalid(`config.options[${index}].id`, "Must be a stable option ID");
    }
    if (typeof option.label !== "string") {
      invalid(`config.options[${index}].label`, "Must be a string");
    }
    const label = option.label.normalize("NFKC").trim();
    if (!label || label.length > 160) {
      invalid(
        `config.options[${index}].label`,
        "Must contain 1 to 160 characters"
      );
    }
    if (
      option.color !== undefined &&
      (typeof option.color !== "string" ||
        !COLOR_PATTERN.test(option.color))
    ) {
      invalid(
        `config.options[${index}].color`,
        "Must be a six-digit hex color"
      );
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
    invalid("config.options", "Option IDs must be unique");
  }
  return options;
}

function customValue(value: unknown): SemanticCustomColumnValueData {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      invalid("value", "Numeric values must be safe integers");
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length < 1 || value.length > 1_000_000) {
      invalid("value", "Must contain 1 to 1000000 characters");
    }
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
  return invalid("value", "Unsupported custom column value");
}

function requiredType(
  value: unknown
): CreateSemanticCustomColumnInput["type"] {
  if (
    typeof value !== "string" ||
    !semanticCustomColumnTypes.some((type) => type === value)
  ) {
    invalid(
      "type",
      `Must be one of: ${semanticCustomColumnTypes.join(", ")}`
    );
  }
  return value as CreateSemanticCustomColumnInput["type"];
}

function columnName(value: unknown): string {
  if (typeof value !== "string") invalid("name", "Must be a string");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 160) {
    invalid("name", "Must contain 1 to 160 characters");
  }
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
  if (typeof value !== "string") {
    invalid("description", "Must be a string");
  }
  const description = value.normalize("NFKC").trim();
  if (description.length > 2000) {
    invalid("description", "Must contain at most 2000 characters");
  }
  return description ? { description } : nullable ? { description: null } : {};
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalid(field, "Must be a positive integer");
  }
  return Number(value);
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
  throw validationError(path, "INVALID_CUSTOM_COLUMN", message);
}
