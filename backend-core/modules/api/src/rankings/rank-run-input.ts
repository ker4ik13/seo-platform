import type { CreateRankRunInput } from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";

const RANK_RUN_IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,180}$/u;

export function createRankRunInput(value: unknown): CreateRankRunInput {
  const input = exactRecord(value, [
    "estimateId",
    "confirmedPlatformChargeMicro"
  ]);
  if (typeof input.estimateId !== "string") {
    invalid("estimateId", "INVALID_IDENTIFIER", "A valid UUID is required");
  }
  if (
    typeof input.confirmedPlatformChargeMicro !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(input.confirmedPlatformChargeMicro) ||
    input.confirmedPlatformChargeMicro.length > 30
  ) {
    invalid(
      "confirmedPlatformChargeMicro",
      "INVALID_FORMAT",
      "A bounded confirmed charge is required"
    );
  }
  return {
    estimateId: assertUuid(input.estimateId, "estimateId"),
    confirmedPlatformChargeMicro: input.confirmedPlatformChargeMicro
  };
}

export function assertEmptyRankJobCancelInput(value: unknown): void {
  exactRecord(value, []);
}

export function requiredRankRunIdempotencyKey(
  value: string | undefined
): string {
  if (!value || !RANK_RUN_IDEMPOTENCY_PATTERN.test(value)) {
    invalid(
      "Idempotency-Key",
      "INVALID_IDEMPOTENCY_KEY",
      "A stable rank run idempotency key is required"
    );
  }
  return value;
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$", "INVALID_TYPE", "Must be an object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid("$", "UNKNOWN_FIELD", "Body fields do not match the contract");
  }
  return input;
}

function invalid(path: string, code: string, message: string): never {
  throw validationError(path, code, message);
}
