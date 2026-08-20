import assert from "node:assert/strict";
import test from "node:test";
import {
  rememberClusterFolderAction,
  rememberClusterFolderDestination,
  serializeClusterFolderOverride
} from "./semantic-clustering-folder-decision.ts";

const parentGroupId = "01900000-0000-7000-8000-000000000010";
const existingGroupId = "01900000-0000-7000-8000-000000000011";
const proposalClusterId = "01900000-0000-7000-8000-000000000012";

test("folder destinations survive every clustering select mode change", () => {
  let decision = rememberClusterFolderDestination({ action: "NEW" }, parentGroupId);
  decision = rememberClusterFolderAction(decision, "EXISTING");
  decision = rememberClusterFolderDestination(decision, existingGroupId);
  decision = rememberClusterFolderAction(decision, "KEEP");

  decision = rememberClusterFolderAction(decision, "NEW");
  assert.equal(decision.parentGroupId, parentGroupId);
  assert.deepEqual(serializeClusterFolderOverride(proposalClusterId, decision), {
    proposalClusterId,
    action: "NEW",
    parentGroupId
  });

  decision = rememberClusterFolderAction(decision, "EXISTING");
  assert.equal(decision.groupId, existingGroupId);
  assert.deepEqual(serializeClusterFolderOverride(proposalClusterId, decision), {
    proposalClusterId,
    action: "EXISTING",
    groupId: existingGroupId
  });
});

test("inactive remembered destinations are never sent to the API", () => {
  const remembered = {
    action: "KEEP" as const,
    groupId: existingGroupId,
    parentGroupId
  };
  assert.deepEqual(serializeClusterFolderOverride(proposalClusterId, remembered), {
    proposalClusterId,
    action: "KEEP"
  });
});
