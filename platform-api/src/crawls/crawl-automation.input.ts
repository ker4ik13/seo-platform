import type {
  AutomationSchedule,
  CrawlAllowedWindow,
  CreateCrawlAutomationInput,
  UpdateCrawlAutomationInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { createTechnicalCrawlInput } from "./crawl-input.js";

export function createCrawlAutomationInput(
  value: unknown
): CreateCrawlAutomationInput {
  return crawlAutomationInput(value);
}

export function updateCrawlAutomationInput(
  value: unknown
): UpdateCrawlAutomationInput {
  return crawlAutomationInput(value);
}

export function assertEmptyCrawlAutomationInput(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    invalid("body");
  }
}

function crawlAutomationInput(
  value: unknown
): CreateCrawlAutomationInput {
  const input = exactRecord(value, [
    "name",
    "timezone",
    "schedule",
    "allowedWindow",
    "config",
    "failureThreshold",
    "enabled"
  ]);
  const name = text(input.name, "name").normalize("NFC");
  if (
    name.length > 160 ||
    // oxlint-disable-next-line no-control-regex -- User-facing names reject C0 and DEL.
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    invalid("name");
  }
  const config = createTechnicalCrawlInput(input.config);
  return {
    name,
    timezone: timezone(input.timezone),
    schedule: schedule(input.schedule),
    allowedWindow: allowedWindow(input.allowedWindow),
    config: {
      ...config,
      maxRuntimeSeconds: config.maxRuntimeSeconds ?? 3_600
    },
    failureThreshold: integer(
      input.failureThreshold,
      "failureThreshold",
      1,
      10
    ),
    enabled: bool(input.enabled, "enabled")
  };
}

function schedule(value: unknown): AutomationSchedule {
  const input = record(value, "schedule");
  exactFields(
    input,
    input.cadence === "WEEKLY"
      ? ["cadence", "hour", "minute", "weekdays"]
      : ["cadence", "hour", "minute"],
    "schedule"
  );
  const hour = integer(input.hour, "schedule.hour", 0, 23);
  const minute = integer(input.minute, "schedule.minute", 0, 59);
  if (input.cadence === "DAILY") {
    return { cadence: "DAILY", hour, minute };
  }
  if (
    input.cadence !== "WEEKLY" ||
    !Array.isArray(input.weekdays) ||
    input.weekdays.length < 1 ||
    input.weekdays.length > 7 ||
    input.weekdays.some(
      (day) =>
        !Number.isSafeInteger(day) || Number(day) < 1 || Number(day) > 7
    ) ||
    new Set(input.weekdays).size !== input.weekdays.length
  ) {
    invalid("schedule.weekdays");
  }
  return {
    cadence: "WEEKLY",
    hour,
    minute,
    weekdays: input.weekdays as number[]
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

function timezone(value: unknown): string {
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
  exactFields(input, fields, "body");
  return input;
}

function exactFields(
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  field: string
): void {
  const keys = Object.keys(input);
  if (
    keys.length !== fields.length ||
    fields.some((item) => !keys.includes(item)) ||
    keys.some((item) => !fields.includes(item))
  ) {
    invalid(field);
  }
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
  throw validationError(
    field,
    "INVALID_FIELD",
    `Invalid field: ${field}`
  );
}
