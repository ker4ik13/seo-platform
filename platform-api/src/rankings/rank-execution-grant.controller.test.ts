import assert from "node:assert/strict";
import test from "node:test";
import {
  BadRequestException,
  ConflictException
} from "@nestjs/common";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  MODULE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type {
  InternalIssueRankExecutionGrantInputV1,
  InternalRankExecutionGrantDecisionV1
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RankExecutionGrantController } from "./rank-execution-grant.controller.js";
import { RankExecutionGrantGuard } from "./rank-execution-grant.guard.js";
import type { RankExecutionGrantService } from "./rank-execution-grant.service.js";
import { RankingModule } from "./ranking.module.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";
const jobId = "01900000-0000-7000-8000-000000000005";
const jobItemId = "01900000-0000-7000-8000-000000000006";
const manifestId = "01900000-0000-7000-8000-000000000007";
const otherId = "01900000-0000-7000-8000-000000000099";
const requestId = "request-rank-grant-001";
const idempotencyKey = "rank-grant-issue-0001";

test("declares the dedicated internal grant route and module boundary", () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, RankExecutionGrantController),
    "internal/v1/workspaces/:workspaceId/projects/:projectId"
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, RankExecutionGrantController),
    [RankExecutionGrantGuard]
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      RankExecutionGrantController.prototype.issue
    ),
    "rank-execution-grants"
  );
  assert.equal(
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      RankExecutionGrantController.prototype.issue
    ),
    201
  );

  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    RankingModule
  ) as readonly unknown[];
  assert.ok(controllers.includes(RankExecutionGrantController));
});

test("returns 201 with no-store for a newly persisted exact grant decision", async () => {
  const calls: unknown[][] = [];
  const expectedDecision = decision();
  const controller = new RankExecutionGrantController({
    issue: async (...args: unknown[]) => {
      calls.push(args);
      return { decision: expectedDecision, created: true };
    }
  } as unknown as RankExecutionGrantService);
  const response = reply();
  const input = grantInput();

  const result = await controller.issue(
    workspaceId.toUpperCase(),
    projectId.toUpperCase(),
    input,
    request({
      headers: {
        ...trustedHeaders(),
        "x-workspace-id": workspaceId.toUpperCase(),
        "x-project-id": projectId.toUpperCase(),
        "x-actor-id": actorId.toUpperCase()
      }
    }),
    response.value
  );

  assert.deepEqual(result, {
    data: expectedDecision,
    meta: { requestId }
  });
  assert.deepEqual(response.codes, [201]);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [input, idempotencyKey, requestId]);
  assert.notEqual(calls[0]?.[0], input);
});

test("returns 200 with the same no-store boundary for an exact replay", async () => {
  const expectedDecision = decision();
  const controller = new RankExecutionGrantController({
    issue: async () => ({ decision: expectedDecision, created: false })
  } as unknown as RankExecutionGrantService);
  const response = reply();

  const result = await controller.issue(
    workspaceId,
    projectId,
    grantInput(),
    request(),
    response.value
  );

  assert.equal(result.data, expectedDecision);
  assert.deepEqual(response.codes, [200]);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects every route, trusted-header and body identity mismatch before service", async () => {
  let serviceCalls = 0;
  const controller = new RankExecutionGrantController({
    issue: async () => {
      serviceCalls += 1;
      return { decision: decision(), created: true };
    }
  } as unknown as RankExecutionGrantService);

  const scenarios: readonly {
    readonly routeWorkspaceId?: string;
    readonly routeProjectId?: string;
    readonly body?: InternalIssueRankExecutionGrantInputV1;
    readonly headers?: Readonly<
      Record<string, string | readonly string[] | undefined>
    >;
    readonly actualRequestId?: string;
  }[] = [
    { routeWorkspaceId: otherId },
    { routeProjectId: otherId },
    {
      body: { ...grantInput(), workspaceId: otherId }
    },
    {
      body: { ...grantInput(), projectId: otherId }
    },
    {
      body: { ...grantInput(), actorId: otherId }
    },
    {
      headers: {
        ...trustedHeaders(),
        "x-workspace-id": otherId
      }
    },
    {
      headers: {
        ...trustedHeaders(),
        "x-project-id": otherId
      }
    },
    {
      headers: {
        ...trustedHeaders(),
        "x-actor-id": otherId
      }
    },
    {
      actualRequestId: "request-rank-grant-other"
    }
  ];

  for (const scenario of scenarios) {
    await assert.rejects(
      () =>
        controller.issue(
          scenario.routeWorkspaceId ?? workspaceId,
          scenario.routeProjectId ?? projectId,
          scenario.body ?? grantInput(),
          request({
            ...(scenario.headers
              ? { headers: scenario.headers }
              : {}),
            ...(scenario.actualRequestId
              ? { id: scenario.actualRequestId }
              : {})
          }),
          reply().value
        ),
      BadRequestException
    );
  }
  assert.equal(serviceCalls, 0);
});

test("rejects missing and array trusted headers before service", async () => {
  let serviceCalls = 0;
  const controller = new RankExecutionGrantController({
    issue: async () => {
      serviceCalls += 1;
      return { decision: decision(), created: true };
    }
  } as unknown as RankExecutionGrantService);

  for (const name of [
    "x-request-id",
    "x-workspace-id",
    "x-project-id",
    "x-actor-id",
    "idempotency-key"
  ]) {
    const missing = { ...trustedHeaders() };
    delete missing[name];
    await assert.rejects(
      () =>
        controller.issue(
          workspaceId,
          projectId,
          grantInput(),
          request({ headers: missing }),
          reply().value
        ),
      BadRequestException
    );

    const current = trustedHeaders()[name]!;
    await assert.rejects(
      () =>
        controller.issue(
          workspaceId,
          projectId,
          grantInput(),
          request({
            headers: {
              ...trustedHeaders(),
              [name]: [current, current]
            }
          }),
          reply().value
        ),
      BadRequestException
    );
  }
  assert.equal(serviceCalls, 0);
});

test("preserves a service idempotency conflict and still disables caching", async () => {
  const conflict = new ConflictException("grant conflict");
  const controller = new RankExecutionGrantController({
    issue: async () => {
      throw conflict;
    }
  } as unknown as RankExecutionGrantService);
  const response = reply();

  await assert.rejects(
    () =>
      controller.issue(
        workspaceId,
        projectId,
        grantInput(),
        request(),
        response.value
      ),
    (error: unknown) =>
      error === conflict && conflict.getStatus() === 409
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.codes, []);
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

function decision(): InternalRankExecutionGrantDecisionV1 {
  return {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "DENIED",
    requestHash: hash("d"),
    decidedAt: "2026-07-29T12:00:00.000Z",
    reason: "ENTITLEMENT_NOT_AVAILABLE"
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

function request(
  options: Readonly<{
    headers?: Readonly<
      Record<string, string | readonly string[] | undefined>
    >;
    id?: string;
  }> = {}
): FastifyRequest {
  return {
    id: options.id ?? requestId,
    headers: options.headers ?? trustedHeaders()
  } as unknown as FastifyRequest;
}

function reply(): {
  readonly value: FastifyReply;
  readonly headers: Map<string, string>;
  readonly codes: number[];
} {
  const headers = new Map<string, string>();
  const codes: number[] = [];
  const value = {
    header: (name: string, headerValue: string) => {
      headers.set(name.toLowerCase(), headerValue);
      return value;
    },
    code: (statusCode: number) => {
      codes.push(statusCode);
      return value;
    }
  };
  return {
    value: value as unknown as FastifyReply,
    headers,
    codes
  };
}
