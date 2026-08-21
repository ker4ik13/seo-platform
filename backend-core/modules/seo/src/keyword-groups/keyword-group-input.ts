import { BadRequestException } from "@nestjs/common";
import type {
  InternalCreateSemanticKeywordGroupInput,
  InternalDeleteSemanticKeywordGroupInput,
  InternalDuplicateSemanticKeywordGroupInput,
  InternalUpdateSemanticKeywordGroupInput
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";
import { semanticCapacityEntitlement } from "../internal/semantic-capacity.js";

const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

export function internalCreateSemanticKeywordGroupInput(
  value: unknown
): InternalCreateSemanticKeywordGroupInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "entitlement",
    "name",
    "parentId",
    "color",
    "position"
  ]);
  const parentId = optionalUuid(input.parentId, "parentId", false);
  const color = optionalColor(input.color, false);
  return {
    ...scope(input),
    entitlement: semanticCapacityEntitlement(input.entitlement),
    name: groupName(input.name),
    ...(parentId ? { parentId } : {}),
    ...(color ? { color } : {}),
    ...optionalPosition(input.position)
  };
}

export function internalDuplicateSemanticKeywordGroupInput(
  value: unknown
): InternalDuplicateSemanticKeywordGroupInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "version",
    "name",
    "parentId",
    "color",
    "includeDescendants",
    "includeKeywords"
  ]);
  const parentId = optionalUuid(input.parentId, "parentId", false);
  const color = optionalColor(input.color, false);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
    name: groupName(input.name),
    ...(parentId ? { parentId } : {}),
    ...(color ? { color } : {}),
    includeDescendants: booleanValue(
      input.includeDescendants,
      "includeDescendants"
    ),
    includeKeywords: booleanValue(input.includeKeywords, "includeKeywords")
  };
}

export function internalUpdateSemanticKeywordGroupInput(
  value: unknown
): InternalUpdateSemanticKeywordGroupInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "version",
    "name",
    "parentId",
    "color",
    "position"
  ]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
    name: groupName(input.name),
    ...nullableUuid(input.parentId, "parentId"),
    ...nullableColor(input.color),
    ...optionalPosition(input.position)
  };
}

function optionalPosition(
  value: unknown
): Readonly<{ position?: number }> {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid("position");
  }
  return { position: Number(value) };
}

export function internalDeleteSemanticKeywordGroupInput(
  value: unknown
): InternalDeleteSemanticKeywordGroupInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "version",
    "deleteKeywords",
    "promoteChildren"
  ]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
    deleteKeywords:
      input.deleteKeywords === undefined
        ? false
        : booleanValue(input.deleteKeywords, "deleteKeywords"),
    promoteChildren:
      input.promoteChildren === undefined
        ? false
        : booleanValue(input.promoteChildren, "promoteChildren")
  };
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

function groupName(value: unknown): string {
  if (typeof value !== "string") invalid("name");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 255 || name.includes("/")) invalid("name");
  return name;
}

function optionalUuid(
  value: unknown,
  field: string,
  nullable: boolean
): string | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return undefined;
  return uuid(value, field);
}

function nullableUuid(
  value: unknown,
  field: string
): Readonly<{ parentId?: string | null }> {
  if (value === undefined) return {};
  if (value === null) return { parentId: null };
  return { parentId: uuid(value, field) };
}

function optionalColor(
  value: unknown,
  nullable: boolean
): string | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return undefined;
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) invalid("color");
  return value.toLowerCase();
}

function nullableColor(
  value: unknown
): Readonly<{ color?: string | null }> {
  if (value === undefined) return {};
  if (value === null) return { color: null };
  const color = optionalColor(value, false);
  return color ? { color } : {};
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
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
  throw new BadRequestException(`Invalid semantic group field: ${field}`);
}
