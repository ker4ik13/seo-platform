import { Prisma, type Automation } from "../generated/prisma/client.js";
import type {
  AutomationExecutionAccessSnapshot,
  AutomationSchedule,
  InternalCreateRankTrackingAutomationInput,
  InternalRankEstimateProjectSnapshot,
  InternalRunRankTrackingAutomationInput,
  InternalUpdateRankTrackingAutomationInput,
  RankTrackingAutomationSummary
} from "@seo-platform/contracts";
import { automationSchedule } from "./automation-input.js";

export const AUTOMATION_DEFINITION_SCHEMA =
  "rank-tracking-schedule@1";

export interface StoredAutomationDefinition {
  readonly schemaVersion: typeof AUTOMATION_DEFINITION_SCHEMA;
  readonly trackingContextId: string;
  readonly schedule: AutomationSchedule;
  readonly maxItems: number;
  readonly failureThreshold: number;
  readonly execution: {
    readonly actorId: string;
    readonly project: InternalRankEstimateProjectSnapshot;
    readonly access: AutomationExecutionAccessSnapshot;
    readonly billingCurrency: string;
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
    maxItems: input.maxItems,
    failureThreshold: input.failureThreshold,
    execution: {
      actorId: input.actorId,
      project: input.project,
      access: input.access,
      billingCurrency: input.billingCurrency
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
      billingCurrency: input.billingCurrency
    }
  };
}

export function storedAutomationDefinition(
  value: unknown
): StoredAutomationDefinition {
  const input = exactRecord(value, [
    "schemaVersion",
    "trackingContextId",
    "schedule",
    "maxItems",
    "failureThreshold",
    "execution"
  ]);
  if (
    input.schemaVersion !== AUTOMATION_DEFINITION_SCHEMA ||
    typeof input.trackingContextId !== "string" ||
    !UUID_PATTERN.test(input.trackingContextId) ||
    !Number.isSafeInteger(input.maxItems) ||
    Number(input.maxItems) < 1 ||
    Number(input.maxItems) > 1_000 ||
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
    "billingCurrency"
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
    !/^[A-Z]{3}$/u.test(execution.billingCurrency)
  ) {
    invalid();
  }
  return {
    schemaVersion: AUTOMATION_DEFINITION_SCHEMA,
    trackingContextId: input.trackingContextId,
    schedule: automationSchedule(input.schedule),
    maxItems: Number(input.maxItems),
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
      billingCurrency: execution.billingCurrency
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
    automation.pausedReason !== "FAILURE_THRESHOLD"
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
    maxItems: definition.maxItems,
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

function invalid(): never {
  throw new Error("Invalid stored rank tracking automation");
}
