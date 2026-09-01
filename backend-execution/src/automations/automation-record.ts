import { Prisma, type Automation } from "../generated/prisma/client.js";
import type {
  AutomationExecutionAccessSnapshot,
  RankTrackingAutomationSchedule,
  InternalCreateRankTrackingAutomationInput,
  InternalRankEstimateProjectSnapshot,
  InternalRunRankTrackingAutomationInput,
  InternalUpdateRankTrackingAutomationInput,
  RankTrackingAutomationSummary
} from "@seo-platform/contracts";
import { rankAutomationSchedule } from "./automation-input.js";

export const AUTOMATION_DEFINITION_SCHEMA =
  "rank-tracking-schedule@3";
const PREVIOUS_AUTOMATION_DEFINITION_SCHEMA =
  "rank-tracking-schedule@2";
const LEGACY_AUTOMATION_DEFINITION_SCHEMA =
  "rank-tracking-schedule@1";

export interface StoredAutomationDefinition {
  readonly schemaVersion: typeof AUTOMATION_DEFINITION_SCHEMA;
  readonly trackingContextId: string;
  readonly schedule: RankTrackingAutomationSchedule;
  readonly maxPlatformChargeMicro: string;
  readonly failureThreshold: number;
  readonly execution: {
    readonly actorId: string;
    readonly project: InternalRankEstimateProjectSnapshot;
    readonly access: AutomationExecutionAccessSnapshot;
    readonly billingCurrency: string;
    readonly jobCapacity: InternalCreateRankTrackingAutomationInput["jobCapacity"];
  };
}

export function automationDefinition(
  input:
    | InternalCreateRankTrackingAutomationInput
    | InternalUpdateRankTrackingAutomationInput
): StoredAutomationDefinition {
  return {
    schemaVersion: AUTOMATION_DEFINITION_SCHEMA,
    trackingContextId: input.trackingContextId,
    schedule: input.schedule,
    maxPlatformChargeMicro: input.maxPlatformChargeMicro,
    failureThreshold: input.failureThreshold,
    execution: {
      actorId: input.actorId,
      project: input.project,
      access: input.access,
      billingCurrency: input.billingCurrency,
      jobCapacity: input.jobCapacity
    }
  };
}

export function automationDefinitionJson(
  definition: StoredAutomationDefinition
): Prisma.InputJsonValue {
  return definition as unknown as Prisma.InputJsonValue;
}

export function automationRunDefinition(
  value: unknown,
  input: InternalRunRankTrackingAutomationInput
): StoredAutomationDefinition {
  const definition = storedAutomationDefinition(value);
  return {
    ...definition,
    execution: {
      actorId: input.actorId,
      project: input.project,
      access: input.access,
      billingCurrency: input.billingCurrency,
      jobCapacity: input.jobCapacity
    }
  };
}

