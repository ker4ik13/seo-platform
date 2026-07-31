import assert from "node:assert/strict";
import test from "node:test";
import {
  internalConfirmKeywordResearchRunInput,
  internalCreateKeywordResearchRunInput
} from "./keyword-research-input.js";

const WORKSPACE_ID = "01900000-0000-7000-8000-000000000001";
const PROJECT_ID = "01900000-0000-7000-8000-000000000002";
const ACTOR_ID = "01900000-0000-7000-8000-000000000003";
const ROW_ID = "01900000-0000-7000-8000-000000000004";

test("normalizes a trusted Keys.so research command", () => {
  assert.deepEqual(
    internalCreateKeywordResearchRunInput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      idempotencyKey: "keyword-research-001",
      correlationId: "request-001",
      domain: "https://Example.RU/",
      database: "msk",
      maxKeywords: 100
    }),
    {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      idempotencyKey: "keyword-research-001",
      correlationId: "request-001",
      domain: "example.ru",
      database: "msk",
      maxKeywords: 100
    }
  );
});

test("accepts only explicit selected rows and current entitlement", () => {
  assert.deepEqual(
    internalConfirmKeywordResearchRunInput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      version: 4,
      selectedRowIds: [ROW_ID],
      duplicatePolicy: "SKIP_EXISTING",
      entitlement: {
        planCode: "PRO",
        planVersion: 2,
        storedKeywords: 100_000,
        keywordsPerProject: 50_000,
        trackedContextPairs: 10_000
      }
    }).selectedRowIds,
    [ROW_ID]
  );
});

test("rejects an URL path and duplicate row selection", () => {
  assert.throws(() =>
    internalCreateKeywordResearchRunInput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      idempotencyKey: "keyword-research-001",
      correlationId: "request-001",
      domain: "https://example.ru/catalog",
      database: "msk",
      maxKeywords: 100
    })
  );
  assert.throws(() =>
    internalConfirmKeywordResearchRunInput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      version: 4,
      selectedRowIds: [ROW_ID, ROW_ID],
      duplicatePolicy: "SKIP_EXISTING",
      entitlement: {
        planCode: "PRO",
        planVersion: 2,
        storedKeywords: 100_000,
        keywordsPerProject: 50_000,
        trackedContextPairs: 10_000
      }
    })
  );
});
