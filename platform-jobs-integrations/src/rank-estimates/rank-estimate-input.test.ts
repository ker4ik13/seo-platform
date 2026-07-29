import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateRankEstimateInput,
  rankEstimateIdempotencyKey
} from "./rank-estimate-input.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const actorId = "0190abcd-0000-7000-8000-000000000003";
const trackingContextId = "0190abcd-0000-7000-8000-000000000004";

const input = {
  workspaceId,
  projectId,
  actorId,
  trackingContextId,
  project: {
    id: projectId,
    workspaceId,
    domain: "example.com",
    status: "ACTIVE",
    version: 2
  },
  access: {
    workspaceStatus: "ACTIVE",
    canRunRanking: true,
    entitlementStatus: "NOT_AVAILABLE"
  },
  billingCurrency: "RUB",
  quota: { status: "NOT_AVAILABLE" }
} as const;

test("accepts an exact authoritative rank estimate command", () => {
  assert.deepEqual(internalCreateRankEstimateInput(input), input);
  assert.equal(
    rankEstimateIdempotencyKey("rank-estimate-0001"),
    "rank-estimate-0001"
  );
});

test("rejects unknown fields, tenant mismatch and inconsistent quota", () => {
  for (const candidate of [
    { ...input, browserProjectId: projectId },
    {
      ...input,
      project: { ...input.project, workspaceId: actorId }
    },
    {
      ...input,
      quota: {
        status: "AVAILABLE",
        limit: "10",
        used: "9",
        remaining: "2"
      }
    },
    {
      ...input,
      project: { ...input.project, domain: "https://example.com" }
    }
  ]) {
    assert.throws(
      () => internalCreateRankEstimateInput(candidate),
      BadRequestException
    );
  }
  assert.throws(
    () => rankEstimateIdempotencyKey("short"),
    BadRequestException
  );
});
