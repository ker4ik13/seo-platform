import {
  frequencyCollectionStatuses,
  semanticFrequencyDevices,
  semanticFrequencyTypes,
  type FrequencyCollectionStatus,
  type FrequencyCollectionSummary,
  type SemanticFrequencyDevice,
  type SemanticFrequencyType
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function scopedFrequencyCollection(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedId?: string
): FrequencyCollectionSummary {
  const input = record(value);
  const id = uuid(input.id);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    (expectedId !== undefined && id !== expectedId) ||
    input.provider !== "XMLSTOCK"
  ) invalid();
  if (!Array.isArray(input.types) || input.types.length < 1 || input.types.length > 3) {
    invalid();
  }
  const types = input.types.map((value) => member(value, semanticFrequencyTypes));
  return {
    id,
    workspaceId,
    projectId,
    provider: "XMLSTOCK",
    status: member(input.status, frequencyCollectionStatuses),
    ...optionalString(input.stage, "stage", 64),
    selectedKeywords: integer(input.selectedKeywords, 1, 200),
    completedKeywords: integer(input.completedKeywords, 0, 200),
    failedKeywords: integer(input.failedKeywords, 0, 200),
    types,
    regionCode: string(input.regionCode, 100),
    device: member(input.device, semanticFrequencyDevices),
    ...optionalTimestamp(input.retryAt, "retryAt"),
    ...optionalString(input.failureCode, "failureCode", 64),
    version: integer(input.version, 1, Number.MAX_SAFE_INTEGER),
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
    ...optionalTimestamp(input.startedAt, "startedAt"),
    ...optionalTimestamp(input.finishedAt, "finishedAt")
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function string(value: unknown, max: number): string {
  if (typeof value !== "string" || !value || value.length > max) invalid();
  return value;
}

function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid();
  return Number(value);
}

function member<const Values extends readonly string[]>(
  value: unknown,
  values: Values
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as Values[number];
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid();
  return value;
}

function optionalTimestamp(
  value: unknown,
  key: "retryAt" | "startedAt" | "finishedAt"
): Partial<Record<typeof key, string>> {
  return value === undefined ? {} : { [key]: timestamp(value) };
}

function optionalString(
  value: unknown,
  key: "stage" | "failureCode",
  max: number
): Partial<Record<typeof key, string>> {
  return value === undefined ? {} : { [key]: string(value, max) };
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs returned an invalid frequency collection response",
    retryable: true
  });
}

void (null as unknown as FrequencyCollectionStatus);
void (null as unknown as SemanticFrequencyDevice);
void (null as unknown as SemanticFrequencyType);
