import { BadRequestException } from "@nestjs/common";
import {
  keysSoDatabases,
  semanticImportDuplicatePolicies,
  type InternalCancelKeywordResearchRunInput,
  type InternalConfirmKeywordResearchRunInput,
  type InternalCreateKeywordResearchRunInput,
  type KeysSoDatabase,
  type SemanticCapacityEntitlement,
  type SemanticImportDuplicatePolicy
} from "@seo-platform/contracts";
import { jobCapacityInput } from "../jobs/job-capacity-input.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

export function internalCreateKeywordResearchRunInput(
  value: unknown
): InternalCreateKeywordResearchRunInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey",
    "correlationId",
    "domain",
    "database",
    "maxKeywords",
    "jobCapacity"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey: pattern(input.idempotencyKey, "idempotencyKey", KEY_PATTERN),
    correlationId: bounded(input.correlationId, "correlationId", 100),
    jobCapacity: jobCapacityInput(input.jobCapacity),
    domain: domain(input.domain),
    database: database(input.database),
    maxKeywords: integer(input.maxKeywords, "maxKeywords", 25, 500)
  };
}

export function internalConfirmKeywordResearchRunInput(
  value: unknown
): InternalConfirmKeywordResearchRunInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version",
    "selectedRowIds",
    "duplicatePolicy",
    "entitlement"
  ]);
  if (
    !Array.isArray(input.selectedRowIds) ||
    input.selectedRowIds.length < 1 ||
    input.selectedRowIds.length > 500
  ) {
    invalid("selectedRowIds");
  }
  const selectedRowIds = input.selectedRowIds.map((item, index) =>
    uuid(item, `selectedRowIds.${index}`)
  );
  if (new Set(selectedRowIds).size !== selectedRowIds.length) {
    invalid("selectedRowIds");
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    version: integer(input.version, "version", 1, Number.MAX_SAFE_INTEGER),
    selectedRowIds,
    duplicatePolicy: duplicatePolicy(input.duplicatePolicy),
    entitlement: entitlement(input.entitlement)
  };
}

export function internalCancelKeywordResearchRunInput(
  value: unknown
): InternalCancelKeywordResearchRunInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    version: integer(input.version, "version", 1, Number.MAX_SAFE_INTEGER)
  };
}

function domain(value: unknown): string {
  if (typeof value !== "string") invalid("domain");
  let normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  try {
    if (normalized.includes("://")) {
      const parsed = new URL(normalized);
      if (
        parsed.username ||
        parsed.password ||
        parsed.port ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        invalid("domain");
      }
      normalized = parsed.hostname;
    }
  } catch {
    invalid("domain");
  }
  if (!HOST_PATTERN.test(normalized)) invalid("domain");
  return normalized;
}

function database(value: unknown): KeysSoDatabase {
  if (
    typeof value !== "string" ||
    !keysSoDatabases.includes(value as KeysSoDatabase)
  ) {
    invalid("database");
  }
  return value as KeysSoDatabase;
}

function duplicatePolicy(value: unknown): SemanticImportDuplicatePolicy {
  if (
    typeof value !== "string" ||
    !semanticImportDuplicatePolicies.includes(
      value as SemanticImportDuplicatePolicy
    )
  ) {
    invalid("duplicatePolicy");
  }
  return value as SemanticImportDuplicatePolicy;
}

function entitlement(value: unknown): SemanticCapacityEntitlement {
  const input = record(value, [
    "planCode",
    "planVersion",
    "storedKeywords",
    "keywordsPerProject",
    "foldersPerProject",
    "trackedContextPairs"
  ]);
  return {
    planCode: bounded(input.planCode, "entitlement.planCode", 64),
    planVersion: integer(
      input.planVersion,
      "entitlement.planVersion",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    storedKeywords: integer(
      input.storedKeywords,
      "entitlement.storedKeywords",
      0,
      Number.MAX_SAFE_INTEGER
    ),
    keywordsPerProject: integer(
      input.keywordsPerProject,
      "entitlement.keywordsPerProject",
      0,
      Number.MAX_SAFE_INTEGER
    ),
    foldersPerProject: integer(
      input.foldersPerProject,
      "entitlement.foldersPerProject",
      0,
      Number.MAX_SAFE_INTEGER
    ),
    trackedContextPairs: integer(
      input.trackedContextPairs,
      "entitlement.trackedContextPairs",
      0,
      Number.MAX_SAFE_INTEGER
    )
  };
}

function record(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !fields.includes(key))) invalid("body");
  return input;
}

function uuid(value: unknown, field: string): string {
  return pattern(value, field, UUID_PATTERN).toLowerCase();
}

function pattern(
  value: unknown,
  field: string,
  expression: RegExp
): string {
  if (typeof value !== "string" || !expression.test(value)) invalid(field);
  return value;
}

function bounded(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) invalid(field);
  return normalized;
}

function integer(
  value: unknown,
  field: string,
  min: number,
  max: number
): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    invalid(field);
  }
  return Number(value);
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid keyword research field: ${field}`);
}
