import {
  semanticImportDelimiters,
  semanticImportEncodings,
  semanticImportHeaderModes,
  type CreateSemanticImportInput,
  type SemanticImportDelimiter,
  type SemanticImportEncoding,
  type SemanticImportHeaderMode
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
