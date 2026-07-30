import type {
  CreateSemanticKeywordGroupInput,
  UpdateSemanticKeywordGroupInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

export function createSemanticKeywordGroupInput(
  value: unknown
): CreateSemanticKeywordGroupInput {
  const input = exactRecord(value);
  const parentId = optionalParentId(input.parentId, false).parentId;
  const color = optionalColor(input.color, false).color;
  return {
    name: groupName(input.name),
    ...(parentId ? { parentId } : {}),
    ...(color ? { color } : {})
  };
}

export function updateSemanticKeywordGroupInput(
  value: unknown
): UpdateSemanticKeywordGroupInput {
  const input = exactRecord(value);
  return {
    name: groupName(input.name),
    ...optionalParentId(input.parentId, true),
    ...optionalColor(input.color, true)
  };
}

function exactRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$", "Must be a JSON object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).some(
      (key) => !["name", "parentId", "color"].includes(key)
    )
  ) {
    invalid("$", "Contains unsupported fields");
  }
  return input;
}

function groupName(value: unknown): string {
  if (typeof value !== "string") invalid("name", "Must be a string");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 255 || name.includes("/")) {
    invalid(
      "name",
      "Must contain 1 to 255 characters and cannot contain slash"
    );
  }
  return name;
}

function optionalParentId(
  value: unknown,
  nullable: boolean
): Readonly<{ parentId?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { parentId: null };
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid("parentId", "Must be a UUID");
  }
  return { parentId: value.toLowerCase() };
}

function optionalColor(
  value: unknown,
  nullable: boolean
): Readonly<{ color?: string | null }> {
  if (value === undefined) return {};
  if (value === null && nullable) return { color: null };
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) {
    invalid("color", "Must be a six-digit hex color");
  }
  return { color: value.toLowerCase() };
}

function invalid(path: string, message: string): never {
  throw validationError(path, "INVALID_SEMANTIC_GROUP", message);
}
