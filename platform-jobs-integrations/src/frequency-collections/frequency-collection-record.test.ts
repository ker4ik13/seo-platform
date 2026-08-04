import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "../generated/prisma/client.js";
import { frequencyCollectionSummary } from "./frequency-collection-record.js";

const now = new Date("2026-08-04T12:00:00.000Z");

test("projects the selected provider as successful after collection completion", () => {
  const summary = frequencyCollectionSummary(job({ status: "COMPLETED" }));
  assert.equal(summary.routingScope, "WORKSPACE_FALLBACK");
  assert.deepEqual(
    summary.connectorAttempts?.map(({ provider, outcome, reasonCode }) => ({
      provider,
      outcome,
      reasonCode
    })),
    [
      {
        provider: "XMLSTOCK",
        outcome: "FALLBACK",
        reasonCode: "LOW_BALANCE"
      },
      {
        provider: "ARSENKIN",
        outcome: "SUCCEEDED",
        reasonCode: undefined
      }
    ]
  );
});

test("projects the selected provider as failed with the persisted failure code", () => {
  const summary = frequencyCollectionSummary(
    job({
      status: "FAILED_FINAL",
      progressCurrent: 0n,
      errorSummary: { code: "PROVIDER_RESPONSE_INVALID", failed: 2 }
    })
  );
  assert.equal(summary.connectorAttempts?.at(-1)?.outcome, "FAILED");
  assert.equal(
    summary.connectorAttempts?.at(-1)?.reasonCode,
    "PROVIDER_RESPONSE_INVALID"
  );
});

test("rejects incomplete or non-contiguous connector provenance", () => {
  assert.throws(() =>
    frequencyCollectionSummary(
      job({ scopeSnapshot: { routingScope: "PROJECT_OVERRIDE" } })
    )
  );
  assert.throws(() =>
    frequencyCollectionSummary(
      job({
        scopeSnapshot: {
          routingScope: "PROJECT_OVERRIDE",
          connectorAttempts: [
            {
              sequence: 2,
              provider: "ARSENKIN",
              routingScope: "PROJECT_OVERRIDE",
              outcome: "SELECTED",
              occurredAt: now.toISOString()
            }
          ]
        }
      })
    )
  );
});

function job(overrides: Readonly<Record<string, unknown>> = {}): Job {
  return {
    id: "0190abcd-2000-7000-8000-000000000001",
    workspaceId: "0190abcd-2000-7000-8000-000000000002",
    projectId: "0190abcd-2000-7000-8000-000000000003",
    provider: "ARSENKIN",
    status: "COMPLETED",
    stage: "FINISHED",
    inputSnapshot: {
      types: ["BASE", "EXACT"],
      regionCode: "213",
      device: "ALL"
    },
    scopeSnapshot: {
      routingScope: "WORKSPACE_FALLBACK",
      connectorAttempts: [
        {
          sequence: 1,
          provider: "XMLSTOCK",
          routingScope: "PROJECT_OVERRIDE",
          outcome: "FALLBACK",
          reasonCode: "LOW_BALANCE",
          occurredAt: now.toISOString()
        },
        {
          sequence: 2,
          provider: "ARSENKIN",
          routingScope: "WORKSPACE_FALLBACK",
          outcome: "SELECTED",
          occurredAt: now.toISOString()
        }
      ]
    },
    progressTotal: 2n,
    progressCurrent: 2n,
    resultSummary: { failed: 0 },
    errorSummary: null,
    retryAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
    ...overrides
  } as unknown as Job;
}
