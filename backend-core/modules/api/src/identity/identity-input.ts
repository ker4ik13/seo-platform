import type {
  ConfirmTotpInput,
  DisableTotpInput,
  LoginInput,
  RegisterAccountInput,
  RequestPasswordResetInput,
  ResendEmailVerificationInput,
  ResetPasswordInput,
  UserSessionListQuery,
  VerifyMfaChallengeInput,
  VerifyEmailInput
} from "@seo-platform/contracts";
import {
  booleanField,
  inputObject,
  optionalBooleanField,
  optionalStringField,
  stringField
} from "../common/input.js";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";

const COMMON_PASSWORDS = new Set([
  "123456789012",
  "password1234",
  "qwerty123456",
  "administrator",
  "letmeinplease"
]);
const USER_SESSION_CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,512}$/u;

export function registerInput(value: unknown): RegisterAccountInput {
  const input = inputObject(value);
  const password = passwordField(input, "password", true);
  const termsAccepted = booleanField(input, "termsAccepted");
  const privacyAccepted = booleanField(input, "privacyAccepted");

  if (!termsAccepted) {
    throw validationError(
      "termsAccepted",
      "CONSENT_REQUIRED",
      "Terms must be accepted"
    );
  }
  if (!privacyAccepted) {
    throw validationError(
      "privacyAccepted",
      "CONSENT_REQUIRED",
      "Privacy policy must be accepted"
    );
  }

  const marketingAccepted = optionalBooleanField(input, "marketingAccepted");
  const marketingVersion = optionalStringField(input, "marketingVersion", {
    min: 1,
    max: 64
  });
  const country = optionalStringField(input, "country", { min: 2, max: 2 });
  const locale = optionalStringField(input, "locale", { min: 2, max: 16 });
  const timezone = optionalStringField(input, "timezone", {
    min: 1,
    max: 64
  });
  if (marketingAccepted !== undefined && !marketingVersion) {
    throw validationError(
      "marketingVersion",
      "VERSION_REQUIRED",
      "Marketing consent version is required"
    );
  }

  return {
    email: stringField(input, "email", { min: 3, max: 320 }),
    password,
    displayName: stringField(input, "displayName", { min: 1, max: 160 }),
    ...(country ? { country } : {}),
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
    termsVersion: stringField(input, "termsVersion", { min: 1, max: 64 }),
    privacyVersion: stringField(input, "privacyVersion", { min: 1, max: 64 }),
    ...(marketingAccepted === undefined ? {} : { marketingAccepted }),
    ...(marketingVersion ? { marketingVersion } : {})
  };
}

export function loginInput(value: unknown): LoginInput {
  const input = inputObject(value);
  return {
    email: stringField(input, "email", { min: 3, max: 320 }),
    password: passwordField(input, "password", false)
  };
}

export function verifyEmailInput(value: unknown): VerifyEmailInput {
  const input = inputObject(value);
  return {
    token: stringField(input, "token", { min: 32, max: 256 })
  };
}

export function resendVerificationInput(
  value: unknown
): ResendEmailVerificationInput {
  const input = inputObject(value);
  return {
    email: stringField(input, "email", { min: 3, max: 320 })
  };
}

export function requestPasswordResetInput(
  value: unknown
): RequestPasswordResetInput {
  const input = inputObject(value);
  return {
    email: stringField(input, "email", { min: 3, max: 320 })
  };
}

export function resetPasswordInput(value: unknown): ResetPasswordInput {
  const input = inputObject(value);
  return {
    token: stringField(input, "token", { min: 32, max: 256 }),
    password: passwordField(input, "password", true)
  };
}

export function verifyMfaChallengeInput(
  value: unknown
): VerifyMfaChallengeInput {
  const input = inputObject(value);
  return {
    challengeToken: stringField(input, "challengeToken", {
      min: 32,
      max: 256
    }),
    code: stringField(input, "code", { min: 6, max: 32 })
  };
}

export function confirmTotpInput(value: unknown): ConfirmTotpInput {
  const input = inputObject(value);
  const methodId = stringField(input, "methodId", { min: 36, max: 36 });
  assertUuid(methodId, "methodId");
  return {
    methodId,
    code: stringField(input, "code", { min: 6, max: 6 })
  };
}

export function disableTotpInput(value: unknown): DisableTotpInput {
  const input = inputObject(value);
  return {
    password: passwordField(input, "password", false),
    code: stringField(input, "code", { min: 6, max: 32 })
  };
}

export function userSessionListQuery(value: unknown): UserSessionListQuery {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw validationError(
      "query",
      "OBJECT_REQUIRED",
      "Session list query must be an object"
    );
  }
  const query = value as Readonly<Record<string, unknown>>;
  const unsupported = Object.keys(query).find(
    (key) => key !== "limit" && key !== "cursor"
  );
  if (unsupported) {
    throw validationError(
      unsupported,
      "UNKNOWN_QUERY_PARAMETER",
      "Unknown session list query parameter"
    );
  }

  const rawLimit = optionalSingleQueryString(query.limit, "limit");
  const cursor = optionalSingleQueryString(query.cursor, "cursor");
  const limit = rawLimit === undefined ? 100 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw validationError(
      "limit",
      "OUT_OF_RANGE",
      "Session list limit must be an integer between 1 and 100"
    );
  }
  if (cursor !== undefined && !USER_SESSION_CURSOR_PATTERN.test(cursor)) {
    throw validationError(
      "cursor",
      "INVALID_CURSOR",
      "Session list cursor is invalid"
    );
  }
  return {
    limit,
    ...(cursor === undefined ? {} : { cursor })
  };
}

function optionalSingleQueryString(
  value: unknown,
  path: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(
      path,
      "SINGLE_VALUE_REQUIRED",
      "Query parameter must be a single non-empty string"
    );
  }
  return value.trim();
}

function passwordField(
  input: Readonly<Record<string, unknown>>,
  field: string,
  enforcePolicy: boolean
): string {
  const value = input[field];
  if (typeof value !== "string") {
    throw validationError(field, "STRING_REQUIRED", "A string is required");
  }
  const minimumLength = enforcePolicy ? 12 : 1;
  if (value.length < minimumLength) {
    throw validationError(
      field,
      "PASSWORD_TOO_SHORT",
      `Password must contain at least ${minimumLength} characters`
    );
  }
  if (value.length > 256) {
    throw validationError(
      field,
      "PASSWORD_TOO_LONG",
      "Password must contain at most 256 characters"
    );
  }
  if (
    enforcePolicy &&
    COMMON_PASSWORDS.has(value.normalize("NFKC").toLowerCase())
  ) {
    throw validationError(
      field,
      "PASSWORD_COMPROMISED",
      "Choose a password that is not commonly used"
    );
  }
  return value;
}
