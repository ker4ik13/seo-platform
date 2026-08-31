import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  MODULE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RankExecutionGrantSettlementController } from "./rank-execution-grant-settlement.controller.js";
import { RankExecutionGrantSettlementGuard } from "./rank-execution-grant-settlement.guard.js";
import type { RankExecutionGrantSettlementService } from "./rank-execution-grant-settlement.service.js";
import { RankingModule } from "./ranking.module.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  grantId: "01900000-0000-7000-8000-000000000004",
  otherId: "01900000-0000-7000-8000-000000000099"
} as const;
const requestId = "rank-settle-request-1";

test("declares the dedicated settlement route and module boundary", () => {
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      RankExecutionGrantSettlementController
    ),
    "internal/v1/workspaces/:workspaceId/projects/:projectId"
  );
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      RankExecutionGrantSettlementController
    ),
    [RankExecutionGrantSettlementGuard]
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      RankExecutionGrantSettlementController.prototype.capture
    ),
    "rank-execution-grants/:grantId/settlements"
  );
  assert.equal(
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      RankExecutionGrantSettlementController.prototype.capture
    ),
    200
  );
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    RankingModule
  ) as readonly unknown[];
  assert.ok(controllers.includes(RankExecutionGrantSettlementController));
});

test("returns an exact no-store settlement envelope", async () => {
  const calls: unknown[] = [];
  const controller = new RankExecutionGrantSettlementController({
    capture: async (scope: unknown) => {
      calls.push(scope);
      return {
        schemaVersion: "rank-execution-grant-settlement-result@1",
        grantId: ids.grantId,
        status: "CAPTURED"
      };
    },
    hold: async () => {
      throw new Error("capture request must not hold");
    }
  } as unknown as RankExecutionGrantSettlementService);
  const response = reply();

  assert.deepEqual(
    await controller.capture(
      ids.workspaceId.toUpperCase(),
      ids.projectId.toUpperCase(),
      ids.grantId.toUpperCase(),
      requestBody(),
      request({
        "x-workspace-id": ids.workspaceId.toUpperCase(),
        "x-project-id": ids.projectId.toUpperCase(),
        "x-actor-id": ids.actorId.toUpperCase()
      }),
      response.value
    ),
    {
      data: {
        schemaVersion: "rank-execution-grant-settlement-result@1",
        grantId: ids.grantId,
        status: "CAPTURED"
      },
      meta: { requestId }
    }
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, [{
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    grantId: ids.grantId
  }]);
});

test("routes HOLD to the non-capturing reservation boundary", async () => {
  let holds = 0;
  const controller = new RankExecutionGrantSettlementController({
    capture: async () => {
      throw new Error("hold request must not capture");
    },
    hold: async () => {
      holds += 1;
      return {
        schemaVersion: "rank-execution-grant-settlement-result@1",
        grantId: ids.grantId,
        status: "RESERVED"
      };
    }
  } as unknown as RankExecutionGrantSettlementService);

  const response = await controller.capture(
    ids.workspaceId,
    ids.projectId,
    ids.grantId,
    { ...requestBody(), action: "HOLD" },
    request(),
    reply().value
  );
  assert.equal(holds, 1);
  assert.equal(response.data.status, "RESERVED");
});

test("rejects malformed body and route/header mismatches before service", async () => {
  let calls = 0;
  const controller = new RankExecutionGrantSettlementController({
    capture: async () => {
      calls += 1;
      throw new Error("must not run");
    }
  } as unknown as RankExecutionGrantSettlementService);
  const scenarios: readonly [string, string, string, unknown, FastifyRequest][] = [
    [ids.workspaceId, ids.projectId, ids.grantId, { ...requestBody(), extra: true }, request()],
    [ids.otherId, ids.projectId, ids.grantId, requestBody(), request()],
    [ids.workspaceId, ids.otherId, ids.grantId, requestBody(), request()]
  ];
  for (const scenario of scenarios) {
    await assert.rejects(
      controller.capture(...scenario, reply().value),
      BadRequestException
    );
  }
  assert.equal(calls, 0);
});

function requestBody() {
  return {
    schemaVersion: "rank-execution-grant-settlement-request@1" as const,
    action: "CAPTURE" as const
  };
}

function request(
  overrides: Readonly<Record<string, string>> = {}
): FastifyRequest {
  return {
    id: requestId,
    headers: {
      "x-request-id": requestId,
      "x-workspace-id": ids.workspaceId,
      "x-project-id": ids.projectId,
      "x-actor-id": ids.actorId,
      "idempotency-key":
        `rank-settlement:${ids.grantId}:capture`,
      ...overrides
    }
  } as unknown as FastifyRequest;
}

function reply(): {
  readonly value: FastifyReply;
  readonly headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  return {
    headers,
    value: {
      header: (name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
      }
    } as unknown as FastifyReply
  };
}
