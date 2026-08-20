import assert from "node:assert/strict";
import test from "node:test";
import {
  applyClusteringRunBodyLimit,
  CLUSTERING_RUN_BODY_LIMIT_BYTES
} from "./clustering-run-body-limit.js";

test("raises the body limit only for public clustering creation", () => {
  const create = {
    method: "POST",
    url: "/api/v1/projects/:projectId/clustering-runs",
    bodyLimit: 1_048_576
  };
  const result = {
    method: "POST",
    url: "/api/v1/projects/:projectId/clustering-runs/:jobId/result",
    bodyLimit: 1_048_576
  };

  applyClusteringRunBodyLimit(create);
  applyClusteringRunBodyLimit(result);

  assert.equal(create.bodyLimit, CLUSTERING_RUN_BODY_LIMIT_BYTES);
  assert.equal(result.bodyLimit, 1_048_576);
});
