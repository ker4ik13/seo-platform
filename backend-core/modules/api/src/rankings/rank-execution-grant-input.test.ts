import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { InternalIssueRankExecutionGrantInputV1 } from "@seo-platform/contracts";
import {
  issueRankExecutionGrantInput,
  requiredRankExecutionGrantHeaders,
  requiredRankExecutionGrantIdempotencyKey,
  type RankExecutionGrantHeaderRequest
} from "./rank-execution-grant-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";
const jobId = "01900000-0000-7000-8000-000000000005";
const jobItemId = "01900000-0000-7000-8000-000000000006";
const manifestId = "01900000-0000-7000-8000-000000000007";
const requestId = "request-rank-grant-001";
const idempotencyKey = "rank-grant-issue-0001";

test("parses the exact execution grant request through the API boundary", () => {
  const input = grantInput();
  const parsed = issueRankExecutionGrantInput(input);

  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  assert.notEqual(parsed.membership, input.membership);
  assert.notEqual(parsed.manifest, input.manifest);
});

test("maps malformed or augmented grant requests to one generic bad request", () => {
  for (const value of [
    undefined,
    [],
    {
      ...grantInput(),
      workspaceId: "01900000-0000-7000-8000-00000000000A"
    },
    { ...grantInput(), credentialId: manifestId },
    {
      ...grantInput(),
      usageIntent: { meter: "RANK_PROVIDER_TASK", quantity: "2" }
    }
  ]) {
    assert.throws(
      () => issueRankExecutionGrantInput(value),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message === "Invalid rank execution grant request"
    );
  }
});

test("accepts only bounded stable execution grant idempotency keys", () => {
  for (const value of [
    "a".repeat(16),
    "Rank_Grant.issue:1",
    "z".repeat(180)
  ]) {
    assert.equal(requiredRankExecutionGrantIdempotencyKey(value), value);
  }

  for (const value of [
    undefined,
    ["a".repeat(16)],
    "a".repeat(15),
    "a".repeat(181),
    " rank-grant-issue-0001",
    "rank-grant-issue-0001,rank-grant-issue-0001",
    "rank/grant/issue/0001",
    "ранг-грант-00000001"
  ]) {
    assert.throws(
      () => requiredRankExecutionGrantIdempotencyKey(value),
      BadRequestException
    );
  }
});

test("reads one exact trusted header set and canonicalizes UUIDs", () => {
  assert.deepEqual(
    requiredRankExecutionGrantHeaders(
      headerRequest({
        "x-request-id": requestId,
        "x-workspace-id": workspaceId.toUpperCase(),
        "x-project-id": projectId.toUpperCase(),
        "x-actor-id": actorId.toUpperCase(),
        "idempotency-key": idempotencyKey
      })
    ),
    {
      requestId,
      workspaceId,
      projectId,
      actorId,
      idempotencyKey
    }
  );
});

test("rejects missing, array and raw duplicate trusted headers", () => {
  const validHeaders = trustedHeaders();

  for (const name of [
    "x-request-id",
    "x-workspace-id",
    "x-project-id",
    "x-actor-id",
    "idempotency-key"
  ]) {
    const missing = { ...validHeaders };
    delete missing[name];
    assert.throws(
      () => requiredRankExecutionGrantHeaders({ headers: missing }),
      BadRequestException
    );

    assert.throws(
      () =>
        requiredRankExecutionGrantHeaders({
          headers: {
            ...validHeaders,
            [name]: [validHeaders[name]!, validHeaders[name]!]
          }
        }),
      BadRequestException
    );

    const duplicateRawHeaders = rawHeaders(validHeaders);
    duplicateRawHeaders.push(name, validHeaders[name]!);
    assert.throws(
      () =>
        requiredRankExecutionGrantHeaders({
          headers: validHeaders,
          raw: { rawHeaders: duplicateRawHeaders }
        }),
      BadRequestException
    );
  }
});

function grantInput(): InternalIssueRankExecutionGrantInputV1 {
  return {
    schemaVersion: "rank-execution-grant-request@1",
    workspaceId,
    projectId,
    actorId,
    membership: {
      id: membershipId,
      version: 3
    },
    project: {
      version: 7,
      domainHash: hash("a")
    },
    jobId,
    jobItemId,
    jobVersion: 5,
    executionAttempt: 1,
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "BYOK_API_KEY",
    manifest: {
      id: manifestId,
      hash: hash("b"),
      chunkIndex: 2
    },
    executionEvidenceHash: hash("c"),
    policyVersion: "manual-arsenkin-positions@1.0.0",
    usageIntent: {
      meter: "RANK_PROVIDER_TASK",
      quantity: "1"
    }
  };
}

function hash(character: string) {
  return {
    algorithm: "SHA_256" as const,
    value: character.repeat(64)
  };
}

function trustedHeaders(): Record<string, string> {
  return {
    "x-request-id": requestId,
    "x-workspace-id": workspaceId,
    "x-project-id": projectId,
    "x-actor-id": actorId,
    "idempotency-key": idempotencyKey
  };
}

function headerRequest(
  headers: Readonly<Record<string, string>>
): RankExecutionGrantHeaderRequest {
  return {
    headers,
    raw: { rawHeaders: rawHeaders(headers) }
  };
}

function rawHeaders(
  headers: Readonly<Record<string, string>>
): string[] {
  return Object.entries(headers).flatMap(([name, value]) => [name, value]);
}
