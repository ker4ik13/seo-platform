import { BadRequestException } from "@nestjs/common";
import { domainToASCII } from "node:url";
import {
  aiAnswerDevices,
  aiAnswerSearchEngines,
  arsenkinAiAnswerKeywordLimit,
  operationResultDefaultPageSize,
  operationResultPageSizes,
  type OperationResultPageSize,
  type AiAnswerDevice,
  type AiAnswerSearchEngine,
  type InternalCancelAiAnswerCollectionInput,
  type InternalCreateAiAnswerCollectionInput
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const REGION_PATTERN = /^(?:0|[1-9]\d{0,9})$/u;
const HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

export function internalCreateAiAnswerCollectionInput(
  value: unknown
): InternalCreateAiAnswerCollectionInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey",
    "correlationId",
    "jobCapacity",
    "items",
    "searchEngine",
    "regionCode",
    "device",
    "host",
    "excludeSubdomains",
    "brands"
  ]);
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > arsenkinAiAnswerKeywordLimit
  ) invalid("items");
  const items = input.items.map((candidate, index) => {
    const item = record(candidate, ["id", "version"]);
    return {
      id: uuid(item.id, `items.${index}.id`),
      version: integer(item.version, `items.${index}.version`, 1)
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("items");
  if (typeof input.excludeSubdomains !== "boolean") invalid("excludeSubdomains");
  if (!Array.isArray(input.brands) || input.brands.length > 10) invalid("brands");
  const brands = input.brands.map((brand, index) =>
    bounded(brand, `brands.${index}`, 160)
  );
  if (new Set(brands.map((brand) => brand.toLocaleLowerCase("ru-RU"))).size !== brands.length) {
    invalid("brands");
  }
  const capacity = record(input.jobCapacity, [
    "planCode",
    "planVersion",
    "concurrentJobs"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey: pattern(input.idempotencyKey, "idempotencyKey", KEY_PATTERN),
    correlationId: bounded(input.correlationId, "correlationId", 100),
    jobCapacity: {
      planCode: bounded(capacity.planCode, "jobCapacity.planCode", 64),
      planVersion: integer(capacity.planVersion, "jobCapacity.planVersion", 1),
      concurrentJobs: integer(capacity.concurrentJobs, "jobCapacity.concurrentJobs", 1)
    },
    items,
    searchEngine: member(input.searchEngine, aiAnswerSearchEngines, "searchEngine"),
    regionCode: pattern(input.regionCode, "regionCode", REGION_PATTERN),
    device: member(input.device, aiAnswerDevices, "device"),
    host: normalizedHost(input.host),
    excludeSubdomains: input.excludeSubdomains,
    brands
  };
}

export function internalCancelAiAnswerCollectionInput(
  value: unknown
): InternalCancelAiAnswerCollectionInput {
  const input = record(value, ["workspaceId", "projectId", "actorId"]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId")
  };
}

export function aiAnswerResultPageLimit(value: unknown): OperationResultPageSize {
  if (value === undefined) return operationResultDefaultPageSize;
  const parsed = Number(value);
  if (
    typeof value !== "string" ||
    !Number.isSafeInteger(parsed) ||
    !operationResultPageSizes.some((size) => size === parsed)
  ) invalid("result.limit");
  return parsed as OperationResultPageSize;
}

export function aiAnswerResultCursor(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,3})$/u.test(value)) {
    invalid("result.cursor");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed >= arsenkinAiAnswerKeywordLimit) {
    invalid("result.cursor");
  }
  return parsed;
}

function member<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid(field);
  return value as T;
}

function normalizedHost(value: unknown): string {
  if (typeof value !== "string") invalid("host");
  const host = domainToASCII(
    value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/^www\./u, "")
  );
  if (!HOST_PATTERN.test(host)) invalid("host");
  return host;
}

function record(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid("body");
  return input;
}

function uuid(value: unknown, field: string): string {
  return pattern(value, field, UUID_PATTERN).toLowerCase();
}

function pattern(value: unknown, field: string, expression: RegExp): string {
  if (typeof value !== "string" || !expression.test(value)) invalid(field);
  return value;
}

function bounded(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid(field);
  const result = value.trim();
  if (!result || result.length > maximum) invalid(field);
  return result;
}

function integer(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) invalid(field);
  return Number(value);
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid AI answer collection ${field}`);
}

void (null as unknown as AiAnswerSearchEngine);
void (null as unknown as AiAnswerDevice);
