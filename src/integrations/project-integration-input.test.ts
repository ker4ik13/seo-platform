import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createProjectConnectorBindingInput,
  updateProjectConnectorBindingInput
} from "./project-integration-input.js";

const credentialId = "01900000-0000-7000-8000-000000000003";

test("parses an explicit workspace credential binding", () => {
  assert.deepEqual(
    createProjectConnectorBindingInput({
      capability: "SERP_RANK_TRACKING",
      enabled: true,
      route: {
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId: credentialId.toUpperCase()
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "DISABLED" }
    }),
    {
      capability: "SERP_RANK_TRACKING",
      enabled: true,
      route: {
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "DISABLED" }
    }
  );
});

test("keeps the binding capability immutable on update", () => {
  assert.throws(
    () =>
      updateProjectConnectorBindingInput({
        capability: "SERP_COLLECTION",
        enabled: false,
        route: {
          position: 0,
          sourceKind: "WORKSPACE_CREDENTIAL",
          credentialId
        },
        fallbackPolicy: { mode: "NONE" },
        budgetPolicy: { mode: "DISABLED" }
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED"
  );
});

test("rejects unavailable platform, fallback and budget policies honestly", () => {
  for (const input of [
    {
      capability: "SERP_COLLECTION",
      enabled: true,
      route: {
        position: 0,
        sourceKind: "PLATFORM_CREDENTIAL",
        credentialId
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "DISABLED" }
    },
    {
      capability: "SERP_COLLECTION",
      enabled: true,
      route: {
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId
      },
      fallbackPolicy: { mode: "FIRST_AVAILABLE" },
      budgetPolicy: { mode: "DISABLED" }
    },
    {
      capability: "SERP_COLLECTION",
      enabled: true,
      route: {
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "PLATFORM_SPEND" }
    }
  ]) {
    assert.throws(
      () => createProjectConnectorBindingInput(input),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "FEATURE_NOT_AVAILABLE"
    );
  }
});

test("rejects malformed identifiers and unknown fields", () => {
  for (const input of [
    null,
    {
      capability: "SERP_COLLECTION",
      enabled: true,
      extra: true,
      route: {
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "DISABLED" }
    },
    {
      capability: "SERP_COLLECTION",
      enabled: true,
      route: {
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId: "not-a-uuid"
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "DISABLED" }
    }
  ]) {
    assert.throws(
      () => createProjectConnectorBindingInput(input),
      DomainError
    );
  }
});
