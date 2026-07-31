import { BadRequestException } from "@nestjs/common";
import type {
  InternalCreateSemanticClusterInput,
  InternalDeleteSemanticClusterInput,
  InternalUpdateSemanticClusterInput
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

export function internalCreateSemanticClusterInput(
  value: unknown
): InternalCreateSemanticClusterInput {
  const input = exactRecord(value, [...scopeFields(), "name"]);
  return { ...scope(input), name: clusterName(input.name) };
}

export function internalUpdateSemanticClusterInput(
  value: unknown
): InternalUpdateSemanticClusterInput {
  const input = exactRecord(value, [...scopeFields(), "version", "name"]);
  return {
    ...scope(input),
    name: clusterName(input.name),
    version: positiveInteger(input.version, "version")
  };
}

export function internalDeleteSemanticClusterInput(
  value: unknown
): InternalDeleteSemanticClusterInput {
  const input = exactRecord(value, [...scopeFields(), "version"]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version")
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

function clusterName(value: unknown): string {
  if (typeof value !== "string") invalid("name");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 255) invalid("name");
  return name;
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
  throw new BadRequestException(`Invalid semantic cluster field: ${field}`);
}
