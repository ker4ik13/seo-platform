import { BadRequestException } from "@nestjs/common";
import type {
  CrawlAllowedWindow,
  InternalCreateCrawlAutomationInput,
  InternalCrawlAutomationStatusInput,
  InternalRunCrawlAutomationInput,
  InternalUpdateCrawlAutomationInput
} from "@seo-platform/contracts";
import {
  automationCapacityEntitlement,
  automationSchedule
} from "../automations/automation-input.js";
import { crawlConfig } from "../crawls/crawl-input.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;

export function internalCreateCrawlAutomationInput(
  value: unknown
): InternalCreateCrawlAutomationInput {
  const input = exactRecord(value, [
    ...AUTOMATION_FIELDS,
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey",
    "entitlement"
  ]);
  return {
    ...automationFields(input),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey: idempotency(input.idempotencyKey),
    entitlement: automationCapacityEntitlement(input.entitlement)
  };
}

export function internalUpdateCrawlAutomationInput(
  value: unknown
): InternalUpdateCrawlAutomationInput {
  const input = exactRecord(value, [
    ...AUTOMATION_FIELDS,
    "workspaceId",
    "projectId",
    "actorId",
    "automationId",
    "expectedVersion",
    "entitlement"
  ]);
  return {
    ...automationFields(input),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    automationId: uuid(input.automationId, "automationId"),
    expectedVersion: integer(
      input.expectedVersion,
      "expectedVersion",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    entitlement: automationCapacityEntitlement(input.entitlement)
  };
}

export function internalCrawlAutomationStatusInput(
  value: unknown
): InternalCrawlAutomationStatusInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "automationId",
    "expectedVersion",
    "entitlement"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    automationId: uuid(input.automationId, "automationId"),
    expectedVersion: integer(
      input.expectedVersion,
      "expectedVersion",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    entitlement: automationCapacityEntitlement(input.entitlement)
  };
}

export function internalRunCrawlAutomationInput(
  value: unknown
): InternalRunCrawlAutomationInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "automationId",
    "expectedVersion",
    "idempotencyKey"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    automationId: uuid(input.automationId, "automationId"),
    expectedVersion: integer(
      input.expectedVersion,
      "expectedVersion",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    idempotencyKey: idempotency(input.idempotencyKey)
  };
}

function automationFields(input: Readonly<Record<string, unknown>>) {
  const name = text(input.name, "name").normalize("NFC");
  if (
    name.length > 160 ||
    // oxlint-disable-next-line no-control-regex -- User-facing names reject C0 and DEL.
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    invalid("name");
  }
  const timezone = timeZone(input.timezone);
  return {
    name,
    timezone,
    schedule: automationSchedule(input.schedule),
    allowedWindow: allowedWindow(input.allowedWindow),
    config: crawlConfig(record(input.config, "config")),
    failureThreshold: integer(
      input.failureThreshold,
      "failureThreshold",
      1,
      10
    ),
    enabled: bool(input.enabled, "enabled")
  };
}

function allowedWindow(value: unknown): CrawlAllowedWindow {
  const input = exactRecord(value, ["startMinute", "endMinute"]);
  const startMinute = integer(
    input.startMinute,
    "allowedWindow.startMinute",
    0,
    1_439
  );
  const endMinute = integer(
    input.endMinute,
    "allowedWindow.endMinute",
    1,
    1_440
  );
  if (startMinute >= endMinute) invalid("allowedWindow");
  return { startMinute, endMinute };
}

function timeZone(value: unknown): string {
  const result = text(value, "timezone");
  if (result.length > 64) invalid("timezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: result }).format(
      new Date(0)
    );
  } catch {
    invalid("timezone");
  }
  return result;
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value, "body");
  const keys = Object.keys(input);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !keys.includes(field)) ||
    keys.some((field) => !fields.includes(field))
  ) {
    invalid("body");
  }
  return input;
}

function record(
  value: unknown,
  field: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(field);
  }
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid(field);
  }
  return value;
}

function idempotency(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_PATTERN.test(value)) {
    invalid("idempotencyKey");
  }
  return value;
}

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    invalid(field);
  }
  return Number(value);
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function invalid(field: string): never {
  throw new BadRequestException(
    `Invalid crawl automation field: ${field}`
  );
}

const AUTOMATION_FIELDS = [
  "name",
  "timezone",
  "schedule",
  "allowedWindow",
  "config",
  "failureThreshold",
  "enabled"
] as const;
