import { BadRequestException } from "@nestjs/common";
import type {
  InternalAiAnswerOperationResultInput,
  InternalFrequencyOperationResultInput,
  OperationResultPageSize
} from "@seo-platform/contracts";
import {
  arsenkinAiAnswerKeywordLimit,
  arsenkinWordstatKeywordLimit,
  operationResultDefaultPageSize,
  operationResultPageSizes
} from "@seo-platform/contracts";
import {
  assertInternalContext,
  internalUuid,
  type InternalCommandContext
} from "../internal/internal-command-context.js";

export function internalFrequencyOperationResultInput(
  value: unknown,
  context: InternalCommandContext,
  routeJobId: string
): InternalFrequencyOperationResultInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "keywordIds"
  ]);
  const parsed = {
    workspaceId: internalUuid(string(input.workspaceId), "workspaceId"),
    projectId: internalUuid(string(input.projectId), "projectId"),
    actorId: internalUuid(string(input.actorId), "actorId"),
    jobId: internalUuid(string(input.jobId), "jobId"),
    keywordIds: uuidList(input.keywordIds, arsenkinWordstatKeywordLimit)
  };
  assertInternalContext(parsed, context);
  if (parsed.jobId !== routeJobId) invalid("Job route does not match command");
  return parsed;
}

export function internalAiAnswerOperationResultInput(
  value: unknown,
  context: InternalCommandContext,
  routeJobId: string
): InternalAiAnswerOperationResultInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "keywordIds",
    "includeSources"
  ]);
  if (typeof input.includeSources !== "boolean") {
    invalid("Invalid operation result field");
  }
  const parsed = {
    workspaceId: internalUuid(string(input.workspaceId), "workspaceId"),
    projectId: internalUuid(string(input.projectId), "projectId"),
    actorId: internalUuid(string(input.actorId), "actorId"),
    jobId: internalUuid(string(input.jobId), "jobId"),
    keywordIds: uuidList(input.keywordIds, arsenkinAiAnswerKeywordLimit),
    includeSources: input.includeSources
  };
  assertInternalContext(parsed, context);
  if (parsed.jobId !== routeJobId) invalid("Job route does not match command");
  return parsed;
}

export function operationResultLimit(value: unknown): number {
  if (value === undefined) return 1_000;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    invalid("Invalid operation result limit");
  }
  return parsed;
}

export function operationResultPageLimit(
  value: unknown
): OperationResultPageSize {
  if (value === undefined) return operationResultDefaultPageSize;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    !operationResultPageSizes.some((size) => size === parsed)
  ) {
    invalid("Invalid operation result page size");
  }
  return parsed as OperationResultPageSize;
}

export function operationResultCursor(
  value: unknown,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,4})$/u.test(value)) {
    invalid("Invalid operation result cursor");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    invalid("Invalid operation result cursor");
  }
  return parsed;
}

function uuidList(value: unknown, maximum: number): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > maximum
  ) {
    invalid("Invalid operation result keyword scope");
  }
  const items = value.map((item) => internalUuid(string(item), "keywordId"));
  if (new Set(items).size !== items.length) {
    invalid("Duplicate operation result keyword");
  }
  return items;
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    invalid("Invalid operation result request");
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown): string {
  if (typeof value !== "string") invalid("Invalid operation result field");
  return value;
}

function invalid(message: string): never {
  throw new BadRequestException(message);
}
