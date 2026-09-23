import assert from "node:assert/strict";
import test from "node:test";
import { internalCreateClusteringRunInput } from "./clustering-run-input.js";

test("keeps the selected Arsenkin credential across the clustering boundary", () => {
  const credentialId = "01900000-0000-7000-8000-000000000005";
  const parsed = internalCreateClusteringRunInput({
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    actorId: "01900000-0000-7000-8000-000000000003",
    idempotencyKey: "clustering-route-test",
    correlationId: "clustering-route-test",
    jobCapacity: {
      planCode: "TEST",
      planVersion: 1,
      concurrentJobs: 5
    },
    items: [{
      id: "01900000-0000-7000-8000-000000000004",
      version: 1
    }],
    credentialId,
    searchEngine: "YANDEX",
    regionCode: "213",
    method: "HARD",
    overlapCount: 3,
    depth: 10,
    excludeMainPages: false,
    stopDomains: [],
    frequencyTypes: ["OVERALL"],
    replaceExistingClusters: false
  });

  assert.equal(parsed.credentialId, credentialId);
});
