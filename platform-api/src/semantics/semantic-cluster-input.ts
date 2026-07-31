import type {
  CreateSemanticClusterInput,
  SemanticClusterPageSource,
  UpdateSemanticClusterInput
} from "@seo-platform/contracts";
import { semanticClusterPageSources } from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const PAGE_SOURCES = new Set<string>(semanticClusterPageSources);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createSemanticClusterInput(
  value: unknown
): CreateSemanticClusterInput {
  const input = exactRecord(value);
  const pageMapping = createMappingInput(input);
  if (input.primaryPageId === undefined && hasMappingMetadata(input)) {
    invalid("primaryPageId", "Is required when mapping metadata is present");
  }
  return { name: clusterName(input.name), ...pageMapping };
}

export function updateSemanticClusterInput(
  value: unknown
): UpdateSemanticClusterInput {
  const input = exactRecord(value);
  if (input.primaryPageId === null && hasMappingMetadata(input)) {
    invalid("primaryPageId", "Mapping metadata cannot be set when clearing the page");
  }
  return { name: clusterName(input.name), ...updateMappingInput(input) };
}

function exactRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$", "Must be a JSON object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowed = [
    "name",
    "primaryPageId",
    "pageMappingSource",
    "pageMappingConfidence",
    "pageMappingRationale"
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    invalid("$", "Contains unsupported fields");
  }
  return input;
}

function createMappingInput(
  input: Readonly<Record<string, unknown>>
): Omit<CreateSemanticClusterInput, "name"> {
  return {
    ...optionalCreatePageId(input.primaryPageId),
    ...mappingMetadata(input)
  };
}

function updateMappingInput(
  input: Readonly<Record<string, unknown>>
): Omit<UpdateSemanticClusterInput, "name"> {
  return {
    ...optionalUpdatePageId(input.primaryPageId),
    ...mappingMetadata(input)
  };
}

function mappingMetadata(
  input: Readonly<Record<string, unknown>>
): Readonly<{
  pageMappingSource?: SemanticClusterPageSource;
  pageMappingConfidence?: number;
  pageMappingRationale?: string;
}> {
  return {
    ...(input.pageMappingSource === undefined
      ? {}
      : { pageMappingSource: pageSource(input.pageMappingSource) }),
    ...(input.pageMappingConfidence === undefined
      ? {}
      : { pageMappingConfidence: confidence(input.pageMappingConfidence) }),
    ...(input.pageMappingRationale === undefined
      ? {}
      : { pageMappingRationale: rationale(input.pageMappingRationale) })
  };
}

function optionalCreatePageId(
  value: unknown
): Readonly<{ primaryPageId?: string }> {
  if (value === undefined) return {};
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid("primaryPageId", "Must be a UUID");
  }
  return { primaryPageId: value.toLowerCase() };
}

function optionalUpdatePageId(
  value: unknown
): Readonly<{ primaryPageId?: string | null }> {
  if (value === null) return { primaryPageId: null };
  return optionalCreatePageId(value);
}

function pageSource(value: unknown): SemanticClusterPageSource {
  if (typeof value !== "string" || !PAGE_SOURCES.has(value)) {
    invalid("pageMappingSource", "Contains an unsupported mapping source");
  }
  return value as SemanticClusterPageSource;
}

function confidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid("pageMappingConfidence", "Must be a number between 0 and 1");
  }
  return value;
}

function rationale(value: unknown): string {
  if (typeof value !== "string") invalid("pageMappingRationale", "Must be a string");
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 2_000) {
    invalid("pageMappingRationale", "Must contain 1 to 2000 characters");
  }
  return normalized;
}

function hasMappingMetadata(input: Readonly<Record<string, unknown>>): boolean {
  return [
    input.pageMappingSource,
    input.pageMappingConfidence,
    input.pageMappingRationale
  ].some((value) => value !== undefined);
}

function clusterName(value: unknown): string {
  if (typeof value !== "string") invalid("name", "Must be a string");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 255) {
    invalid("name", "Must contain 1 to 255 characters");
  }
  return name;
}

function invalid(path: string, message: string): never {
  throw validationError(path, "INVALID_SEMANTIC_CLUSTER", message);
}
