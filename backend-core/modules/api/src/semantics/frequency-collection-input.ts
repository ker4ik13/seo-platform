import {
  frequencyCollectionKeywordLimit,
  frequencyCollectionModes,
  parseFrequencySeasonalityRequest,
  semanticFrequencyDevices,
  semanticSeasonalityFrequencyTypes,
  semanticFrequencyTypes,
  type CreateFrequencyCollectionInput,
  type SemanticFrequencyDevice,
  type SemanticFrequencyType
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const REGION_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/u;

export interface SemanticFrequencyContextRoute {
  readonly type: SemanticFrequencyType;
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
}

export function createFrequencyCollectionInput(
  value: unknown
): CreateFrequencyCollectionInput {
  const input = record(value, [
    "items",
    "types",
    "regionCode",
    "device",
    "mode",
    "seasonality"
  ]);
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > frequencyCollectionKeywordLimit
  ) {
    invalid("items");
  }
  const items = input.items.map((value, index) => {
    const item = record(value, ["id", "version"]);
    if (typeof item.id !== "string" || !UUID_PATTERN.test(item.id)) {
      invalid(`items.${index}.id`);
    }
    if (!Number.isSafeInteger(item.version) || Number(item.version) < 1) {
      invalid(`items.${index}.version`);
    }
    return { id: item.id.toLowerCase(), version: Number(item.version) };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("items");
  if (
    !Array.isArray(input.types) ||
    input.types.length < 1 ||
    input.types.length > semanticFrequencyTypes.length
  ) {
    invalid("types");
  }
  const types = input.types.map((value): SemanticFrequencyType => {
    if (
      typeof value !== "string" ||
      !semanticFrequencyTypes.includes(value as SemanticFrequencyType)
    ) invalid("types");
    return value as SemanticFrequencyType;
  });
  if (new Set(types).size !== types.length) invalid("types");
  if (typeof input.regionCode !== "string" || !REGION_PATTERN.test(input.regionCode)) {
    invalid("regionCode");
  }
  if (
    typeof input.device !== "string" ||
    !semanticFrequencyDevices.includes(input.device as SemanticFrequencyDevice)
  ) invalid("device");
  const mode = input.mode === undefined ? "FREQUENCY" : input.mode;
  if (!frequencyCollectionModes.includes(mode as never)) invalid("mode");
  let seasonality;
  if (mode === "SEASONALITY") {
    if (types.some((type) => !semanticSeasonalityFrequencyTypes.includes(type as "BASE"))) {
      invalid("types");
    }
    try {
      seasonality = parseFrequencySeasonalityRequest(input.seasonality);
    } catch {
      invalid("seasonality");
    }
  } else if (input.seasonality !== undefined) {
    invalid("seasonality");
  }
  return {
    items,
    types,
    regionCode: input.regionCode,
    device: input.device as SemanticFrequencyDevice,
    ...(input.mode === undefined
      ? {}
      : { mode: mode as "FREQUENCY" | "SEASONALITY" }),
    ...(seasonality ? { seasonality } : {})
  };
}

export function frequencyIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    invalid("Idempotency-Key");
  }
  return value;
}

export function frequencyCancelInput(value: unknown): Record<string, never> {
  record(value, []);
  return {};
}

export function frequencyRetryInput(value: unknown): { readonly version: number } {
  const input = record(value, ["version"]);
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1) {
    invalid("version");
  }
  return { version: Number(input.version) };
}

export function semanticFrequencyContextRoute(
  type: unknown,
  regionCode: unknown,
  device: unknown
): SemanticFrequencyContextRoute {
  if (
    typeof type !== "string" ||
    !semanticFrequencyTypes.includes(type as SemanticFrequencyType)
  ) {
    invalid("type");
  }
  if (typeof regionCode !== "string" || !REGION_PATTERN.test(regionCode)) {
    invalid("regionCode");
  }
  if (
    typeof device !== "string" ||
    !semanticFrequencyDevices.includes(device as SemanticFrequencyDevice)
  ) {
    invalid("device");
  }
  return {
    type: type as SemanticFrequencyType,
    regionCode,
    device: device as SemanticFrequencyDevice
  };
}

function record(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !fields.includes(key))) invalid("body");
  return input;
}

function invalid(path: string): never {
  throw validationError(path, "INVALID", "Invalid frequency collection request");
}
