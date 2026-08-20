import assert from "node:assert/strict";
import test from "node:test";
import { arsenkinClusteringKeywordLimit } from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import {
  applyClusteringProposalInput,
  clusteringCancelInput,
  clusteringIdempotencyKey,
  clusteringProposalRejectInput,
  createClusteringRunInput
} from "./clustering-run-input.js";

const keywordId = "01900000-0000-7000-8000-000000000001";
const clusterId = "01900000-0000-7000-8000-000000000002";
const groupId = "01900000-0000-7000-8000-000000000003";

test("uses the documented Arsenkin limit of 300,000 keywords", () => {
  assert.equal(arsenkinClusteringKeywordLimit, 300_000);
});

test("accepts and canonicalizes an Arsenkin clustering command", () => {
  assert.deepEqual(createClusteringRunInput({
    items: [{ id: keywordId, version: 4 }],
    searchEngine: "YANDEX",
    regionCode: "213",
    method: "SOFT",
    overlapCount: 3,
    depth: 20,
    excludeMainPages: true,
    stopDomains: ["WWW.OZON.RU"],
    frequencyTypes: ["OVERALL", "EXACT"],
    replaceExistingClusters: false
  }), {
    items: [{ id: keywordId, version: 4 }],
    searchEngine: "YANDEX",
    regionCode: "213",
    method: "SOFT",
    overlapCount: 3,
    depth: 20,
    excludeMainPages: true,
    stopDomains: ["ozon.ru"],
    frequencyTypes: ["OVERALL", "EXACT"],
    replaceExistingClusters: false
  });
  assert.equal(clusteringIdempotencyKey("clustering-command-1"), "clustering-command-1");
  assert.deepEqual(clusteringCancelInput({}), {});
});

test("validates proposal application as an explicit folder plan", () => {
  assert.deepEqual(applyClusteringProposalInput({
    proposalVersion: 2,
    excludedClusterIds: [],
    clusterNameOverrides: [{ proposalClusterId: clusterId, name: "  Диваны   для дома " }],
    clusterAssignmentOverrides: [{
      proposalClusterId: clusterId,
      action: "EXISTING",
      clusterId: keywordId
    }],
    keywordGroupOverrides: [{ keywordId, groupId }],
    clusterFolderOverrides: [{ proposalClusterId: clusterId, action: "EXISTING", groupId }],
    folderMode: "CREATE_SUBGROUPS",
    parentGroupId: groupId,
    createUnclusteredGroup: true
  }), {
    proposalVersion: 2,
    excludedClusterIds: [],
    clusterNameOverrides: [{ proposalClusterId: clusterId, name: "Диваны для дома" }],
    clusterAssignmentOverrides: [{
      proposalClusterId: clusterId,
      action: "EXISTING",
      clusterId: keywordId
    }],
    keywordGroupOverrides: [{ keywordId, groupId }],
    clusterFolderOverrides: [{ proposalClusterId: clusterId, action: "EXISTING", groupId }],
    folderMode: "CREATE_SUBGROUPS",
    parentGroupId: groupId,
    createUnclusteredGroup: true
  });
  assert.deepEqual(clusteringProposalRejectInput({ proposalVersion: 2 }), { proposalVersion: 2 });
  assert.deepEqual(applyClusteringProposalInput({
    proposalVersion: 3,
    excludedClusterIds: [],
    clusterNameOverrides: [],
    clusterAssignmentOverrides: [{ proposalClusterId: clusterId, action: "NEW" }],
    keywordGroupOverrides: [],
    clusterFolderOverrides: [{
      proposalClusterId: clusterId,
      action: "NEW",
      parentGroupId: groupId
    }],
    folderMode: "CREATE_SUBGROUPS",
    createUnclusteredGroup: false
  }).clusterFolderOverrides, [{
    proposalClusterId: clusterId,
    action: "NEW",
    parentGroupId: groupId
  }]);
  assert.throws(() => applyClusteringProposalInput({
    proposalVersion: 2,
    excludedClusterIds: [],
    clusterNameOverrides: [],
    clusterAssignmentOverrides: [],
    keywordGroupOverrides: [],
    clusterFolderOverrides: [],
    folderMode: "NONE",
    parentGroupId: groupId,
    createUnclusteredGroup: false
  }), DomainError);
  assert.throws(() => applyClusteringProposalInput({
    proposalVersion: 2,
    excludedClusterIds: [],
    clusterNameOverrides: [],
    clusterAssignmentOverrides: [],
    keywordGroupOverrides: [],
    clusterFolderOverrides: [{
      proposalClusterId: clusterId,
      action: "KEEP",
      parentGroupId: groupId
    }],
    folderMode: "CREATE_SUBGROUPS",
    createUnclusteredGroup: false
  }), DomainError);
  assert.throws(() => applyClusteringProposalInput({
    proposalVersion: 2,
    excludedClusterIds: [],
    clusterNameOverrides: [],
    clusterAssignmentOverrides: [{
      proposalClusterId: clusterId,
      action: "EXISTING"
    }],
    keywordGroupOverrides: [],
    clusterFolderOverrides: [],
    folderMode: "CREATE_SUBGROUPS",
    createUnclusteredGroup: false
  }), DomainError);
});

test("rejects duplicated keywords and unsupported provider parameters", () => {
  const input = {
    items: [{ id: keywordId, version: 1 }, { id: keywordId, version: 1 }],
    searchEngine: "YANDEX",
    regionCode: "213",
    method: "SOFT",
    overlapCount: 3,
    depth: 20,
    excludeMainPages: false,
    stopDomains: [],
    frequencyTypes: [],
    replaceExistingClusters: false
  };
  assert.throws(() => createClusteringRunInput(input), DomainError);
  assert.throws(() => createClusteringRunInput({ ...input, items: input.items.slice(0, 1), depth: 100 }), DomainError);
  assert.throws(() => clusteringCancelInput({ force: true }), DomainError);
});
