import { BadRequestException } from "@nestjs/common";
import {
  semanticFrequencyDevices,
  semanticFrequencyTypes,
  type InternalCancelFrequencyCollectionInput,
  type InternalCreateFrequencyCollectionInput,
  type InternalRetryFrequencyCollectionInput,
  type SemanticFrequencyDevice,
  type SemanticFrequencyType
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const REGION_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/u;

export function internalCreateFrequencyCollectionInput(
  value: unknown
): InternalCreateFrequencyCollectionInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey",
    "correlationId",
    "items",
    "types",
    "regionCode",
    "device"
  ]);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) {
    invalid("items");
  }
  const items = input.items.map((value, index) => {
    const item = record(value, ["id", "version"]);
    return {
      id: uuid(item.id, `items.${index}.id`),
      version: integer(item.version, `items.${index}.version`, 1)
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("items");
  if (!Array.isArray(input.types) || input.types.length < 1 || input.types.length > 3) {
    invalid("types");
  }
  const types = input.types.map(frequencyType);
  if (new Set(types).size !== types.length) invalid("types");
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey: pattern(input.idempotencyKey, "idempotencyKey", KEY_PATTERN),
    correlationId: bounded(input.correlationId, "correlationId", 100),
    items,
    types,
    regionCode: pattern(input.regionCode, "regionCode", REGION_PATTERN),
    device: frequencyDevice(input.device)
  };
}

export function internalCancelFrequencyCollectionInput(
  value: unknown
): InternalCancelFrequencyCollectionInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    version: integer(input.version, "version", 1)
  };
}

export function internalRetryFrequencyCollectionInput(
  value: unknown
): InternalRetryFrequencyCollectionInput {
  return internalCancelFrequencyCollectionInput(value);
}

function frequencyType(value: unknown): SemanticFrequencyType {
  if (
    typeof value !== "string" ||
    !semanticFrequencyTypes.includes(value as SemanticFrequencyType)
  ) invalid("types");
  return value as SemanticFrequencyType;
}

function frequencyDevice(value: unknown): SemanticFrequencyDevice {
  if (
    typeof value !== "string" ||
    !semanticFrequencyDevices.includes(value as SemanticFrequencyDevice)
  ) invalid("device");
  return value as SemanticFrequencyDevice;
}

function record(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !fields.includes(key))) invalid("body");
  return input;
}

function uuid(value: unknown, field: string): string {
  return pattern(value, field, UUID_PATTERN).toLowerCase();
}

function pattern(value: unknown, field: string, expression: RegExp): string {
  if (typeof value !== "string" || !expression.test(value)) invalid(field);
  return value;
}

function bounded(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) invalid(field);
  return normalized;
}

function integer(value: unknown, field: string, min: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min) invalid(field);
  return Number(value);
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid frequency collection ${field}`);
}
