import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "../generated/prisma/client.js";
import {
  INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
  INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
  integrationCredentialValidationDeduplicationKey,
  integrationCredentialValidationJobInput,
  integrationCredentialValidationRequestHash,
  toValidationSummary,
  validationRequestHashMatches
} from "./integration-credential-validation-job.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const credentialId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";

test("uses one stable active-validation key per credential material", () => {
  assert.notEqual(
    integrationCredentialValidationDeduplicationKey(
      credentialId,
      1
    ),
    integrationCredentialValidationDeduplicationKey(
      credentialId,
      2
    )
  );
  assert.equal(
    integrationCredentialValidationDeduplicationKey(credentialId, 1),
    `integration-credential-validation:${credentialId}:1`
  );
});

test("binds an idempotent validation request to its immutable command", () => {
  const first = integrationCredentialValidationRequestHash({
    workspaceId,
    actorId,
    credentialId
  });
  const replay = integrationCredentialValidationRequestHash({
    workspaceId,
    actorId,
    credentialId
  });
  const anotherActor = integrationCredentialValidationRequestHash({
    workspaceId,
    actorId: "01900000-0000-7000-8000-000000000004",
    credentialId
  });
  const anotherCredential = integrationCredentialValidationRequestHash({
    workspaceId,
    actorId,
    credentialId: "01900000-0000-7000-8000-000000000005"
  });

  assert.equal(validationRequestHashMatches(first, replay), true);
  assert.equal(validationRequestHashMatches(first, anotherActor), false);
  assert.equal(
    validationRequestHashMatches(first, anotherCredential),
    false
  );
  assert.equal(validationRequestHashMatches(null, replay), false);
});

test("maps a material race to an explicit stale validation", () => {
  const summary = toValidationSummary(
    validationJob({
      status: "FAILED_FINAL",
      errorSummary: { code: "CREDENTIAL_CHANGED" },
      startedAt: new Date("2026-07-29T09:00:01.000Z"),
      finishedAt: new Date("2026-07-29T09:00:02.000Z")
    })
  );

  assert.equal(summary.status, "STALE");
  assert.equal(summary.errorCode, "CREDENTIAL_CHANGED");
  assert.equal(summary.credentialMaterialVersion, 1);
});

test("keeps a scheduled retry non-terminal and exposes its deadline", () => {
  const retryAt = new Date("2026-07-29T09:00:30.000Z");
  const summary = toValidationSummary(
    validationJob({
      status: "RETRY_SCHEDULED",
      errorSummary: {
        code: "PROVIDER_RATE_LIMITED",
        retryable: true
      },
      retryAt
    })
  );

  assert.equal(summary.status, "RETRY_SCHEDULED");
  assert.equal(summary.retryAt, retryAt.toISOString());
});

test("rejects malformed validation snapshots", () => {
  assert.throws(
    () =>
      integrationCredentialValidationJobInput({
        kind: INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
        credentialId,
        credentialMaterialVersion: 0,
        connectorVersion: "keys-so@1.0.0"
      }),
    /Invalid integration credential validation job input/u
  );
});

function validationJob(overrides: Partial<Job> = {}): Job {
  const now = new Date("2026-07-29T09:00:00.000Z");
  return {
    id: "01900000-0000-7000-8000-000000000004",
    workspaceId,
    projectId: null,
    type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
    status: "QUEUED",
    stage: "credential_validation_queued",
    priority: 10,
    actorId,
    scheduleId: null,
    parentJobId: null,
    deduplicationKey:
      integrationCredentialValidationDeduplicationKey(
        credentialId,
        1
      ),
    idempotencyScope: `integration-credential-validation:${credentialId}`,
    idempotencyKey: "credential-validation-001",
    requestHash: Uint8Array.from(Buffer.alloc(32, 1)),
    inputSnapshot: {
      kind: INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
      credentialId,
      credentialMaterialVersion: 1,
      connectorVersion: "keys-so@1.0.0"
    },
    scopeSnapshot: { workspaceId, credentialId },
    progressCurrent: 0n,
    progressTotal: 1n,
    progressUnit: "credential",
    estimatedCostMicro: 0n,
    reservedCostMicro: null,
    actualCostMicro: null,
    currency: null,
    credentialMode: "BYOK_API_KEY",
    provider: "KEYS_SO",
    attempt: 0,
    maxAttempts: 3,
    errorSummary: null,
    resultSummary: null,
    correlationId: "request-validation-001",
    version: 1,
    createdAt: now,
    queuedAt: now,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    retryAt: null,
    updatedAt: now,
    ...overrides
  };
}
