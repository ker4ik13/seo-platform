import { BadRequestException } from "@nestjs/common";
import {
  semanticImportDuplicatePolicies,
  semanticImportDelimiters,
  semanticImportEncodings,
  semanticImportHeaderModes,
  semanticImportTargets,
  type InternalCancelSemanticImportInput,
  type InternalConfigureSemanticImportInput,
  type InternalConfirmSemanticImportInput,
  type InternalCreateSemanticImportInput,
  type SemanticImportDuplicatePolicy,
  type SemanticImportDelimiter,
  type SemanticImportEncoding,
  type SemanticImportHeaderMode,
  type SemanticImportMappingColumn,
  type SemanticImportTarget,
  type SemanticCapacityEntitlement
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";
import { jobCapacityInput } from "../jobs/job-capacity-input.js";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const PLAN_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/u;

export function internalCreateSemanticImportInput(
  value: unknown
): InternalCreateSemanticImportInput {
  const input = record(value);
  const parse =
    input.parse === undefined ? {} : record(input.parse);
  const idempotencyKey = string(input, "idempotencyKey");
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    invalid("idempotencyKey");
  }
  return {
    workspaceId: uuid(input, "workspaceId"),
    projectId: uuid(input, "projectId"),
    actorId: uuid(input, "actorId"),
    uploadId: uuid(input, "uploadId"),
    idempotencyKey,
    jobCapacity: jobCapacityInput(input.jobCapacity),
    parse: {
      encoding: enumValue<SemanticImportEncoding>(
        parse.encoding,
        semanticImportEncodings,
        "AUTO",
        "parse.encoding"
      ),
      delimiter: enumValue<SemanticImportDelimiter>(
        parse.delimiter,
        semanticImportDelimiters,
        "AUTO",
        "parse.delimiter"
      ),
      headerMode: enumValue<SemanticImportHeaderMode>(
        parse.headerMode,
        semanticImportHeaderModes,
        "AUTO",
        "parse.headerMode"
      )
    }
  };
}

export function internalConfigureSemanticImportInput(
  value: unknown
): InternalConfigureSemanticImportInput {
  const input = record(value);
  const columns = array(input.columns, "columns").map((value, index) =>
    mappingColumn(value, index)
  );
  if (columns.length === 0 || columns.length > 500) invalid("columns");
  if (
    new Set(columns.map(({ sourceIndex }) => sourceIndex)).size !==
    columns.length
  ) {
    invalid("columns.sourceIndex");
  }
  if (
    columns.filter(({ target }) => target === "keyword.text").length !== 1
  ) {
    invalid("columns.keyword.text");
  }
  const singletonTargets = columns
    .map(({ target }) => target)
    .filter((target) => !["custom", "ignore"].includes(target));
  if (new Set(singletonTargets).size !== singletonTargets.length) {
    invalid("columns.target");
  }
  const groupSeparator =
    input.groupSeparator === undefined
      ? "/"
      : string(input, "groupSeparator");
  if (groupSeparator.length > 8) invalid("groupSeparator");
  const defaultLanguage =
    input.defaultLanguage === undefined
      ? "und"
      : string(input, "defaultLanguage");
  if (
    defaultLanguage !== "und" &&
    !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(defaultLanguage)
  ) {
    invalid("defaultLanguage");
  }
  return {
    workspaceId: uuid(input, "workspaceId"),
    projectId: uuid(input, "projectId"),
    actorId: uuid(input, "actorId"),
    version: positiveVersion(input.version),
    columns,
    defaultLanguage,
    groupSeparator,
    duplicatePolicy: enumValue<SemanticImportDuplicatePolicy>(
      input.duplicatePolicy,
      semanticImportDuplicatePolicies,
      "MERGE_NON_EMPTY",
      "duplicatePolicy"
    ),
    createMissingKeywords: booleanValue(
      input.createMissingKeywords,
      false,
      "createMissingKeywords"
    )
  };
}

export function internalConfirmSemanticImportInput(
  value: unknown
): InternalConfirmSemanticImportInput {
  const input = record(value);
  return {
    ...versionedContext(input),
    entitlement: semanticCapacityEntitlement(input.entitlement)
  };
}

export function internalCancelSemanticImportInput(
  value: unknown
): InternalCancelSemanticImportInput {
  const input = record(value);
  return {
    workspaceId: uuid(input, "workspaceId"),
    projectId: uuid(input, "projectId"),
    actorId: uuid(input, "actorId"),
    ...(input.version === undefined
      ? {}
      : { version: positiveVersion(input.version) })
  };
}

function versionedContext(
  value: unknown
): {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
} {
  const input = record(value);
  return {
    workspaceId: uuid(input, "workspaceId"),
    projectId: uuid(input, "projectId"),
    actorId: uuid(input, "actorId"),
    version: positiveVersion(input.version)
  };
}

function semanticCapacityEntitlement(
  value: unknown
): SemanticCapacityEntitlement {
  const input = record(value);
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "planCode",
          "planVersion",
          "storedKeywords",
          "keywordsPerProject",
          "foldersPerProject",
          "trackedContextPairs"
        ].includes(key)
    ) ||
    typeof input.planCode !== "string" ||
    !PLAN_CODE_PATTERN.test(input.planCode)
  ) {
    invalid("entitlement");
  }
  return {
    planCode: input.planCode,
    planVersion: positiveVersion(input.planVersion),
    storedKeywords: nonNegativeVersion(input.storedKeywords),
    keywordsPerProject: nonNegativeVersion(input.keywordsPerProject),
    foldersPerProject: nonNegativeVersion(input.foldersPerProject),
    trackedContextPairs: nonNegativeVersion(input.trackedContextPairs)
  };
}

function nonNegativeVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid("entitlement");
  return Number(value);
}

function mappingColumn(
  value: unknown,
  index: number
): SemanticImportMappingColumn {
  const input = record(value);
  if (
    !Number.isSafeInteger(input.sourceIndex) ||
    Number(input.sourceIndex) < 0
  ) {
    invalid(`columns.${index}.sourceIndex`);
  }
  const target = enumValue<SemanticImportTarget>(
    input.target,
    semanticImportTargets,
    "ignore",
    `columns.${index}.target`
  );
  const customName =
    input.customName === undefined
      ? undefined
      : string(input, "customName");
  if (customName && customName.length > 160) {
    invalid(`columns.${index}.customName`);
  }
  if (target === "custom" && !customName) {
    invalid(`columns.${index}.customName`);
  }
  return {
    sourceIndex: Number(input.sourceIndex),
    target,
    ...(customName ? { customName } : {})
  };
}

function enumValue<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  fallback: Value,
  field: string
): Value {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    invalid(field);
  }
  return value as Value;
}

function booleanValue(
  value: unknown,
  fallback: boolean,
  field: string
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("A JSON object is required");
  }
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(field);
  return value;
}

function string(
  input: Readonly<Record<string, unknown>>,
  field: string
): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function uuid(
  input: Readonly<Record<string, unknown>>,
  field: string
): string {
  return internalUuid(string(input, field), field);
}

function positiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalid("version");
  }
  return Number(value);
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid field: ${field}`);
}
