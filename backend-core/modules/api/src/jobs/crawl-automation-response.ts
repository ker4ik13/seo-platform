import type {
  AutomationSchedule,
  CrawlAutomationCollection,
  CrawlAutomationRunCollection,
  CrawlAutomationRunSummary,
  CrawlAutomationSummary
} from "@seo-platform/contracts";
import { createTechnicalCrawlInput } from "../crawls/crawl-input.js";
import { DomainError } from "../common/domain-error.js";

export function scopedCrawlAutomationCollection(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedLimit: number
): CrawlAutomationCollection {
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
    !nonNegativeInteger(input.enabledCount) ||
    typeof input.truncated !== "boolean"
  ) {
    invalid();
  }
  const automations = input.automations.map((automation) =>
    scopedCrawlAutomation(automation, workspaceId, projectId)
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

export function scopedCrawlAutomation(
  value: unknown,
  workspaceId: string,
  projectId: string,
  automationId?: string
): CrawlAutomationSummary {
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
    "timezone",
    "schedule",
    "allowedWindow",
    "config",
    "failureThreshold",
    "enabled",
    ...optional,
    "consecutiveErrors",
    "version",
    "createdAt",
    "updatedAt"
  ]);
  const window = exactRecord(input.allowedWindow, [
    "startMinute",
    "endMinute"
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
    !positiveInteger(input.failureThreshold, 10) ||
    typeof input.enabled !== "boolean" ||
    !nonNegativeInteger(input.consecutiveErrors) ||
    !positiveInteger(input.version) ||
    !iso(input.createdAt) ||
    !iso(input.updatedAt) ||
    (input.nextRunAt !== undefined && !iso(input.nextRunAt)) ||
    (input.lastRunAt !== undefined && !iso(input.lastRunAt)) ||
    (input.pausedReason !== undefined &&
      ![
        "MANUAL",
        "FAILURE_THRESHOLD",
        "AUTHORIZATION_REVOKED",
        "READ_ONLY_BILLING"
      ].includes(String(input.pausedReason))) ||
    (input.enabled && input.pausedReason !== undefined) ||
    !nonNegativeInteger(window.startMinute) ||
    Number(window.startMinute) > 1_439 ||
    !positiveInteger(window.endMinute, 1_440) ||
    Number(window.startMinute) >= Number(window.endMinute)
  ) {
    invalid();
  }
  let config;
  try {
    config = createTechnicalCrawlInput(input.config);
  } catch {
    return invalid();
  }
  return {
    id: input.id,
    workspaceId,
    projectId,
    name: input.name,
    timezone: input.timezone,
    schedule: schedule(input.schedule),
    allowedWindow: {
      startMinute: Number(window.startMinute),
      endMinute: Number(window.endMinute)
    },
    config: {
      ...config,
      purpose: "TECHNICAL_AUDIT",
      maxRuntimeSeconds: config.maxRuntimeSeconds ?? 3_600
    },
    failureThreshold: Number(input.failureThreshold),
    enabled: input.enabled,
    ...(input.pausedReason !== undefined
      ? {
          pausedReason:
            input.pausedReason as Exclude<
              CrawlAutomationSummary["pausedReason"],
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

export function scopedCrawlAutomationRuns(
  value: unknown,
  workspaceId: string,
  projectId: string,
  automationId: string
): CrawlAutomationRunCollection {
  const input = exactRecord(value, ["runs", "truncated"]);
  if (
    !Array.isArray(input.runs) ||
    input.runs.length > 50 ||
    typeof input.truncated !== "boolean"
  ) {
    invalid();
  }
  const runs = input.runs.map((run) =>
    scopedCrawlAutomationRun(run, workspaceId, projectId, automationId)
  );
  if (new Set(runs.map(({ id }) => id)).size !== runs.length) {
    invalid();
  }
  return { runs, truncated: input.truncated };
}

export function scopedCrawlAutomationRun(
  value: unknown,
  workspaceId: string,
  projectId: string,
  automationId: string
): CrawlAutomationRunSummary {
  const input = record(value);
  const optional = [
    ...(input.crawlId === undefined ? [] : ["crawlId"]),
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
    (input.crawlId !== undefined && !uuid(input.crawlId)) ||
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
    status: input.status as CrawlAutomationRunSummary["status"],
    trigger: input.trigger as CrawlAutomationRunSummary["trigger"],
    scheduledFor: input.scheduledFor,
    ...(input.crawlId === undefined ? {} : { crawlId: input.crawlId }),
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
  const hasCrawl = input.crawlId !== undefined;
  const hasJob = input.jobId !== undefined;
  const hasError = input.errorCode !== undefined;
  const hasStarted = input.startedAt !== undefined;
  const hasFinished = input.finishedAt !== undefined;
  return (
    (status === "RUNNING" &&
      hasStarted &&
      !hasCrawl &&
      !hasJob &&
      !hasError &&
      !hasFinished) ||
    (status === "DISPATCHED" &&
      hasStarted &&
      hasCrawl &&
      hasJob &&
      !hasError &&
      !hasFinished) ||
    (status === "SKIPPED" &&
      !hasStarted &&
      !hasCrawl &&
      !hasJob &&
      hasError &&
      hasFinished) ||
    (status === "FAILED" && hasStarted && hasError && hasFinished) ||
    (status === "COMPLETED" &&
      hasStarted &&
      hasCrawl &&
      hasJob &&
      !hasError &&
      hasFinished)
  );
}

function schedule(value: unknown): AutomationSchedule {
  const input = record(value);
  exactFields(
    input,
    input.cadence === "WEEKLY"
      ? ["cadence", "hour", "minute", "weekdays"]
      : ["cadence", "hour", "minute"]
  );
  if (
    !nonNegativeInteger(input.hour) ||
    Number(input.hour) > 23 ||
    !nonNegativeInteger(input.minute) ||
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
      (day) =>
        !Number.isSafeInteger(day) || Number(day) < 1 || Number(day) > 7
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
  const keys = Object.keys(input);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !keys.includes(field)) ||
    keys.some((field) => !fields.includes(field))
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
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  );
}

function positiveInteger(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER
): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= maximum
  );
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function iso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs service returned an invalid crawl automation response",
    retryable: true
  });
}
