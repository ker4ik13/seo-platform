import {
  semanticGroupColorLegendNoteMaxLength,
  semanticGroupPaletteColors,
  type SemanticGroupColorLegendEntry,
  type UpdateSemanticGroupColorLegendInput
} from "@seo-platform/contracts";
import { DomainError, validationError } from "../common/domain-error.js";

const palette = new Set<string>(semanticGroupPaletteColors);
const paletteOrder = new Map(
  semanticGroupPaletteColors.map((color, index) => [color, index])
);

export function updateSemanticGroupColorLegendInput(
  value: unknown
): UpdateSemanticGroupColorLegendInput {
  const input = exactRecord(value, ["entries"], "body");
  return { entries: entries(input.entries) };
}

export function markSemanticGroupColorLegendSeenInput(
  value: unknown
): Readonly<{ version: number }> {
  const input = exactRecord(value, ["version"], "body");
  return { version: nonNegativeInteger(input.version, "version") };
}

export function requiredSemanticGroupColorLegendVersion(
  value: string | undefined
): number {
  if (!value) {
    throw new DomainError({
      statusCode: 428,
      code: "VERSION_CONFLICT",
      message: "If-Match header is required"
    });
  }
  const match = /^(?:W\/)?"?v?(\d+)"?$/u.exec(value.trim());
  const version = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 0) {
    invalid("If-Match");
  }
  return version;
}

function entries(value: unknown): readonly SemanticGroupColorLegendEntry[] {
  if (
    !Array.isArray(value) ||
    value.length > semanticGroupPaletteColors.length
  ) {
    invalid("entries");
  }
  const result = value.map((entry, index) => {
    const item = exactRecord(entry, ["color", "note"], `entries[${index}]`);
    if (typeof item.color !== "string" || !palette.has(item.color)) {
      invalid(`entries[${index}].color`);
    }
    if (typeof item.note !== "string" || item.note.length > 2_000) {
      invalid(`entries[${index}].note`);
    }
    const note = item.note.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!note || note.length > semanticGroupColorLegendNoteMaxLength) {
      invalid(`entries[${index}].note`);
    }
    return {
      color: item.color as SemanticGroupColorLegendEntry["color"],
      note
    };
  });
  if (new Set(result.map(({ color }) => color)).size !== result.length) {
    invalid("entries");
  }
  return [...result].sort(
    (left, right) =>
      (paletteOrder.get(left.color) ?? 0) -
      (paletteOrder.get(right.color) ?? 0)
  );
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  field: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(field);
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid(field);
  return input;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(field);
  return Number(value);
}

function invalid(field: string): never {
  throw validationError(
    field,
    "INVALID_SEMANTIC_GROUP_COLOR_LEGEND",
    "Invalid semantic group color legend"
  );
}
