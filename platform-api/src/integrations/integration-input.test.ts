import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createIntegrationCredentialInput,
  updateIntegrationCredentialInput
} from "./integration-input.js";

test("validates provider-specific credential fields", () => {
  assert.throws(
    () =>
      createIntegrationCredentialInput({
        provider: "XMLSTOCK",
        label: "Main",
        apiKey: "secret-api-key"
      }),
    DomainError
  );
  assert.deepEqual(
    createIntegrationCredentialInput({
      provider: "KEYS_SO",
      label: " Primary ",
      apiKey: "api-token-123"
    }),
    {
      provider: "KEYS_SO",
      label: "Primary",
      apiKey: "api-token-123"
    }
  );
});

test("rejects surrounding whitespace instead of changing API key material", () => {
  assert.throws(
    () =>
      createIntegrationCredentialInput({
        provider: "KEYS_SO",
        label: "Primary",
        apiKey: " valid-api-key"
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED"
  );
  assert.throws(
    () =>
      updateIntegrationCredentialInput({
        label: "Primary",
        apiKey: "valid-api-key "
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED"
  );
});

test("accepts a label-only credential update", () => {
  assert.deepEqual(updateIntegrationCredentialInput({ label: "Renamed" }), {
    label: "Renamed"
  });
  assert.throws(
    () =>
      updateIntegrationCredentialInput({
        label: "Renamed",
        accountIdentifier: "account-2"
      }),
    DomainError
  );
});
