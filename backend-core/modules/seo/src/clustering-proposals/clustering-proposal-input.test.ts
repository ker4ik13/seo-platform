import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalApplyClusteringProposalInput,
  internalPersistClusteringProposalInput,
  internalResolveClusteringKeywordsInput
} from "./clustering-proposal-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";
const clusterId = "01900000-0000-7000-8000-000000000006";
const entitlement = {
  planCode: "PRO",
  planVersion: 1,
  storedKeywords: 10_000,
  keywordsPerProject: 5_000,
  foldersPerProject: 200,
  trackedContextPairs: 5_000
};

test("accepts an exact versioned clustering proposal", () => {
  const result = internalPersistClusteringProposalInput({
    workspaceId,
    projectId,
    actorId,
    jobId,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin-clustering@1.0.0",
    parameters: {
      searchEngine: "YANDEX",
      regionCode: "213",
      method: "SOFT",
      overlapCount: 3,
      depth: 20,
      excludeMainPages: false,
      stopDomains: [],
      frequencyTypes: ["OVERALL", "EXACT"],
      replaceExistingClusters: false
    },
    clusters: [{
      sequence: 0,
      providerKey: "divany",
      name: "  Диваны  ",
      topUrls: [{ url: "https://example.com/divany", overlapCount: 1 }]
    }],
    items: [{
      sequence: 0,
      keywordId,
      keywordVersion: 7,
      keywordText: "купить диван",
      clusterSequence: 0,
      frequency: "1200"
    }]
  });
  assert.equal(result.clusters[0]?.name, "Диваны");
  assert.equal(result.items[0]?.keywordVersion, 7);
});

test("requires contiguous sequences and proposal-scoped cluster references", () => {
  const base = {
    workspaceId,
    projectId,
    actorId,
    jobId,
    provider: "ARSENKIN",
    connectorVersion: "arsenkin-clustering@1.0.0",
    parameters: {
      searchEngine: "GOOGLE",
      regionCode: "2643",
      method: "HARD",
      overlapCount: 4,
      depth: 10,
      excludeMainPages: true,
      stopDomains: [],
      frequencyTypes: [],
      replaceExistingClusters: true
    },
    clusters: [{ sequence: 2, providerKey: "broken", name: "Broken", topUrls: [] }],
    items: [{ sequence: 0, keywordId, keywordVersion: 1, keywordText: "query", clusterSequence: 2 }]
  };
  assert.throws(() => internalPersistClusteringProposalInput(base), BadRequestException);
  assert.throws(() => internalPersistClusteringProposalInput({
    ...base,
    clusters: [{ sequence: 0, providerKey: "valid", name: "Valid", topUrls: [] }]
  }), BadRequestException);
});

test("keeps apply and keyword resolution tenant scoped", () => {
  assert.deepEqual(internalResolveClusteringKeywordsInput({
    workspaceId,
    projectId,
    actorId,
    items: [{ id: keywordId, version: 2 }]
  }).items, [{ id: keywordId, version: 2 }]);

  assert.equal(internalApplyClusteringProposalInput({
    workspaceId,
    projectId,
    actorId,
    jobId,
    proposalVersion: 1,
    excludedClusterIds: [],
    clusterNameOverrides: [{ proposalClusterId: clusterId, name: "Новый кластер" }],
    clusterAssignmentOverrides: [{ proposalClusterId: clusterId, action: "NEW" }],
    keywordGroupOverrides: [{ keywordId, groupId: clusterId }],
    clusterFolderOverrides: [{ proposalClusterId: clusterId, action: "KEEP" }],
    folderMode: "CREATE_SUBGROUPS",
    createUnclusteredGroup: true,
    entitlement
  }).folderMode, "CREATE_SUBGROUPS");

  assert.deepEqual(internalApplyClusteringProposalInput({
    workspaceId,
    projectId,
    actorId,
    jobId,
    proposalVersion: 2,
    excludedClusterIds: [],
    clusterNameOverrides: [],
    clusterAssignmentOverrides: [{
      proposalClusterId: clusterId,
      action: "EXISTING",
      clusterId: keywordId
    }],
    keywordGroupOverrides: [],
    clusterFolderOverrides: [{
      proposalClusterId: clusterId,
      action: "NEW",
      parentGroupId: clusterId
    }],
    folderMode: "CREATE_SUBGROUPS",
    createUnclusteredGroup: false,
    entitlement
  }).clusterFolderOverrides, [{
    proposalClusterId: clusterId,
    action: "NEW",
    parentGroupId: clusterId
  }]);

  assert.throws(() => internalApplyClusteringProposalInput({
    workspaceId,
    projectId,
    actorId,
    jobId,
    proposalVersion: 1,
    excludedClusterIds: [],
    clusterNameOverrides: [],
    clusterAssignmentOverrides: [],
    keywordGroupOverrides: [],
    clusterFolderOverrides: [],
    folderMode: "NONE",
    createUnclusteredGroup: true,
    entitlement
  }), BadRequestException);
  assert.throws(() => internalApplyClusteringProposalInput({
    workspaceId,
    projectId,
    actorId,
    jobId,
    proposalVersion: 1,
    excludedClusterIds: [],
    clusterNameOverrides: [],
    clusterAssignmentOverrides: [{
      proposalClusterId: clusterId,
      action: "NEW",
      clusterId: keywordId
    }],
    keywordGroupOverrides: [],
    clusterFolderOverrides: [],
    folderMode: "CREATE_SUBGROUPS",
    createUnclusteredGroup: false,
    entitlement
  }), BadRequestException);
});
