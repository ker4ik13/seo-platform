import type {
  AutomationRunCollection,
  AutomationRunSummary,
  RankTrackingAutomationSchedule,
  RankTrackingAutomationCollection,
  RankTrackingAutomationSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function scopedAutomationCollection(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedLimit: number
): RankTrackingAutomationCollection {
  const input = exactRecord(value, [
    "automations",
    "limit",
    "enabledCount",
    "truncated"
  ]);
  if (
    !Array.isArray(input.automations) ||
    input.automations.length > 100 ||
    input.limit !== expectedLimit ||
    !nonnegativeInteger(input.enabledCount) ||
    typeof input.truncated !== "boolean"
  ) {
    invalid();
  }
  const automations = input.automations.map((automation) =>
    scopedAutomation(automation, workspaceId, projectId)
  );
  if (
    new Set(automations.map(({ id }) => id)).size !== automations.length
  ) {
    invalid();
  }
  return {
    automations,
    limit: expectedLimit,
    enabledCount: Number(input.enabledCount),
    truncated: input.truncated
  };
}

export function scopedAutomation(
  value: unknown,
  workspaceId: string,
  projectId: string,
  automationId?: string
): RankTrackingAutomationSummary {
  const input = record(value);
  const optional = [
    ...(input.pausedReason === undefined ? [] : ["pausedReason"]),
    ...(input.nextRunAt === undefined ? [] : ["nextRunAt"]),
    ...(input.lastRunAt === undefined ? [] : ["lastRunAt"])
  ];
  exactFields(input, [
    "id",
    "workspaceId",
    "projectId",
    "name",
    "trackingContextId",
    "timezone",
    "schedule",
    "maxPlatformChargeMicro",
    "failureThreshold",
    "enabled",
    ...optional,
    "consecutiveErrors",
    "version",
    "createdAt",
    "updatedAt"
  ]);
  if (
    !uuid(input.id) ||
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    (automationId !== undefined && input.id !== automationId) ||
    typeof input.name !== "string" ||
    input.name.length < 1 ||
    input.name.length > 160 ||
    typeof input.timezone !== "string" ||
    input.timezone.length < 1 ||
    input.timezone.length > 64 ||
    !uuid(input.trackingContextId) ||
    !moneyLimit(input.maxPlatformChargeMicro) ||
    !positiveInteger(input.failureThreshold, 10) ||
    typeof input.enabled !== "boolean" ||
    !nonnegativeInteger(input.consecutiveErrors) ||
    !positiveInteger(input.version) ||
    !iso(input.createdAt) ||
    !iso(input.updatedAt) ||
    (input.nextRunAt !== undefined && !iso(input.nextRunAt)) ||
    (input.lastRunAt !== undefined && !iso(input.lastRunAt)) ||
    (input.pausedReason !== undefined &&
      !["MANUAL", "FAILURE_THRESHOLD", "ONE_TIME_COMPLETED"].includes(
        String(input.pausedReason)
      )) ||
    (input.enabled && input.pausedReason !== undefined)
  ) {
    invalid();
  }
  const schedule = automationSchedule(input.schedule);
  return {
    id: input.id,
    workspaceId,
    projectId,
    name: input.name,
    trackingContextId: input.trackingContextId,
    timezone: input.timezone,
    schedule,
    maxPlatformChargeMicro: input.maxPlatformChargeMicro,
    failureThreshold: Number(input.failureThreshold),
    enabled: input.enabled,
    ...(input.pausedReason !== undefined
      ? {
          pausedReason:
            input.pausedReason as Exclude<
              RankTrackingAutomationSummary["pausedReason"],
              undefined
            >
        }
      : {}),
    ...(input.nextRunAt !== undefined
      ? { nextRunAt: input.nextRunAt as string }
      : {}),
    ...(input.lastRunAt !== undefined
      ? { lastRunAt: input.lastRunAt as string }
      : {}),
    consecutiveErrors: Number(input.consecutiveErrors),
    version: Number(input.version),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function scopedAutomationRuns(
  value: unknown,
  workspaceId: string,
  projectId: string,
  automationId: string
): AutomationRunCollection {
  const input = exactRecord(value, ["runs", "truncated"]);
  if (
    !Array.isArray(input.runs) ||
    input.runs.length > 50 ||
    typeof input.truncated !== "boolean"
  ) {
    invalid();
  }
  const runs = input.runs.map((run) =>
    scopedAutomationRun(run, workspaceId, projectId, automationId)
  );
  if (new Set(runs.map(({ id }) => id)).size !== runs.length) {
    invalid();
  }
  return { runs, truncated: input.truncated };
}

export function scopedAutomationRun(
  value: unknown,
  workspaceId: string,
  projectId: string,
  automationId: string
): AutomationRunSummary {
  const input = record(value);
  const optional = [
    ...(input.estimateId === undefined ? [] : ["estimateId"]),
    ...(input.jobId === undefined ? [] : ["jobId"]),
    ...(input.errorCode === undefined ? [] : ["errorCode"]),
    ...(input.startedAt === undefined ? [] : ["startedAt"]),
    ...(input.finishedAt === undefined ? [] : ["finishedAt"])
  ];
  exactFields(input, [
    "id",
    "automationId",
    "automationVersion",
    "workspaceId",
    "projectId",
    "status",
    "trigger",
    "scheduledFor",
    ...optional,
    "createdAt"
  ]);
  if (
    !uuid(input.id) ||
    input.automationId !== automationId ||
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    !positiveInteger(input.automationVersion) ||
    !["RUNNING", "DISPATCHED", "SKIPPED", "COMPLETED", "FAILED"].includes(
      String(input.status)
    ) ||
    !["SCHEDULE", "MANUAL"].includes(String(input.trigger)) ||
    !iso(input.scheduledFor) ||
    !iso(input.createdAt) ||
    (input.estimateId !== undefined && !uuid(input.estimateId)) ||
    (input.jobId !== undefined && !uuid(input.jobId)) ||
    (input.errorCode !== undefined &&
      (typeof input.errorCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,99}$/u.test(input.errorCode))) ||
    (input.startedAt !== undefined && !iso(input.startedAt)) ||
    (input.finishedAt !== undefined && !iso(input.finishedAt)) ||
    !validRunLifecycle(input)
  ) {
    invalid();
  }
  return {
    id: input.id,
    automationId,
    automationVersion: Number(input.automationVersion),
    workspaceId,
    projectId,
    status: input.status as AutomationRunSummary["status"],
    trigger: input.trigger as AutomationRunSummary["trigger"],
    scheduledFor: input.scheduledFor,
    ...(input.estimateId === undefined
      ? {}
      : { estimateId: input.estimateId }),
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
    ...(input.errorCode === undefined
      ? {}
      : { errorCode: input.errorCode }),
    ...(input.startedAt === undefined
      ? {}
      : { startedAt: input.startedAt }),
    ...(input.finishedAt === undefined
      ? {}
      : { finishedAt: input.finishedAt }),
    createdAt: input.createdAt
  };
}

function validRunLifecycle(
  input: Readonly<Record<string, unknown>>
): boolean {
  const status = input.status;
  const hasEstimate = input.estimateId !== undefined;
  const hasJob = input.jobId !== undefined;
  const hasError = input.errorCode !== undefined;
  const hasStarted = input.startedAt !== undefined;
  const hasFinished = input.finishedAt !== undefined;
  const lifecycleIsValid =
    (status === "RUNNING" &&
      hasStarted &&
      !hasJob &&
      !hasError &&
      !hasFinished) ||
    (status === "DISPATCHED" &&
      hasStarted &&
      hasEstimate &&
      hasJob &&
      !hasError &&
      !hasFinished) ||
    ((status === "SKIPPED" || status === "FAILED") &&
      hasError &&
      hasFinished) ||
    (status === "COMPLETED" &&
      hasJob &&
      !hasError &&
      hasFinished);
  if (!lifecycleIsValid) return false;

  const createdAt = Date.parse(String(input.createdAt));
  const startedAt = hasStarted
    ? Date.parse(String(input.startedAt))
    : undefined;
  const finishedAt = hasFinished
    ? Date.parse(String(input.finishedAt))
    : undefined;
  return (
    (startedAt === undefined || startedAt >= createdAt) &&
    (finishedAt === undefined ||
      finishedAt >= (startedAt ?? createdAt))
  );
}

function automationSchedule(value: unknown): RankTrackingAutomationSchedule {
  const input = record(value);
  if (input.cadence === "ONCE") {
    exactFields(input, ["cadence", "runAt"]);
    if (!iso(input.runAt)) invalid();
    return { cadence: "ONCE", runAt: input.runAt as string };
  }
  const fields =
    input.cadence === "WEEKLY"
      ? ["cadence", "hour", "minute", "weekdays"]
      : ["cadence", "hour", "minute"];
  exactFields(input, fields);
  if (
    !nonnegativeInteger(input.hour) ||
    Number(input.hour) > 23 ||
    !nonnegativeInteger(input.minute) ||
    Number(input.minute) > 59
  ) {
    invalid();
  }
  if (input.cadence === "DAILY") {
    return {
      cadence: "DAILY",
      hour: Number(input.hour),
      minute: Number(input.minute)
    };
  }
  if (
    input.cadence !== "WEEKLY" ||
    !Array.isArray(input.weekdays) ||
    input.weekdays.length < 1 ||
    input.weekdays.length > 7 ||
    input.weekdays.some(
      (weekday) =>
        !Number.isSafeInteger(weekday) ||
        Number(weekday) < 1 ||
        Number(weekday) > 7
    ) ||
    new Set(input.weekdays).size !== input.weekdays.length
  ) {
    invalid();
  }
  return {
    cadence: "WEEKLY",
    hour: Number(input.hour),
    minute: Number(input.minute),
    weekdays: input.weekdays as number[]
  };
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value);
  exactFields(input, fields);
  return input;
}

function exactFields(
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[]
): void {
  if (
    Object.keys(input).length !== fields.length ||
    fields.some((field) => !(field in input)) ||
    Object.keys(input).some((field) => !fields.includes(field))
  ) {
    invalid();
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function positiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= maximum
  );
}

function nonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function moneyLimit(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,29})$/u.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n
  );
}

function iso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString() === value
  );
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs service returned an invalid automation response",
    retryable: true
  });
}
