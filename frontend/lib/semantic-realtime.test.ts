import assert from "node:assert/strict";
import test from "node:test";
import { semanticMutationProjectId } from "./semantic-realtime.ts";

const projectId = "0198f258-8cc7-7abc-8def-1234567890ab";
const keywordId = "0198f258-8cc7-7abc-8def-1234567890ac";

test("detects committed semantic mutations that require reconciliation", () => {
  for (const [method, resource] of [
    ["POST", "keywords"],
    ["POST", "keywords/bulk"],
    ["PATCH", `keywords/${keywordId}`],
    ["DELETE", `keywords/${keywordId}`],
    ["POST", "keyword-groups"],
    ["PATCH", `keyword-groups/${keywordId}`],
    ["PATCH", "semantic-group-color-legend"],
    ["POST", "bulk-commands"],
    ["POST", "negative-keywords/apply"],
    ["POST", "semantic-duplicates/apply"],
    ["POST", `clustering-runs/${keywordId}/apply`],
    ["POST", `keyword-research-runs/${keywordId}/confirm`],
    ["POST", "clusters"],
    ["POST", `semantic-versions/${keywordId}/undo`]
  ] as const) {
    assert.equal(
      semanticMutationProjectId(
        `/app/api/projects/${projectId}/${resource}`,
        method
      ),
      projectId
    );
  }

  assert.equal(
    semanticMutationProjectId(
      `/app/api/v1/projects/${projectId}/keyword-research-runs/${keywordId}/confirm`,
      "POST"
    ),
    projectId
  );
});

test("does not announce reads, previews or unrelated project commands", () => {
  for (const [method, resource] of [
    ["GET", "keywords"],
    ["POST", "keywords/list"],
    ["POST", "keywords/operation-scope"],
    ["POST", "keywords/search"],
    ["POST", "keywords/bulk-preview"],
    ["POST", "bulk-commands/clean-preview"],
    ["POST", "negative-keywords/preview"],
    ["POST", "clusters/split-preview"],
    ["POST", "frequency-collections"],
    ["PATCH", "semantic-saved-views/view-id"],
    ["POST", "semantic-group-color-legend/seen"]
  ] as const) {
    assert.equal(
      semanticMutationProjectId(
        `/app/api/projects/${projectId}/${resource}`,
        method
      ),
      undefined
    );
  }
});
