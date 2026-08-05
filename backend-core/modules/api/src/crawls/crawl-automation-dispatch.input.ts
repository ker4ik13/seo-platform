import { BadRequestException } from "@nestjs/common";
import type {
  InternalDispatchCrawlAutomationRunInput,
  TechnicalCrawlConfig
} from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";
import { createTechnicalCrawlInput } from "./crawl-input.js";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;

export interface DispatchHeaderRequest {
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly raw?: { readonly rawHeaders?: readonly string[] };
}

export function crawlAutomationDispatchInput(
  value: unknown
): InternalDispatchCrawlAutomationRunInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "automationId",
    "automationVersion",
    "runId",
    "idempotencyKey",
    "scheduledFor",
    "config"
  ]);
  const config = createTechnicalCrawlInput(input.config);
  if (
    !Number.isSafeInteger(input.automationVersion) ||
    Number(input.automationVersion) < 1 ||
    !KEY_PATTERN.test(String(input.idempotencyKey))
  ) {
    invalid();
  }
  const scheduledFor = isoDate(input.scheduledFor);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    automationId: uuid(input.automationId, "automationId"),
    automationVersion: Number(input.automationVersion),
    runId: uuid(input.runId, "runId"),
    idempotencyKey: String(input.idempotencyKey),
    scheduledFor,
    config: {
      ...config,
      purpose: config.purpose ?? "TECHNICAL_AUDIT",
      maxRuntimeSeconds: config.maxRuntimeSeconds ?? 3_600
    } as TechnicalCrawlConfig
  };
}

export function requiredDispatchHeaders(
  request: DispatchHeaderRequest
): {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
} {
  const requestId = singleDispatchHeader(request, "x-request-id");
  const idempotencyKey = singleDispatchHeader(request, "idempotency-key");
  if (
    !requestId ||
    !REQUEST_ID_PATTERN.test(requestId) ||
    !idempotencyKey ||
    !KEY_PATTERN.test(idempotencyKey)
  ) {
    invalid();
  }
  return {
    requestId,
    workspaceId: uuid(
      singleDispatchHeader(request, "x-workspace-id"),
      "workspaceId"
    ),
    projectId: uuid(
      singleDispatchHeader(request, "x-project-id"),
      "projectId"
    ),
    actorId: uuid(
      singleDispatchHeader(request, "x-actor-id"),
      "actorId"
    ),
    idempotencyKey
  };
}

export function singleDispatchHeader(
  request: DispatchHeaderRequest,
  name: string
): string | undefined {
  const value = request.headers[name];
  if (typeof value !== "string") return undefined;
  const rawHeaders = request.raw?.rawHeaders;
  if (!rawHeaders) return value;
  if (rawHeaders.length % 2 !== 0) return undefined;
  let matches = 0;
  let rawValue: string | undefined;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      matches += 1;
      rawValue = rawHeaders[index + 1];
    }
  }
  return matches === 1 && rawValue === value ? value : undefined;
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown, field: string): string {
  try {
    return assertUuid(String(value), field);
  } catch {
    return invalid();
  }
}

function isoDate(value: unknown): string {
  if (typeof value !== "string") invalid();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    invalid();
  }
  return value;
}

function invalid(): never {
  throw new BadRequestException(
    "Invalid crawl automation dispatch request"
  );
}
