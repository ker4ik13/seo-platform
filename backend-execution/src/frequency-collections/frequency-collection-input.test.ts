import assert from "node:assert/strict";
import test from "node:test";
import { internalCreateFrequencyCollectionInput } from "./frequency-collection-input.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  keywordId: "01900000-0000-7000-8000-000000000004",
  credentialId: "01900000-0000-7000-8000-000000000005"
};

test("keeps the selected frequency provider route across the Jobs boundary", () => {
  const command = {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    idempotencyKey: "frequency-route-test",
    correlationId: "frequency-route-test",
    jobCapacity: {
      planCode: "TEST",
      planVersion: 1,
      concurrentJobs: 5
    },
    items: [{ id: ids.keywordId, version: 1 }],
    types: ["BASE"],
    regionCode: "213",
    device: "ALL",
    provider: "XMLSTOCK",
    credentialId: ids.credentialId
  };

  assert.deepEqual(internalCreateFrequencyCollectionInput(command), {
    ...command,
    mode: "FREQUENCY"
  });
  assert.throws(() =>
    internalCreateFrequencyCollectionInput({
      ...command,
      credentialId: undefined
    })
  );
});
