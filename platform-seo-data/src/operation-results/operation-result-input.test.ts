import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalFrequencyOperationResultInput,
  operationResultCursor,
  operationResultLimit
} from "./operation-result-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";
const context = { workspaceId, projectId, actorId };

test("accepts an exact tenant-scoped frequency result request", () => {
  assert.deepEqual(
    internalFrequencyOperationResultInput(
      { workspaceId, projectId, actorId, jobId, keywordIds: [keywordId] },
      context,
      jobId
    ),
    { workspaceId, projectId, actorId, jobId, keywordIds: [keywordId] }
  );
});

test("rejects forged tenant and route scope", () => {
  assert.throws(
    () =>
      internalFrequencyOperationResultInput(
        {
          workspaceId: "01900000-0000-7000-8000-000000000099",
          projectId,
          actorId,
          jobId,
          keywordIds: [keywordId]
        },
        context,
        jobId
      ),
    BadRequestException
  );
  assert.throws(
    () =>
      internalFrequencyOperationResultInput(
        { workspaceId, projectId, actorId, jobId, keywordIds: [keywordId] },
        context,
        "01900000-0000-7000-8000-000000000098"
      ),
    BadRequestException
  );
});

test("enforces bounded unique keyword scope and crawl paging", () => {
  const keywordIds = Array.from(
    { length: 10_001 },
    (_, index) =>
      `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`
  );
  assert.throws(
    () =>
      internalFrequencyOperationResultInput(
        { workspaceId, projectId, actorId, jobId, keywordIds },
        context,
        jobId
      ),
    BadRequestException
  );
  assert.throws(
    () =>
      internalFrequencyOperationResultInput(
        {
          workspaceId,
          projectId,
          actorId,
          jobId,
          keywordIds: [keywordId, keywordId]
        },
        context,
        jobId
      ),
    BadRequestException
  );
  assert.equal(operationResultLimit(undefined), 100);
  assert.equal(operationResultLimit("25"), 25);
  assert.equal(operationResultCursor("0"), 0);
  assert.equal(operationResultCursor("999"), 999);
  assert.throws(() => operationResultLimit("101"), BadRequestException);
  assert.throws(() => operationResultCursor("1000"), BadRequestException);
});
