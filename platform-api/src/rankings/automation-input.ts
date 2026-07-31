import { validationError } from "../common/domain-error.js";
import type {
  AutomationSchedule,
  CreateRankTrackingAutomationInput,
  UpdateRankTrackingAutomationInput
} from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";

export function createAutomationInput(
  value: unknown
): CreateRankTrackingAutomationInput {
  return automationInput(value);
}

export function updateAutomationInput(
  value: unknown
): UpdateRankTrackingAutomationInput {
  return automationInput(value);
}

export function assertEmptyAutomationStatusInput(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    invalid("body");
  }
}

function automationInput(
  value: unknown
): CreateRankTrackingAutomationInput {
  const input = exactRecord(value, [
    "name",
    "trackingContextId",
    "timezone",
    "schedule",
    "maxItems",
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
  return {
    name,
    trackingContextId: assertUuid(
      text(input.trackingContextId, "trackingContextId"),
      "trackingContextId"
    ),
    timezone: timezone(input.timezone),
    schedule: schedule(input.schedule),
    maxItems: integer(input.maxItems, "maxItems", 1, 1_000),
    failureThreshold: integer(
      input.failureThreshold,
      "failureThreshold",
      1,
      10
    ),
    enabled: boolean(input.enabled, "enabled")
  };
}

function schedule(value: unknown): AutomationSchedule {
  const input = record(value, "schedule");
  const cadence = input.cadence;
  exactFields(
    input,
    cadence === "WEEKLY"
      ? ["cadence", "hour", "minute", "weekdays"]
      : ["cadence", "hour", "minute"],
    "schedule"
  );
  const hour = integer(input.hour, "schedule.hour", 0, 23);
  const minute = integer(input.minute, "schedule.minute", 0, 59);
  if (cadence === "DAILY") return { cadence, hour, minute };
  if (
    cadence !== "WEEKLY" ||
    !Array.isArray(input.weekdays) ||
    input.weekdays.length < 1 ||
    input.weekdays.length > 7 ||
    input.weekdays.some(
      (value) => !Number.isInteger(value) || Number(value) < 1 || Number(value) > 7
    )
  ) {
    invalid("schedule.weekdays");
  }
  const weekdays = [...new Set(input.weekdays as number[])].sort(
    (left, right) => left - right
  );
  if (weekdays.length !== input.weekdays.length) {
    invalid("schedule.weekdays");
  }
  return { cadence, hour, minute, weekdays };
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

function integer(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    invalid(path);
  }
  return Number(value);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path);
  return value.trim();
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
  path: string
): void {
  if (
    Object.keys(input).length !== fields.length ||
    fields.some((field) => !(field in input)) ||
    Object.keys(input).some((field) => !fields.includes(field))
  ) {
    invalid(path);
  }
}

function record(
  value: unknown,
  path: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path);
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalid(path: string): never {
  throw validationError(
    path,
    "INVALID_FIELD",
    `Invalid field: ${path}`
  );
}
