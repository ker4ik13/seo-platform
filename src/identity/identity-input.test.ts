import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { loginInput, registerInput } from "./identity-input.js";

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
