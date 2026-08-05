import { DomainError, validationError } from "./domain-error.js";

export function requiredVersion(value: string | undefined): number {
  if (!value) {
    throw new DomainError({
      statusCode: 428,
      code: "VERSION_CONFLICT",
      message: "If-Match header is required"
    });
  }

  const match = /^(?:W\/)?"?v?(\d+)"?$/u.exec(value.trim());
  const version = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw validationError(
      "If-Match",
      "INVALID_VERSION",
      "Use an integer entity version, for example \"v3\""
    );
  }
  return version;
}
