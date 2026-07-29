import assert from "node:assert/strict";
import test from "node:test";
import {
  BadRequestException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  internalCreateProjectConnectorBindingInput,
  internalUpdateProjectConnectorBindingInput
} from "./project-connector-binding-input.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const actorId = "0190abcd-0000-7000-8000-000000000003";
const credentialId = "0190abcd-0000-7000-8000-000000000004";

const createBody = {
  workspaceId,
  projectId,
  actorId,
  idempotencyKey: "binding-create-001",
  capability: "SERP_COLLECTION",
  enabled: true,
  route: {
    position: 0,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId
  },
  fallbackPolicy: { mode: "NONE" },
  budgetPolicy: { mode: "DISABLED" }
} as const;

test("parses a complete canonical project binding command", () => {
  assert.deepEqual(
    internalCreateProjectConnectorBindingInput({
      ...createBody,
      workspaceId: workspaceId.toUpperCase(),
      projectId: projectId.toUpperCase(),
      actorId: actorId.toUpperCase(),
      route: {
        ...createBody.route,
        credentialId: credentialId.toUpperCase()
      }
    }),
    createBody
  );

  assert.deepEqual(
    internalUpdateProjectConnectorBindingInput({
      workspaceId,
      projectId,
      actorId,
      version: 2,
      enabled: false,
      route: createBody.route,
      fallbackPolicy: createBody.fallbackPolicy,
      budgetPolicy: createBody.budgetPolicy
    }),
    {
      workspaceId,
      projectId,
      actorId,
      version: 2,
      enabled: false,
      route: createBody.route,
      fallbackPolicy: createBody.fallbackPolicy,
      budgetPolicy: createBody.budgetPolicy
    }
  );
});

test("rejects unknown and missing fields instead of silently ignoring them", () => {
  assert.throws(
    () =>
      internalCreateProjectConnectorBindingInput({
        ...createBody,
        primaryCredentialId: credentialId
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalCreateProjectConnectorBindingInput({
        ...createBody,
        route: {
          ...createBody.route,
          secret: "must-not-be-accepted"
        }
      }),
    BadRequestException
  );
  const { budgetPolicy: _budgetPolicy, ...missing } = createBody;
  assert.throws(
    () => internalCreateProjectConnectorBindingInput(missing),
    BadRequestException
  );
});

test("honestly rejects platform, fallback and budget features", () => {
  for (const body of [
    {
      ...createBody,
      route: {
        ...createBody.route,
        sourceKind: "PLATFORM_CREDENTIAL"
      }
    },
    {
      ...createBody,
      route: { ...createBody.route, position: 1 }
    },
    {
      ...createBody,
      fallbackPolicy: { mode: "ON_RETRYABLE_ERROR" }
    },
    {
      ...createBody,
      budgetPolicy: { mode: "MONTHLY_LIMIT" }
    }
  ]) {
    assert.throws(
      () => internalCreateProjectConnectorBindingInput(body),
      (error: unknown) => {
        assert.ok(error instanceof UnprocessableEntityException);
        assert.equal(
          (
            error.getResponse() as Readonly<Record<string, unknown>>
          ).code,
          "FEATURE_NOT_AVAILABLE"
        );
        return true;
      }
    );
  }
});
