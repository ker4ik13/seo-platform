import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  createIntegrationCredentialInput,
  internalCreateIntegrationCredentialInput,
  updateIntegrationCredentialInput
} from "./integration-credential-input.js";

test("requires the XMLStock account identifier and keeps secrets private", () => {
  assert.throws(
    () =>
      createIntegrationCredentialInput({
        provider: "XMLSTOCK",
        label: "Main",
        apiKey: "secret-api-key"
      }),
    BadRequestException
  );
  assert.deepEqual(
    createIntegrationCredentialInput({
      provider: "XMLSTOCK",
      label: " Main ",
      apiKey: " secret-api-key ",
      accountIdentifier: " 12345 "
    }),
    {
      provider: "XMLSTOCK",
      label: "Main",
      apiKey: "secret-api-key",
      accountIdentifier: "12345"
    }
  );
});

test("allows a label-only update and rejects whitespace in an API key", () => {
  assert.deepEqual(updateIntegrationCredentialInput({ label: "Renamed" }), {
    label: "Renamed"
  });
  assert.throws(
    () =>
      updateIntegrationCredentialInput({
        label: "Renamed",
        apiKey: "secret key"
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      updateIntegrationCredentialInput({
        label: "Renamed",
        accountIdentifier: "account-2"
      }),
    BadRequestException
  );
});

test("requires a bounded internal idempotency key", () => {
  const context = {
    workspaceId: "01900000-0000-7000-8000-000000000001",
    actorId: "01900000-0000-7000-8000-000000000002",
    provider: "KEYS_SO",
    label: "Primary",
    apiKey: "secret-api-key"
  };

  assert.equal(
    internalCreateIntegrationCredentialInput({
      ...context,
      idempotencyKey: "credential-create-001"
    }).idempotencyKey,
    "credential-create-001"
  );
  assert.throws(
    () => internalCreateIntegrationCredentialInput(context),
    BadRequestException
  );
});

test("canonicalizes UUIDs before AAD and idempotency fingerprinting", () => {
  const input = internalCreateIntegrationCredentialInput({
    workspaceId: "0190ABCD-0000-7000-8000-0000000000EF",
    actorId: "0190ABCD-0000-7000-8000-0000000000AA",
    idempotencyKey: "credential-create-uppercase",
    provider: "KEYS_SO",
    label: "Primary",
    apiKey: "secret-api-key"
  });

  assert.equal(
    input.workspaceId,
    "0190abcd-0000-7000-8000-0000000000ef"
  );
  assert.equal(input.actorId, "0190abcd-0000-7000-8000-0000000000aa");
});
