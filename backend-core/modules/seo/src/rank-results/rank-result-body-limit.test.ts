import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRankResultBodyLimit,
  RANK_RESULT_BODY_LIMIT_BYTES
} from "./rank-result-body-limit.js";

test("raises the body limit only for trusted rank result ingestion", () => {
  const result = {
    method: "POST",
    url: "/internal/v1/projects/:projectId/rank-manifests/:manifestId/chunks/:chunkIndex/results",
    bodyLimit: 1_048_576
  };
  const ordinary = {
    method: "POST",
    url: "/internal/v1/projects/:projectId/rank-manifests",
    bodyLimit: 1_048_576
  };
  const batch = {
    method: "POST",
    url: "/internal/v1/projects/:projectId/rank-manifests/:manifestId/chunks/results-batch",
    bodyLimit: 1_048_576
  };

  applyRankResultBodyLimit(result);
  applyRankResultBodyLimit(batch);
  applyRankResultBodyLimit(ordinary);

  assert.equal(result.bodyLimit, RANK_RESULT_BODY_LIMIT_BYTES);
  assert.equal(batch.bodyLimit, RANK_RESULT_BODY_LIMIT_BYTES);
  assert.equal(ordinary.bodyLimit, 1_048_576);
});
