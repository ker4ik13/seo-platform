import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "../generated/prisma/client.js";
import { aiAnswerCollectionSummary } from "./ai-answer-collection-record.js";

test("shows provider task progress without counting unsaved keywords", () => {
  const job = {
    id: "01900000-0000-7000-8000-000000000001",
    workspaceId: "01900000-0000-7000-8000-000000000002",
    projectId: "01900000-0000-7000-8000-000000000003",
    actorId: "01900000-0000-7000-8000-000000000004",
    inputSnapshot: {
      searchEngine: "YANDEX",
      regionCode: "213",
      device: "DESKTOP",
      host: "example.com"
    },
    scopeSnapshot: {},
    status: "RETRY_SCHEDULED",
    stage: "provider_poll",
    progressCurrent: 0n,
    progressTotal: 110n,
    providerProgressPercent: 87,
    resultSummary: null,
    errorSummary: null,
    retryAt: new Date("2026-10-07T07:37:00.000Z"),
    version: 3,
    createdAt: new Date("2026-10-07T07:13:19.000Z"),
    updatedAt: new Date("2026-10-07T07:36:54.000Z"),
    startedAt: new Date("2026-10-07T07:13:20.000Z"),
    finishedAt: null
  } as unknown as Job;
  const active = aiAnswerCollectionSummary(job);
  assert.equal(active.providerProgressPercent, 87);
  assert.equal(active.completedKeywords, 0);
  assert.equal("providerProgressPercent" in aiAnswerCollectionSummary({
    ...job,
    status: "COMPLETED",
    stage: "completed",
    progressCurrent: 110n
  }), false);
});
