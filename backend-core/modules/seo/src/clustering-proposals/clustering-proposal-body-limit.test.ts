import assert from "node:assert/strict";
import test from "node:test";
import {
  applyClusteringProposalBodyLimit,
  CLUSTERING_PROPOSAL_BODY_LIMIT_BYTES
} from "./clustering-proposal-body-limit.js";

test("raises the body limit only for trusted clustering proposal ingestion", () => {
  const proposal = {
    method: "POST",
    url: "/internal/v1/projects/:projectId/clustering-proposals",
    bodyLimit: 1_048_576
  };
  const apply = {
    method: "POST",
    url: "/internal/v1/projects/:projectId/clustering-proposals/:jobId/apply",
    bodyLimit: 1_048_576
  };

  applyClusteringProposalBodyLimit(proposal);
  applyClusteringProposalBodyLimit(apply);

  assert.equal(proposal.bodyLimit, CLUSTERING_PROPOSAL_BODY_LIMIT_BYTES);
  assert.equal(apply.bodyLimit, 1_048_576);
});
