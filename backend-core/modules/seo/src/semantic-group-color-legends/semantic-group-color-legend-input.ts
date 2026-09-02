import { BadRequestException } from "@nestjs/common";
import {
  semanticGroupColorLegendNoteMaxLength,
  semanticGroupPaletteColors,
  type InternalMarkSemanticGroupColorLegendSeenInput,
  type InternalUpdateSemanticGroupColorLegendInput,
  type SemanticGroupColorLegendEntry
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const palette = new Set<string>(semanticGroupPaletteColors);
const paletteOrder = new Map(
  semanticGroupPaletteColors.map((color, index) => [color, index])
);

export function internalUpdateSemanticGroupColorLegendInput(
  value: unknown
): InternalUpdateSemanticGroupColorLegendInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "canManage",
    "version",
    "entries"
  ]);
  return {
    ...scope(input),
    canManage: booleanValue(input.canManage, "canManage"),
    version: nonNegativeInteger(input.version, "version"),
    entries: semanticGroupColorLegendEntries(input.entries)
  };
}

export function internalMarkSemanticGroupColorLegendSeenInput(
  value: unknown
): InternalMarkSemanticGroupColorLegendSeenInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return {
    ...scope(input),
    version: nonNegativeInteger(input.version, "version")
  };
}

export function semanticGroupColorLegendEntries(
  value: unknown
): readonly SemanticGroupColorLegendEntry[] {
  if (
    !Array.isArray(value) ||
    value.length > semanticGroupPaletteColors.length
  ) {
    invalid("entries");
  }
  const entries = value.map((entry, index) => {
    const item = exactRecord(entry, ["color", "note"], `entries[${index}]`);
    if (typeof item.color !== "string" || !palette.has(item.color)) {
      invalid(`entries[${index}].color`);
    }
    const note = normalizedNote(item.note, `entries[${index}].note`);
    return {
      color: item.color as SemanticGroupColorLegendEntry["color"],
      note
    };
  });
  if (new Set(entries.map(({ color }) => color)).size !== entries.length) {
    invalid("entries");
  }
  return [...entries].sort(
    (left, right) =>
      (paletteOrder.get(left.color) ?? 0) -
      (paletteOrder.get(right.color) ?? 0)
  );
}

function scope(input: Readonly<Record<string, unknown>>) {
  return {
    workspaceId: internalUuid(requiredString(input.workspaceId, "workspaceId"), "workspaceId"),
    projectId: internalUuid(requiredString(input.projectId, "projectId"), "projectId"),
    actorId: internalUuid(requiredString(input.actorId, "actorId"), "actorId")
  };
}

function normalizedNote(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 2_000) invalid(field);
  const note = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!note || note.length > semanticGroupColorLegendNoteMaxLength) {
    invalid(field);
  }
  return note;
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  field = "body"
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(field);
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid(field);
  return input;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(field);
  return Number(value);
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid semantic group color legend field: ${field}`);
}
