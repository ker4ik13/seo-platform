import { BadRequestException } from "@nestjs/common";
import { paidOperationAdmissionInput } from "../paid-operations/paid-operation-admission.js";
import {
  arsenkinWordstatExpansionResultLimit,
  arsenkinWordstatExpansionSeedLimit,
  keywordResearchRowPageDefaultSize,
  keywordResearchRowPageMaxSize,
  keysSoDatabases,
  semanticImportDuplicatePolicies,
  wordstatImportDistributionModes,
  wordstatExpansionDevices,
  type InternalCancelKeywordResearchRunInput,
  type InternalConfirmKeywordResearchRunInput,
  type InternalCreateKeywordResearchRunInput,
  type InternalRetryKeywordResearchImportInput,
  type KeysSoDatabase,
  type SemanticCapacityEntitlement,
  type SemanticImportDuplicatePolicy,
  type WordstatExpansionDevice
} from "@seo-platform/contracts";
import { jobCapacityInput } from "../jobs/job-capacity-input.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

export function keywordResearchRowsQuery(
  cursor: string | undefined,
  limit: string | undefined
): Readonly<{ cursor?: number; limit: number }> {
  const parsedCursor = cursor === undefined
    ? undefined
    : queryInteger(cursor, "cursor", 1, arsenkinWordstatExpansionResultLimit);
  return {
    ...(parsedCursor === undefined ? {} : { cursor: parsedCursor }),
    limit: limit === undefined
      ? keywordResearchRowPageDefaultSize
      : queryInteger(limit, "limit", 1, keywordResearchRowPageMaxSize)
  };
}

export function internalCreateKeywordResearchRunInput(
  value: unknown
): InternalCreateKeywordResearchRunInput {
  const commonFields = [
    "billing",
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey",
    "correlationId",
    "source",
    "jobCapacity"
  ] as const;
  const raw = object(value);
  const source = raw.source === undefined
    ? "KEYS_SO"
    : choice(
        raw.source,
        "source",
        ["KEYS_SO", "ARSENKIN_WORDSTAT", "XMLSTOCK_WORDSTAT"] as const
      );
  const fields = source === "KEYS_SO"
    ? [
        ...commonFields,
        ...(Object.hasOwn(raw, "credentialId") ? ["credentialId"] : []),
        "domain",
        "database",
        "maxKeywords"
      ]
    : [
        ...commonFields,
        ...(Object.hasOwn(raw, "credentialId") ? ["credentialId"] : []),
        "queries",
        "regionCode",
        "device",
        "minusWords",
        "clearMinusPhrases",
        "includeRightColumn",
        "clearPlus",
        "maxKeywords"
      ];
  const input = record(value, fields);
  const common = {
    ...paidOperationAdmissionInput(input.billing),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey: pattern(input.idempotencyKey, "idempotencyKey", KEY_PATTERN),
    correlationId: bounded(input.correlationId, "correlationId", 100),
    jobCapacity: jobCapacityInput(input.jobCapacity)
  };
  return source === "KEYS_SO"
    ? {
        ...common,
        source,
        ...(input.credentialId === undefined
          ? {}
          : { credentialId: uuid(input.credentialId, "credentialId") }),
        domain: domain(input.domain),
        database: database(input.database),
        maxKeywords: integer(input.maxKeywords, "maxKeywords", 25, 500)
      }
    : {
        ...common,
        source,
        ...(input.credentialId === undefined
          ? {}
          : { credentialId: uuid(input.credentialId, "credentialId") }),
        queries: phrases(
          input.queries,
          "queries",
          arsenkinWordstatExpansionSeedLimit,
          400
        ),
        regionCode: regionCode(input.regionCode),
        device: wordstatDevice(input.device),
        minusWords: phrases(input.minusWords, "minusWords", 100, 100, true),
        clearMinusPhrases: boolean(input.clearMinusPhrases, "clearMinusPhrases"),
        includeRightColumn: boolean(input.includeRightColumn, "includeRightColumn"),
        clearPlus: boolean(input.clearPlus, "clearPlus"),
        maxKeywords: integer(
          input.maxKeywords,
          "maxKeywords",
          1,
          arsenkinWordstatExpansionResultLimit
        )
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
    "selectionMode",
    "selectedRowIds",
    "excludedRowIds",
    "duplicatePolicy",
    "targetGroupPath",
    "rowDestinations",
    "distributionMode",
    "entitlement"
  ]);
  const selectionMode = input.selectionMode === undefined
    ? "SELECTED"
    : choice(
        input.selectionMode,
        "selectionMode",
        ["ALL", "SELECTED"] as const
      );
  const selectedRowIds = optionalIds(input.selectedRowIds, "selectedRowIds");
  const excludedRowIds = optionalIds(input.excludedRowIds, "excludedRowIds");
  if (selectionMode === "SELECTED" && selectedRowIds.length < 1) {
    invalid("selectedRowIds");
  }
  if (selectionMode === "ALL" && selectedRowIds.length > 0) {
    invalid("selectedRowIds");
  }
  if (selectionMode === "SELECTED" && excludedRowIds.length > 0) {
    invalid("excludedRowIds");
  }
  if (new Set(selectedRowIds).size !== selectedRowIds.length) {
    invalid("selectedRowIds");
  }
  const targetGroupPath = optionalBounded(
    input.targetGroupPath,
    "targetGroupPath",
    2_048
  );
  const rowDestinations = optionalRowDestinations(input.rowDestinations);
  const distributionMode = input.distributionMode === undefined
    ? "SINGLE_GROUP"
    : choice(
        input.distributionMode,
        "distributionMode",
        wordstatImportDistributionModes
      );
  if (
    selectionMode === "SELECTED" &&
    rowDestinations.some(({ rowId }) => !selectedRowIds.includes(rowId))
  ) {
    invalid("rowDestinations");
  }
  if (
    selectionMode === "ALL" &&
    rowDestinations.some(({ rowId }) => excludedRowIds.includes(rowId))
  ) {
    invalid("rowDestinations");
  }
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    version: integer(input.version, "version", 1, Number.MAX_SAFE_INTEGER),
    selectionMode,
    ...(selectedRowIds.length > 0 ? { selectedRowIds } : {}),
    ...(excludedRowIds.length > 0 ? { excludedRowIds } : {}),
    duplicatePolicy: duplicatePolicy(input.duplicatePolicy),
    ...(targetGroupPath ? { targetGroupPath } : {}),
    ...(rowDestinations.length > 0 ? { rowDestinations } : {}),
    distributionMode,
    entitlement: entitlement(input.entitlement)
  };
}

