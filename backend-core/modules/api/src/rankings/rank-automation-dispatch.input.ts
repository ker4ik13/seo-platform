import { BadRequestException } from "@nestjs/common";
import type { InternalDispatchRankAutomationRunInput } from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/u;

export function rankAutomationDispatchInput(
  value: unknown
): InternalDispatchRankAutomationRunInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "automationId",
    "automationVersion",
    "runId",
    "idempotencyKey",
    "scheduledFor",
    "trackingContextId",
    "maxPlatformChargeMicro"
  ]);
  if (
    !Number.isSafeInteger(input.automationVersion) ||
    Number(input.automationVersion) < 1 ||
    typeof input.idempotencyKey !== "string" ||
    !KEY_PATTERN.test(input.idempotencyKey) ||
    !moneyLimit(input.maxPlatformChargeMicro)
  ) {
    invalid();
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    automationId: uuid(input.automationId, "automationId"),
    automationVersion: Number(input.automationVersion),
    runId: uuid(input.runId, "runId"),
    idempotencyKey: input.idempotencyKey,
    scheduledFor: iso(input.scheduledFor),
    trackingContextId: uuid(input.trackingContextId, "trackingContextId"),
    maxPlatformChargeMicro: input.maxPlatformChargeMicro
  };
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).length !== fields.length ||
    fields.some((field) => !(field in input)) ||
    Object.keys(input).some((field) => !fields.includes(field))
  ) {
    invalid();
  }
  return input;
}

function uuid(value: unknown, field: string): string {
  try {
    return assertUuid(String(value), field);
  } catch {
    return invalid();
  }
}

function iso(value: unknown): string {
  if (typeof value !== "string") invalid();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) invalid();
  return value;
}

function moneyLimit(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,29})$/u.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n
  );
}

function invalid(): never {
  throw new BadRequestException("Invalid rank automation dispatch request");
}
