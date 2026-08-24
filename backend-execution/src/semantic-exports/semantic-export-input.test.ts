import assert from "node:assert/strict";
import test from "node:test";
import {
  internalCancelSemanticExportInput,
  internalCreateSemanticExportInput
} from "./semantic-export-input.js";

const validCreate = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  idempotencyKey: "semantic-export:test",
  correlationId: "request-test",
  jobCapacity: {
    planCode: "PRO",
    planVersion: 1,
    concurrentJobs: 2
  },
  format: "XLSX",
  scope: "CURRENT_FILTER",
  locale: "ru",
  columns: ["query"],
  filters: { search: "слон" }
} as const;

test("accepts a canonical internal semantic export command", () => {
  assert.deepEqual(internalCreateSemanticExportInput(validCreate), validCreate);
});

test("accepts a canonical internal position-history export", () => {
  const input = {
    ...validCreate,
    positionHistory: {
      observedFrom: "2026-08-01T00:00:00.000Z",
      observedBefore: "2026-08-20T00:00:00.000Z",
      searchEngines: ["YANDEX", "GOOGLE"]
    }
  } as const;
  assert.deepEqual(internalCreateSemanticExportInput(input), input);
  assert.throws(
    () => internalCreateSemanticExportInput({ ...input, format: "CSV" }),
    /Invalid semantic export format/u
  );
});

test("accepts competitor data as ordinary export columns", () => {
  const input = {
    ...validCreate,
    format: "CSV",
    columns: [
      "query",
      "serpCompetitorUrls",
      "serpCompetitorSerp",
      "aiCompetitorUrls",
      "aiCompetitorSerp"
    ]
  } as const;
  assert.deepEqual(internalCreateSemanticExportInput(input), input);
  assert.throws(
    () => internalCreateSemanticExportInput({
      ...input,
      competitors: { sources: ["SERP"] }
    }),
    /Invalid semantic export body/u
  );
});

test("rejects unknown fields at every internal command boundary", () => {
  assert.throws(
    () => internalCreateSemanticExportInput({ ...validCreate, admin: true }),
    /Invalid semantic export body/u
  );
  assert.throws(
    () => internalCreateSemanticExportInput({
      ...validCreate,
      filters: { search: "слон", workspaceId: validCreate.workspaceId }
    }),
    /Invalid semantic export filters/u
  );
  assert.throws(
    () => internalCreateSemanticExportInput({
      ...validCreate,
      jobCapacity: { ...validCreate.jobCapacity, unlimited: true }
    }),
    /Invalid semantic export jobCapacity/u
  );
  assert.throws(
    () => internalCancelSemanticExportInput({
      workspaceId: validCreate.workspaceId,
      projectId: validCreate.projectId,
      actorId: validCreate.actorId,
      version: 1,
      status: "COMPLETED"
    }),
    /Invalid semantic export body/u
  );
});