function optionalRowDestinations(
  value: unknown
): NonNullable<InternalConfirmKeywordResearchRunInput["rowDestinations"]> {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > arsenkinWordstatExpansionResultLimit
  ) {
    invalid("rowDestinations");
  }
  const destinations = value.map((item, index) => {
    const input = record(item, ["rowId", "targetGroupPath"]);
    return {
      rowId: uuid(input.rowId, `rowDestinations.${index}.rowId`),
      targetGroupPath: bounded(
        input.targetGroupPath,
        `rowDestinations.${index}.targetGroupPath`,
        2_048
      ).replace(/\s*\/\s*/gu, " / ")
    };
  });
  if (new Set(destinations.map(({ rowId }) => rowId)).size !== destinations.length) {
    invalid("rowDestinations");
  }
  return destinations;
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

export function internalRetryKeywordResearchImportInput(
  value: unknown
): InternalRetryKeywordResearchImportInput {
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

function wordstatDevice(value: unknown): WordstatExpansionDevice {
  return choice(value, "device", wordstatExpansionDevices);
}

function regionCode(value: unknown): string {
  return pattern(value, "regionCode", /^\d{1,10}$/u);
}

function phrases(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
  allowEmpty = false
): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length < 1) || value.length > maxItems) {
    invalid(field);
  }
  const result = value.map((item, index) => {
    if (typeof item !== "string") invalid(`${field}.${index}`);
    const normalized = item.trim().replace(/\s+/gu, " ");
    if (!normalized || normalized.length > maxLength) invalid(`${field}.${index}`);
    return normalized;
  });
  if (new Set(result.map((item) => item.toLocaleLowerCase("ru-RU"))).size !== result.length) {
    invalid(field);
  }
  return result;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function choice<const T extends readonly string[]>(
  value: unknown,
  field: string,
  choices: T
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) invalid(field);
  return value as T[number];
}

function optionalIds(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > arsenkinWordstatExpansionResultLimit) {
    invalid(field);
  }
  const ids = value.map((item, index) => uuid(item, `${field}.${index}`));
  if (new Set(ids).size !== ids.length) invalid(field);
  return ids;
}

function optionalBounded(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return bounded(value, field, max).replace(/\s*\/\s*/gu, " / ");
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

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  return value as Readonly<Record<string, unknown>>;
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

function queryInteger(
  value: string,
  field: string,
  min: number,
  max: number
): number {
  if (!/^\d+$/u.test(value)) invalid(field);
  return integer(Number(value), field, min, max);
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid keyword research field: ${field}`);
}
