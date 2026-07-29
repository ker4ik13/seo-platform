import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  confirmTotpInput,
  disableTotpInput,
  loginInput,
  registerInput,
  requestPasswordResetInput,
  resetPasswordInput,
  verifyMfaChallengeInput
} from "./identity-input.js";

const validRegistration = {
  email: "User@example.com",
  password: "correct horse battery staple",
  displayName: "Test User",
  country: "ru",
  locale: "ru-RU",
  timezone: "Europe/Moscow",
  termsAccepted: true,
  termsVersion: "2026-07",
  privacyAccepted: true,
  privacyVersion: "2026-07",
  marketingAccepted: false,
  marketingVersion: "2026-07"
};

test("parses explicit registration consents", () => {
  const input = registerInput(validRegistration);

  assert.equal(input.email, "User@example.com");
  assert.equal(input.termsVersion, "2026-07");
  assert.equal(input.privacyVersion, "2026-07");
  assert.equal(input.marketingAccepted, false);
});

test("rejects registration without privacy consent", () => {
  assert.throws(
    () =>
      registerInput({
        ...validRegistration,
        privacyAccepted: false
      }),
    (error) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED" &&
      error.fieldErrors?.[0]?.path === "privacyAccepted"
  );
});

test("does not trim password material", () => {
  const password = "  long passphrase value  ";
  const input = loginInput({
    email: "user@example.com",
    password
  });

  assert.equal(input.password, password);
});

test("rejects a known common password", () => {
  assert.throws(
    () =>
      registerInput({
        ...validRegistration,
        password: "password1234"
      }),
    (error) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "PASSWORD_COMPROMISED"
  );
});

test("parses password reset request without normalizing the API contract", () => {
  assert.deepEqual(
    requestPasswordResetInput({ email: "User@example.com" }),
    { email: "User@example.com" }
  );
});

test("applies the strong password policy to password reset", () => {
  assert.throws(
    () =>
      resetPasswordInput({
        token: "a".repeat(64),
        password: "password1234"
      }),
    (error) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "PASSWORD_COMPROMISED"
  );
});

test("parses MFA verification and setup confirmation", () => {
  assert.deepEqual(
    verifyMfaChallengeInput({
      challengeToken: "x".repeat(43),
      code: "123456"
    }),
    {
      challengeToken: "x".repeat(43),
      code: "123456"
    }
  );
  assert.deepEqual(
    confirmTotpInput({
      methodId: "01900000-0000-7000-8000-000000000001",
      code: "123456"
    }),
    {
      methodId: "01900000-0000-7000-8000-000000000001",
      code: "123456"
    }
  );
});

test("preserves current password material when disabling MFA", () => {
  assert.equal(
    disableTotpInput({
      password: "  current password  ",
      code: "ABCD-2345-EFGH"
    }).password,
    "  current password  "
  );
});
