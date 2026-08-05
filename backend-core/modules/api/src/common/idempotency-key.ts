import { validationError } from "./domain-error.js";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;

export function requiredIdempotencyKey(
  value: string | undefined
): string {
  if (!value || !IDEMPOTENCY_PATTERN.test(value)) {
    throw validationError(
      "Idempotency-Key",
      "INVALID_IDEMPOTENCY_KEY",
      "A stable idempotency key is required"
    );
  }
  return value;
}
