import {
  semanticImportDuplicatePolicies,
  semanticImportDelimiters,
  semanticImportEncodings,
  semanticImportHeaderModes,
  semanticImportTargets,
  type ConfigureSemanticImportInput,
  type CreateSemanticImportInput,
  type SemanticImportDuplicatePolicy,
  type SemanticImportDelimiter,
  type SemanticImportEncoding,
  type SemanticImportHeaderMode,
  type SemanticImportMappingColumn,
  type SemanticImportTarget
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { inputObject } from "../common/input.js";

export function createSemanticImportInput(
  value: unknown
): CreateSemanticImportInput {
  const input = inputObject(value);
  if (typeof input.uploadId !== "string") invalid("uploadId");
  assertUuid(input.uploadId, "uploadId");
  const parse =
    input.parse === undefined ? {} : inputObject(input.parse);
  return {
    uploadId: input.uploadId,
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

export function configureSemanticImportInput(
  value: unknown,
  version: number
): ConfigureSemanticImportInput {
  const input = inputObject(value);
  if (!Array.isArray(input.columns)) invalid("columns");
  const columns = input.columns.map((item, index) =>
    mappingColumn(item, index)
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
  const defaultLanguage =
    input.defaultLanguage === undefined ? "und" : input.defaultLanguage;
  if (
    typeof defaultLanguage !== "string" ||
    (defaultLanguage !== "und" &&
      !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(defaultLanguage))
  ) {
    invalid("defaultLanguage");
  }
  const groupSeparator =
    input.groupSeparator === undefined ? "/" : input.groupSeparator;
  if (
    typeof groupSeparator !== "string" ||
    !groupSeparator.trim() ||
    groupSeparator.length > 8
  ) {
    invalid("groupSeparator");
  }
  return {
    version,
    columns,
    defaultLanguage,
    groupSeparator,
    duplicatePolicy: enumValue<SemanticImportDuplicatePolicy>(
      input.duplicatePolicy,
      semanticImportDuplicatePolicies,
      "SKIP_EXISTING",
      "duplicatePolicy"
    )
  };
}

function mappingColumn(
  value: unknown,
  index: number
): SemanticImportMappingColumn {
  const input = inputObject(value);
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
  const customName = input.customName;
  if (
    customName !== undefined &&
    (typeof customName !== "string" ||
      !customName.trim() ||
      customName.length > 160)
  ) {
    invalid(`columns.${index}.customName`);
  }
  if (target === "custom" && typeof customName !== "string") {
    invalid(`columns.${index}.customName`);
  }
  return {
    sourceIndex: Number(input.sourceIndex),
    target,
    ...(typeof customName === "string"
      ? { customName: customName.trim() }
      : {})
  };
}

function enumValue<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  fallback: Value,
  path: string
): Value {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    invalid(path);
  }
  return value as Value;
}

function invalid(path: string): never {
  throw validationError(path, "INVALID_VALUE", "Invalid import value");
}
