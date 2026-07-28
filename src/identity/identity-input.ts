import type {
  LoginInput,
  RegisterAccountInput,
  ResendEmailVerificationInput,
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

const COMMON_PASSWORDS = new Set([
  "123456789012",
  "password1234",
  "qwerty123456",
  "administrator",
  "letmeinplease"
]);

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
