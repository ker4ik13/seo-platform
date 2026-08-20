import assert from "node:assert/strict";
import test from "node:test";
import {
  applyClusteringRunBodyLimit,
  CLUSTERING_RUN_BODY_LIMIT_BYTES
} from "./clustering-run-body-limit.js";

test("raises the body limit only for trusted clustering creation", () => {
  const create = {
    method: "POST",
    url: "/internal/v1/workspaces/:workspaceId/projects/:projectId/clustering-runs",
    bodyLimit: 1_048_576
  };
  const cancel = {
    method: "POST",
    url: "/internal/v1/workspaces/:workspaceId/projects/:projectId/clustering-runs/:jobId/cancel",
    bodyLimit: 1_048_576
  };

  applyClusteringRunBodyLimit(create);
  applyClusteringRunBodyLimit(cancel);

  assert.equal(create.bodyLimit, CLUSTERING_RUN_BODY_LIMIT_BYTES);
  assert.equal(cancel.bodyLimit, 1_048_576);
});
