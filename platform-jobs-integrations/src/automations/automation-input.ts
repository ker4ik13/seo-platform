import { BadRequestException } from "@nestjs/common";
import type {
  AutomationCapacityEntitlement,
  AutomationExecutionAccessSnapshot,
  AutomationSchedule,
  InternalAutomationStatusInput,
  InternalCreateRankTrackingAutomationInput,
  InternalRankEstimateProjectSnapshot,
  InternalRunRankTrackingAutomationInput,
  InternalUpdateRankTrackingAutomationInput
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const PLAN_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/u;

export function internalCreateAutomationInput(
  value: unknown
): InternalCreateRankTrackingAutomationInput {
  const input = exactRecord(value, "body", [
    "name",
    "trackingContextId",
    "timezone",
    "schedule",
    "maxItems",
    "failureThreshold",
    "enabled",
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey",
    "project",
    "access",
    "billingCurrency",
    "entitlement"
  ]);
  const idempotencyKey = text(input.idempotencyKey, "idempotencyKey");
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    invalid("idempotencyKey");
  }
  return {
    ...automationFields(input),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey,
    project: projectSnapshot(input.project),
    access: accessSnapshot(input.access),
    billingCurrency: currency(input.billingCurrency),
    entitlement: automationCapacityEntitlement(input.entitlement)
  };
}

export function internalUpdateAutomationInput(
  value: unknown
): InternalUpdateRankTrackingAutomationInput {
  const input = exactRecord(value, "body", [
    "name",
    "trackingContextId",
    "timezone",
    "schedule",
    "maxItems",
    "failureThreshold",
    "enabled",
    "workspaceId",
    "projectId",
    "actorId",
    "automationId",
    "expectedVersion",
    "project",
    "access",
    "billingCurrency",
    "entitlement"
  ]);
  return {
    ...automationFields(input),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    automationId: uuid(input.automationId, "automationId"),
    expectedVersion: positiveInteger(
      input.expectedVersion,
      "expectedVersion"
    ),
    project: projectSnapshot(input.project),
    access: accessSnapshot(input.access),
    billingCurrency: currency(input.billingCurrency),
    entitlement: automationCapacityEntitlement(input.entitlement)
  };
}

export function internalAutomationStatusInput(
  value: unknown
): InternalAutomationStatusInput {
  const input = exactRecord(value, "body", [
    "workspaceId",
    "projectId",
    "actorId",
    "automationId",
    "expectedVersion",
    "project",
    "access",
    "billingCurrency",
    "entitlement"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    automationId: uuid(input.automationId, "automationId"),
    expectedVersion: positiveInteger(
      input.expectedVersion,
      "expectedVersion"
    ),
    project: projectSnapshot(input.project),
    access: accessSnapshot(input.access),
    billingCurrency: currency(input.billingCurrency),
    entitlement: automationCapacityEntitlement(input.entitlement)
  };
}

export function internalRunAutomationInput(
  value: unknown
): InternalRunRankTrackingAutomationInput {
  const input = exactRecord(value, "body", [
    "workspaceId",
    "projectId",
    "actorId",
    "automationId",
    "expectedVersion",
    "idempotencyKey",
    "project",
    "access",
    "billingCurrency"
  ]);
  const idempotencyKey = text(input.idempotencyKey, "idempotencyKey");
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    invalid("idempotencyKey");
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    automationId: uuid(input.automationId, "automationId"),
    expectedVersion: positiveInteger(
      input.expectedVersion,
      "expectedVersion"
    ),
    idempotencyKey,
    project: projectSnapshot(input.project),
    access: accessSnapshot(input.access),
    billingCurrency: currency(input.billingCurrency)
  };
}

