import assert from "node:assert/strict";
import test from "node:test";
import type { FrequencyCollectionSummary } from "@seo-platform/contracts";
import { FrequencyCollectionService } from "./frequency-collection.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";

test("manual retry resets only failed items and preserves completed progress", async () => {
  let itemUpdate: unknown;
  let jobUpdate: unknown;
  const transaction = {
    job: {
      findFirst: async () => ({ version: 7, status: "PARTIALLY_COMPLETED" }),
      updateMany: async (input: unknown) => {
        jobUpdate = input;
        return { count: 1 };
      }
    },
    jobItem: {
      updateMany: async (input: unknown) => {
        itemUpdate = input;
        return { count: 2 };
      },
      count: async () => 3
    }
  };
  const prisma = {
    $transaction: async (callback: (value: typeof transaction) => Promise<void>) =>
      callback(transaction)
  };
  const service = new RetryHarness(prisma as never);
  const result = await service.retryFailed(jobId, {
    workspaceId,
    projectId,
    actorId,
    version: 7
  });
  assert.equal(result.status, "QUEUED");
  assert.deepEqual(
    (itemUpdate as { where: unknown }).where,
    { jobId, status: "FAILED_FINAL" }
  );
  assert.deepEqual(
    (jobUpdate as { data: { status: string; progressCurrent: bigint } }).data.status,
    "QUEUED"
  );
  assert.equal(
    (jobUpdate as { data: { progressCurrent: bigint } }).data.progressCurrent,
    3n
  );
});

class RetryHarness extends FrequencyCollectionService {
  public override async get(): Promise<FrequencyCollectionSummary> {
    return {
      id: jobId,
      workspaceId,
      projectId,
      provider: "XMLSTOCK",
      status: "QUEUED",
      selectedKeywords: 5,
      completedKeywords: 3,
      failedKeywords: 0,
      types: ["BASE"],
      regionCode: "213",
      device: "ALL",
      version: 8,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:01.000Z"
    };
  }
}