export function storedAutomationDefinition(
  value: unknown
): StoredAutomationDefinition {
  const envelope = record(value);
  const schemaVersion = envelope.schemaVersion;
  const legacy = schemaVersion === LEGACY_AUTOMATION_DEFINITION_SCHEMA;
  const previous =
    schemaVersion === PREVIOUS_AUTOMATION_DEFINITION_SCHEMA;
  const current = schemaVersion === AUTOMATION_DEFINITION_SCHEMA;
  if (!legacy && !previous && !current) invalid();
  const input = exactRecord(value, [
    "schemaVersion",
    "trackingContextId",
    "schedule",
    ...(legacy || previous ? ["maxItems"] : []),
    ...(legacy ? [] : ["maxPlatformChargeMicro"]),
    "failureThreshold",
    "execution"
  ]);
  if (
    typeof input.trackingContextId !== "string" ||
    !UUID_PATTERN.test(input.trackingContextId) ||
    ((legacy || previous) &&
      (!Number.isSafeInteger(input.maxItems) ||
        Number(input.maxItems) < 1 ||
        Number(input.maxItems) > 1_000)) ||
    (!legacy && !validMoneyLimit(input.maxPlatformChargeMicro)) ||
    !Number.isSafeInteger(input.failureThreshold) ||
    Number(input.failureThreshold) < 1 ||
    Number(input.failureThreshold) > 10
  ) {
    invalid();
  }
  const execution = exactRecord(input.execution, [
    "actorId",
    "project",
    "access",
    "billingCurrency",
    "jobCapacity"
  ]);
  const project = exactRecord(execution.project, [
    "id",
    "workspaceId",
    "domain",
    "status",
    "version"
  ]);
  const access = exactRecord(execution.access, [
    "workspaceStatus",
    "membershipId",
    "membershipVersion",
    "canRunRanking",
    "entitlementStatus"
  ]);
  const jobCapacity = exactRecord(
    execution.jobCapacity ?? {
      planCode: "LEGACY",
      planVersion: 1,
      concurrentJobs: 1
    },
    ["planCode", "planVersion", "concurrentJobs"]
  );
  if (
    typeof execution.actorId !== "string" ||
    !UUID_PATTERN.test(execution.actorId) ||
    typeof project.id !== "string" ||
    !UUID_PATTERN.test(project.id) ||
    typeof project.workspaceId !== "string" ||
    !UUID_PATTERN.test(project.workspaceId) ||
    typeof project.domain !== "string" ||
    project.domain.length < 1 ||
    project.domain.length > 253 ||
    !["DRAFT", "ACTIVE", "ARCHIVED"].includes(String(project.status)) ||
    !Number.isSafeInteger(project.version) ||
    Number(project.version) < 1 ||
    !["ACTIVE", "READ_ONLY", "SUSPENDED"].includes(
      String(access.workspaceStatus)
    ) ||
    typeof access.membershipId !== "string" ||
    !UUID_PATTERN.test(access.membershipId) ||
    !Number.isSafeInteger(access.membershipVersion) ||
    Number(access.membershipVersion) < 1 ||
    typeof access.canRunRanking !== "boolean" ||
    !["ALLOWED", "DENIED", "NOT_AVAILABLE"].includes(
      String(access.entitlementStatus)
    ) ||
    typeof execution.billingCurrency !== "string" ||
    !/^[A-Z]{3}$/u.test(execution.billingCurrency) ||
    typeof jobCapacity.planCode !== "string" ||
    jobCapacity.planCode.length < 1 ||
    jobCapacity.planCode.length > 64 ||
    !Number.isSafeInteger(jobCapacity.planVersion) ||
    Number(jobCapacity.planVersion) < 1 ||
    !Number.isSafeInteger(jobCapacity.concurrentJobs) ||
    Number(jobCapacity.concurrentJobs) < 1
  ) {
    invalid();
  }
  return {
    schemaVersion: AUTOMATION_DEFINITION_SCHEMA,
    trackingContextId: input.trackingContextId,
    schedule: rankAutomationSchedule(input.schedule),
    maxPlatformChargeMicro: legacy
      ? "0"
      : String(input.maxPlatformChargeMicro),
    failureThreshold: Number(input.failureThreshold),
    execution: {
      actorId: execution.actorId,
      project: {
        id: project.id,
        workspaceId: project.workspaceId,
        domain: project.domain,
        status:
          project.status as InternalRankEstimateProjectSnapshot["status"],
        version: Number(project.version)
      },
      access: {
        workspaceStatus:
          access.workspaceStatus as AutomationExecutionAccessSnapshot["workspaceStatus"],
        membershipId: access.membershipId,
        membershipVersion: Number(access.membershipVersion),
        canRunRanking: access.canRunRanking,
        entitlementStatus:
          access.entitlementStatus as AutomationExecutionAccessSnapshot["entitlementStatus"]
      },
      billingCurrency: execution.billingCurrency,
      jobCapacity: {
        planCode: jobCapacity.planCode,
        planVersion: Number(jobCapacity.planVersion),
        concurrentJobs: Number(jobCapacity.concurrentJobs)
      }
    }
  };
}

export function toAutomationSummary(
  automation: Automation
): RankTrackingAutomationSummary {
  const definition = storedAutomationDefinition(automation.definition);
  if (
    automation.pausedReason !== null &&
    automation.pausedReason !== "MANUAL" &&
    automation.pausedReason !== "FAILURE_THRESHOLD" &&
    automation.pausedReason !== "ONE_TIME_COMPLETED"
  ) {
    invalid();
  }
  return {
    id: automation.id,
    workspaceId: automation.workspaceId,
    projectId: automation.projectId,
    name: automation.name,
    trackingContextId: definition.trackingContextId,
    timezone: automation.timezone,
    schedule: definition.schedule,
    maxPlatformChargeMicro: definition.maxPlatformChargeMicro,
    failureThreshold: definition.failureThreshold,
    enabled: automation.enabled,
    ...(automation.pausedReason
      ? {
          pausedReason:
            automation.pausedReason as Exclude<
              RankTrackingAutomationSummary["pausedReason"],
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

export function sameAutomationCommand(
  automation: Automation,
  input: InternalCreateRankTrackingAutomationInput
): boolean {
  return (
    automation.projectId === input.projectId &&
    automation.name === input.name &&
    automation.timezone === input.timezone &&
    automation.enabled === input.enabled &&
    JSON.stringify(storedAutomationDefinition(automation.definition)) ===
      JSON.stringify(automationDefinition(input))
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value);
  if (
    Object.keys(input).length !== fields.length ||
    fields.some((field) => !(field in input)) ||
    Object.keys(input).some((field) => !fields.includes(field))
  ) {
    invalid();
  }
  return input;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function validMoneyLimit(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d{0,29})$/u.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n
  );
}

function invalid(): never {
  throw new Error("Invalid stored rank tracking automation");
}