export function automationSchedule(value: unknown): AutomationSchedule {
  const input = record(value, "schedule");
  const cadence = input.cadence;
  const fields =
    cadence === "WEEKLY"
      ? ["cadence", "hour", "minute", "weekdays"]
      : ["cadence", "hour", "minute"];
  exactFields(input, fields, "schedule");
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

export function automationCapacityEntitlement(
  value: unknown
): AutomationCapacityEntitlement {
  const input = exactRecord(value, "entitlement", [
    "planCode",
    "planVersion",
    "scheduledAutomations"
  ]);
  const planCode = text(input.planCode, "entitlement.planCode");
  if (!PLAN_CODE_PATTERN.test(planCode)) {
    invalid("entitlement.planCode");
  }
  return {
    planCode,
    planVersion: positiveInteger(
      input.planVersion,
      "entitlement.planVersion"
    ),
    scheduledAutomations: positiveInteger(
      input.scheduledAutomations,
      "entitlement.scheduledAutomations"
    )
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
    trackingContextId: uuid(
      input.trackingContextId,
      "trackingContextId"
    ),
    timezone,
    schedule: automationSchedule(input.schedule),
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

function projectSnapshot(
  value: unknown
): InternalRankEstimateProjectSnapshot {
  const input = exactRecord(value, "project", [
    "id",
    "workspaceId",
    "domain",
    "status",
    "version"
  ]);
  if (!["DRAFT", "ACTIVE", "ARCHIVED"].includes(String(input.status))) {
    invalid("project.status");
  }
  const domain = text(input.domain, "project.domain").toLowerCase();
  if (domain.length > 253) invalid("project.domain");
  return {
    id: uuid(input.id, "project.id"),
    workspaceId: uuid(input.workspaceId, "project.workspaceId"),
    domain,
    status: input.status as InternalRankEstimateProjectSnapshot["status"],
    version: positiveInteger(input.version, "project.version")
  };
}

function accessSnapshot(
  value: unknown
): AutomationExecutionAccessSnapshot {
  const input = exactRecord(value, "access", [
    "workspaceStatus",
    "membershipId",
    "membershipVersion",
    "canRunRanking",
    "entitlementStatus"
  ]);
  if (
    !["ACTIVE", "READ_ONLY", "SUSPENDED"].includes(
      String(input.workspaceStatus)
    )
  ) {
    invalid("access.workspaceStatus");
  }
  if (
    !["ALLOWED", "DENIED", "NOT_AVAILABLE"].includes(
      String(input.entitlementStatus)
    )
  ) {
    invalid("access.entitlementStatus");
  }
  return {
    workspaceStatus:
      input.workspaceStatus as AutomationExecutionAccessSnapshot["workspaceStatus"],
    membershipId: uuid(input.membershipId, "access.membershipId"),
    membershipVersion: positiveInteger(
      input.membershipVersion,
      "access.membershipVersion"
    ),
    canRunRanking: boolean(
      input.canRunRanking,
      "access.canRunRanking"
    ),
    entitlementStatus:
      input.entitlementStatus as AutomationExecutionAccessSnapshot["entitlementStatus"]
  };
}

function timeZone(value: unknown): string {
  const timezone = text(value, "timezone");
  if (
    timezone.length > 64 ||
    timezone.includes("\\") ||
    timezone.startsWith("/") ||
    timezone.endsWith("/")
  ) {
    invalid("timezone");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(
      new Date(0)
    );
  } catch {
    invalid("timezone");
  }
  return timezone;
}

function currency(value: unknown): string {
  const result = text(value, "billingCurrency").toUpperCase();
  if (!/^[A-Z]{3}$/u.test(result)) invalid("billingCurrency");
  return result;
}

function uuid(value: unknown, path: string): string {
  const result = text(value, path).toLowerCase();
  if (!UUID_PATTERN.test(result)) invalid(path);
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  return integer(value, path, 1, Number.MAX_SAFE_INTEGER);
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
  path: string,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value, path);
  exactFields(input, fields, path);
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
  throw new BadRequestException(`Invalid field: ${path}`);
}
