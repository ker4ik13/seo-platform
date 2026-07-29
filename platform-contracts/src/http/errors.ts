export const errorCodes = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "REAUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "VAPID_KEY_VERSION_CHANGED",
  "PUSH_SUBSCRIPTION_ALREADY_BOUND",
  "PUSH_DEVICE_LIMIT_REACHED",
  "EXPLICIT_ENABLE_REQUIRED",
  "WEB_PUSH_UNAVAILABLE",
  "RESOURCE_STATE_CONFLICT",
  "DUPLICATE",
  "IDEMPOTENCY_CONFLICT",
  "PAYMENT_REQUIRED",
  "FEATURE_NOT_AVAILABLE",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "PROVIDER_RATE_LIMITED",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "PROVIDER_UNAVAILABLE",
  "MAINTENANCE",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR"
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export interface FieldError {
  readonly path: string;
  readonly code: string;
  readonly message?: string;
}

export interface ApiError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly fieldErrors?: readonly FieldError[];
}

export interface ApiErrorResponse {
  readonly error: ApiError;
}
