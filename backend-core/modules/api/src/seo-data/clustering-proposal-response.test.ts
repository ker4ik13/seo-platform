import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  scopedInternalClusteringProposalResult,
  scopedInternalClusteringProposalSectionResult
} from "./clustering-proposal-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";
const proposalId = "01900000-0000-7000-8000-000000000004";
const clusterId = "01900000-0000-7000-8000-000000000005";
const keywordId = "01900000-0000-7000-8000-000000000006";
const timestamp = "2026-08-20T12:00:00.000Z";

function response() {
  const cluster = {
    id: clusterId,
    sequence: 0,
    name: "Диваны",
    keywordCount: 1,
    currentClusterKeywordCount: 0,
    topUrl: "https://example.com/divany",
    topUrls: [
      { url: "https://example.com/divany", overlapCount: 1 }
    ]
  };
  return {
    workspaceId,
    projectId,
    jobId,
    proposal: {
      id: proposalId,
      jobId,
      status: "READY",
      keywordCount: 1,
      clusterCount: 1,
      unclusteredCount: 0,
      readyCount: 1,
      protectedCount: 0,
      conflictedCount: 0,
      appliedKeywordCount: 0,
      createdGroupCount: 0,
      semanticVersionIds: [],
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    clusters: [cluster],
    rows: [{
      sequence: 0,
      keywordId,
      keyword: "купить диван",
      state: "READY",
      proposedCluster: cluster,
      frequency: "1200"
    }],
    page: { hasNext: false }
  };
}

test("accepts a scoped paginated clustering proposal", () => {
  const result = scopedInternalClusteringProposalResult(
    response(),
    workspaceId,
    projectId,
    jobId,
    200
  );
  assert.equal(result.proposal?.status, "READY");
  assert.equal(result.clusters[0]?.name, "Диваны");
  assert.equal(result.rows[0]?.proposedCluster?.id, clusterId);
});

test("preserves a changed-keyword conflict without treating an existing cluster as one", () => {
  const conflicted = response();
  const row = conflicted.rows[0]! as typeof conflicted.rows[number] & {
    conflictReason?: string;
    currentClusterName?: string;
  };
  row.state = "CONFLICTED";
  row.conflictReason = "KEYWORD_CHANGED";
  row.currentClusterName = "Старый SEO-кластер";
  conflicted.clusters[0]!.currentClusterKeywordCount = 1;

  const result = scopedInternalClusteringProposalResult(
    conflicted,
    workspaceId,
    projectId,
    jobId,
    200
  );

  assert.equal(
    result.rows[0]?.conflictReason,
    "KEYWORD_CHANGED"
  );
  assert.equal(result.rows[0]?.currentClusterName, "Старый SEO-кластер");
  assert.equal(result.clusters[0]?.currentClusterKeywordCount, 1);
});

test("rejects cross-proposal cluster references and inconsistent totals", () => {
  const foreign = response();
  foreign.rows[0]!.proposedCluster = {
    ...foreign.rows[0]!.proposedCluster,
    id: "01900000-0000-7000-8000-000000000099"
  };
  assert.throws(() => scopedInternalClusteringProposalResult(
    foreign,
    workspaceId,
    projectId,
    jobId,
    200
  ), DomainError);

  const inconsistent = response();
  inconsistent.proposal.keywordCount = 2;
  assert.throws(() => scopedInternalClusteringProposalResult(
    inconsistent,
    workspaceId,
    projectId,
    jobId,
    200
  ), DomainError);
});

test("accepts a cluster-scoped page with gaps in global sequence", () => {
  const result = scopedInternalClusteringProposalSectionResult(
    {
      workspaceId,
      projectId,
      jobId,
      sectionId: clusterId,
      rows: [
        {
          sequence: 14,
          keywordId,
          keyword: "купить диван",
          state: "READY"
        },
        {
          sequence: 20,
          keywordId: "01900000-0000-7000-8000-000000000007",
          keyword: "диван недорого",
          state: "READY"
        }
      ],
      page: { hasNext: true, nextCursor: "20" }
    },
    workspaceId,
    projectId,
    jobId,
    clusterId,
    2,
    "5"
  );

  assert.deepEqual(result.rows.map(({ sequence }) => sequence), [14, 20]);
  assert.equal(result.page.nextCursor, "20");
});

test("rejects a foreign or summary-bearing cluster section page", () => {
  const section = {
    workspaceId,
    projectId,
    jobId,
    sectionId: clusterId,
    rows: [{
      sequence: 0,
      keywordId,
      keyword: "купить диван",
      state: "READY",
      proposedCluster: response().clusters[0]
    }],
    page: { hasNext: false }
  };
  assert.throws(
    () => scopedInternalClusteringProposalSectionResult(
      section,
      workspaceId,
      projectId,
      jobId,
      clusterId,
      200
    ),
    DomainError
  );
  assert.throws(
    () => scopedInternalClusteringProposalSectionResult(
      { ...section, rows: [], sectionId: "unclustered" },
      workspaceId,
      projectId,
      jobId,
      clusterId,
      200
    ),
    DomainError
  );
});
