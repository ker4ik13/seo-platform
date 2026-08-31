import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createIntegrationCredentialInput,
  enablePlatformIntegrationCredentialInput,
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

test("enables only the two token-paid rank providers", () => {
  assert.deepEqual(
    enablePlatformIntegrationCredentialInput({ provider: "XMLSTOCK" }),
    { provider: "XMLSTOCK" }
  );
  assert.deepEqual(
    enablePlatformIntegrationCredentialInput({ provider: "ARSENKIN" }),
    { provider: "ARSENKIN" }
  );
  for (const value of [
    { provider: "KEYS_SO" },
    { provider: "XMLSTOCK", apiKey: "must-not-be-accepted" },
    {}
  ]) {
    assert.throws(() => enablePlatformIntegrationCredentialInput(value), DomainError);
  }
});
