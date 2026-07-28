import { BadRequestException } from "@nestjs/common";
import {
  semanticImportDelimiters,
  semanticImportEncodings,
  semanticImportHeaderModes,
  type InternalCreateSemanticImportInput,
  type SemanticImportDelimiter,
  type SemanticImportEncoding,
  type SemanticImportHeaderMode
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;

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
  field: string
): Value {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    invalid(field);
  }
  return value as Value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("A JSON object is required");
  }
  return value as Readonly<Record<string, unknown>>;
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

function invalid(field: string): never {
  throw new BadRequestException(`Invalid field: ${field}`);
}
