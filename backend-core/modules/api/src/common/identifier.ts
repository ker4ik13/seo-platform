import { validationError } from "./domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assertUuid(value: string, path = "id"): string {
  if (!UUID_PATTERN.test(value)) {
    throw validationError(
      path,
      "INVALID_IDENTIFIER",
      "A valid UUID is required"
    );
  }
  return value.toLowerCase();
}
