import assert from "node:assert/strict";
import test from "node:test";
import { internalCreateAiAnswerCollectionInput } from "./ai-answer-collection-input.js";

test("keeps the selected Arsenkin credential across the AI collection boundary", () => {
  const credentialId = "01900000-0000-7000-8000-000000000005";
  const parsed = internalCreateAiAnswerCollectionInput({
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    actorId: "01900000-0000-7000-8000-000000000003",
    idempotencyKey: "ai-answer-route-test",
    correlationId: "ai-answer-route-test",
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
    searchEngine: "GOOGLE",
    regionCode: "1011969",
    device: "DESKTOP",
    host: "neuroluv.ru",
    excludeSubdomains: false,
    brands: []
  });

  assert.equal(parsed.credentialId, credentialId);
});
