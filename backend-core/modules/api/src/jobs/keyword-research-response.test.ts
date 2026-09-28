import assert from "node:assert/strict";
import test from "node:test";
import { scopedKeywordResearchRun } from "./keyword-research-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";

test("public research projection keeps ready rows importable with a partial XMLStock warning", () => {
  const result = scopedKeywordResearchRun({
    id: "01900000-0000-7000-8000-000000000003",
    workspaceId,
    projectId,
    source: "XMLSTOCK_WORDSTAT",
    provider: "XMLSTOCK",
    regionCode: "0",
    device: "ALL",
    seedCount: 3,
    includeRightColumn: false,
    maxKeywords: 6_000,
    status: "READY_TO_IMPORT",
    collectedKeywords: 2,
    selectedKeywords: 0,
    importedKeywords: 0,
    rows: [],
    failureCode: "XMLSTOCK_OUTCOME_UNKNOWN",
    version: 4,
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:05:00.000Z"
  }, workspaceId, projectId);
  assert.equal(result.status, "READY_TO_IMPORT");
  assert.equal(result.failureCode, "XMLSTOCK_OUTCOME_UNKNOWN");
});
