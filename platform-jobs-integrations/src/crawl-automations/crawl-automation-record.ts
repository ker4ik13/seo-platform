import type {
  CrawlAllowedWindow,
  CrawlAutomationRunSummary,
  CrawlAutomationSummary,
  InternalCreateCrawlAutomationInput,
  InternalUpdateCrawlAutomationInput,
  TechnicalCrawlConfig
} from "@seo-platform/contracts";
import {
  Prisma,
  type CrawlAutomation,
  type CrawlAutomationRun
} from "../generated/prisma/client.js";
import { automationSchedule } from "../automations/automation-input.js";
import { storedCrawlConfig } from "../crawls/crawl-record.js";

export const CRAWL_AUTOMATION_DEFINITION_SCHEMA =
  "technical-crawl-schedule@1";

export interface StoredCrawlAutomationDefinition {
  readonly schemaVersion: typeof CRAWL_AUTOMATION_DEFINITION_SCHEMA;
  readonly schedule: ReturnType<typeof automationSchedule>;
  readonly allowedWindow: CrawlAllowedWindow;
  readonly config: TechnicalCrawlConfig;
  readonly failureThreshold: number;
  readonly actorId: string;
}

export function crawlAutomationDefinition(
  input:
    | InternalCreateCrawlAutomationInput
    | InternalUpdateCrawlAutomationInput
): StoredCrawlAutomationDefinition {
  return {
    schemaVersion: CRAWL_AUTOMATION_DEFINITION_SCHEMA,
    schedule: input.schedule,
    allowedWindow: input.allowedWindow,
    config: input.config,
    failureThreshold: input.failureThreshold,
    actorId: input.actorId
  };
}

export function crawlAutomationDefinitionJson(
  value: StoredCrawlAutomationDefinition
): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

export function storedCrawlAutomationDefinition(
  value: unknown
): StoredCrawlAutomationDefinition {
  const input = exactRecord(value, [
    "schemaVersion",
    "schedule",
    "allowedWindow",
    "config",
    "failureThreshold",
    "actorId"
  ]);
  const allowedWindow = exactRecord(input.allowedWindow, [
    "startMinute",
    "endMinute"
  ]);
  if (
    input.schemaVersion !== CRAWL_AUTOMATION_DEFINITION_SCHEMA ||
    typeof input.actorId !== "string" ||
    !UUID_PATTERN.test(input.actorId) ||
    !Number.isSafeInteger(input.failureThreshold) ||
    Number(input.failureThreshold) < 1 ||
    Number(input.failureThreshold) > 10 ||
    !Number.isSafeInteger(allowedWindow.startMinute) ||
    Number(allowedWindow.startMinute) < 0 ||
    Number(allowedWindow.startMinute) > 1_439 ||
    !Number.isSafeInteger(allowedWindow.endMinute) ||
    Number(allowedWindow.endMinute) < 1 ||
    Number(allowedWindow.endMinute) > 1_440 ||
    Number(allowedWindow.startMinute) >= Number(allowedWindow.endMinute)
  ) {
    invalid();
  }
  let config: TechnicalCrawlConfig;
  try {
    config = storedCrawlConfig(input.config as Prisma.JsonValue);
  } catch {
    return invalid();
  }
  return {
    schemaVersion: CRAWL_AUTOMATION_DEFINITION_SCHEMA,
    schedule: automationSchedule(input.schedule),
    allowedWindow: {
      startMinute: Number(allowedWindow.startMinute),
      endMinute: Number(allowedWindow.endMinute)
    },
    config,
    failureThreshold: Number(input.failureThreshold),
    actorId: input.actorId
  };
}

export function toCrawlAutomationSummary(
  automation: CrawlAutomation
): CrawlAutomationSummary {
  const definition = storedCrawlAutomationDefinition(
    automation.definition
  );
  if (
    automation.pausedReason !== null &&
    ![
      "MANUAL",
      "FAILURE_THRESHOLD",
      "AUTHORIZATION_REVOKED",
      "READ_ONLY_BILLING"
    ].includes(automation.pausedReason)
  ) {
    invalid();
  }
  return {
    id: automation.id,
    workspaceId: automation.workspaceId,
    projectId: automation.projectId,
    name: automation.name,
    timezone: automation.timezone,
    schedule: definition.schedule,
    allowedWindow: definition.allowedWindow,
    config: definition.config,
    failureThreshold: definition.failureThreshold,
    enabled: automation.enabled,
    ...(automation.pausedReason
      ? {
          pausedReason:
            automation.pausedReason as Exclude<
              CrawlAutomationSummary["pausedReason"],
              undefined
            >
        }
      : {}),
    ...(automation.nextRunAt
      ? { nextRunAt: automation.nextRunAt.toISOString() }
      : {}),
    ...(automation.lastRunAt
      ? { lastRunAt: automation.lastRunAt.toISOString() }
      : {}),
    consecutiveErrors: automation.consecutiveErr,
    version: automation.version,
    createdAt: automation.createdAt.toISOString(),
    updatedAt: automation.updatedAt.toISOString()
  };
}

export function toCrawlAutomationRunSummary(
  run: CrawlAutomationRun
): CrawlAutomationRunSummary {
  return {
    id: run.id,
    automationId: run.automationId,
    automationVersion: run.automationVersion,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    status: run.status,
    trigger: run.trigger,
    scheduledFor: run.scheduledFor.toISOString(),
    ...(run.crawlId ? { crawlId: run.crawlId } : {}),
    ...(run.jobId ? { jobId: run.jobId } : {}),
    ...(run.errorCode ? { errorCode: run.errorCode } : {}),
    ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}),
    ...(run.finishedAt
      ? { finishedAt: run.finishedAt.toISOString() }
      : {}),
    createdAt: run.createdAt.toISOString()
  };
}

export function sameCrawlAutomationCommand(
  automation: CrawlAutomation,
  input: InternalCreateCrawlAutomationInput
): boolean {
  return (
    automation.projectId === input.projectId &&
    automation.name === input.name &&
    automation.timezone === input.timezone &&
    automation.enabled === input.enabled &&
    JSON.stringify(
      storedCrawlAutomationDefinition(automation.definition)
    ) === JSON.stringify(crawlAutomationDefinition(input))
  );
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(input);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !keys.includes(field)) ||
    keys.some((field) => !fields.includes(field))
  ) {
    invalid();
  }
  return input;
}

function invalid(): never {
  throw new TypeError("Stored crawl automation is invalid");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
