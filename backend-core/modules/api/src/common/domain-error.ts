import type { ErrorCode, FieldError } from "@seo-platform/contracts";

interface DomainErrorOptions {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly fieldErrors?: readonly FieldError[];
}

export class DomainError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly details: Readonly<Record<string, unknown>> | undefined;
  public readonly fieldErrors: readonly FieldError[] | undefined;

  public constructor(options: DomainErrorOptions) {
    super(options.message);
    this.name = "DomainError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.fieldErrors = options.fieldErrors;
  }
}

export function validationError(
  path: string,
  code: string,
  message: string
): DomainError {
  return new DomainError({
    statusCode: 422,
    code: "VALIDATION_FAILED",
    message: "Request validation failed",
    fieldErrors: [{ path, code, message }]
  });
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
