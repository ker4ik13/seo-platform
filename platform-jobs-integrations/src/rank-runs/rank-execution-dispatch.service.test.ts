import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { RankManifestClient } from "../seo-data/rank-manifest.client.js";
import {
  RankExecutionDispatchService
} from "./rank-execution-dispatch.service.js";
import {
  RankExecutionGrantAttemptError,
  type RankExecutionGrantAttemptService,
  type RankExecutionGrantAttemptResult
} from "./rank-execution-grant-attempt.service.js";

const jobId = "01900000-0000-7000-8000-000000000001";
const itemOne = "01900000-0000-7000-8000-000000000002";
const itemTwo = "01900000-0000-7000-8000-000000000003";

test("does not scan or dispatch outside the enabled rank worker", async () => {
  const fixture = service(false);
  assert.deepEqual(
    await fixture.service.pendingExecutionJobIds(),
    []
  );
  assert.equal(await fixture.service.process(jobId), "DISABLED");
  assert.deepEqual(fixture.events, []);
});

test("issues every chunk grant with a stable request identity", async () => {
  const fixture = service(true, {
    [itemOne]: result(itemOne, "CONSUMED"),
    [itemTwo]: result(itemTwo, "CONSUMED")
  });
  fixture.overrideStart([itemOne, itemTwo]);

  assert.equal(
    await fixture.service.process(jobId),
    "READY_TO_SUBMIT"
  );
  assert.deepEqual(fixture.events, [
    `grant:${itemOne}:rank-grant-${itemOne}`,
    `grant:${itemTwo}:rank-grant-${itemTwo}`
  ]);
});

test("waits without failing while the provider dispatch window is full", async () => {
  const fixture = service(true);
  fixture.overrideStart([]);

  assert.equal(
    await fixture.service.process(jobId),
    "RETRY_PENDING"
  );
  assert.deepEqual(fixture.events, []);
});

test("finalizes an explicit grant denial before provider submit", async () => {
  const fixture = service(true, {
    [itemOne]: result(itemOne, "DENIED")
  });
  fixture.overrideStart([itemOne, itemTwo]);

  assert.equal(await fixture.service.process(jobId), "FAILED");
  assert.deepEqual(fixture.events, [
    `grant:${itemOne}:rank-grant-${itemOne}`,
    "finish:EXECUTION_GRANT_DENIED"
  ]);
});

test("leaves retryable issuer ambiguity for PostgreSQL recovery", async () => {
  const fixture = service(
    true,
    {},
    new RankExecutionGrantAttemptError(
      "DEPENDENCY_UNAVAILABLE",
      true
    )
  );
  fixture.overrideStart([itemOne]);

  assert.equal(
    await fixture.service.process(jobId),
    "RETRY_PENDING"
  );
  assert.deepEqual(fixture.events, [
    `grant:${itemOne}:rank-grant-${itemOne}`
  ]);
});

test("fails closed when the sealed item graph is incomplete", async () => {
  const fixture = service(true);
  fixture.overrideInvalidStart();

  assert.equal(await fixture.service.process(jobId), "FAILED");
  assert.deepEqual(fixture.events, ["finish:INTERNAL_ERROR"]);
});

function service(
  submitEnabled: boolean,
  results: Readonly<Record<string, RankExecutionGrantAttemptResult>> = {},
  grantError?: RankExecutionGrantAttemptError
): {
  readonly service: RankExecutionDispatchService;
  readonly events: string[];
  readonly overrideStart: (itemIds: readonly string[]) => void;
  readonly overrideInvalidStart: () => void;
} {
  const events: string[] = [];
  const grants = {
    issueForItem: async (
      itemId: string,
      requestId: string
    ): Promise<RankExecutionGrantAttemptResult> => {
      events.push(`grant:${itemId}:${requestId}`);
      if (grantError) throw grantError;
      const stored = results[itemId];
      if (!stored) throw new Error("Missing grant fixture");
      return stored;
    }
  } as RankExecutionGrantAttemptService;
  const instance = new RankExecutionDispatchService(
    {} as PrismaService,
    grants,
    {} as RankManifestClient,
    {
      rankPreparation: { enabled: submitEnabled },
      rankExecution: {
        submitEnabled,
        killSwitchVersion: "arsenkin-positions@1"
      }
    } as AppConfig
  );
  const internals = instance as unknown as {
    start: (
      id: string
    ) => Promise<
      | {
          readonly jobId: string;
          readonly itemIds: readonly string[];
          readonly invalid: boolean;
        }
      | undefined
    >;
    finishFailure: (
      id: string,
      code: string
    ) => Promise<void>;
  };
  internals.finishFailure = async (_id, code) => {
    events.push(`finish:${code}`);
  };
  return {
    service: instance,
    events,
    overrideStart: (itemIds) => {
      internals.start = async (id) => ({
        jobId: id,
        itemIds,
        invalid: false
      });
    },
    overrideInvalidStart: () => {
      internals.start = async (id) => ({
        jobId: id,
        itemIds: [],
        invalid: true
      });
    }
  };
}

function result(
  itemId: string,
  status: RankExecutionGrantAttemptResult["status"]
): RankExecutionGrantAttemptResult {
  return {
    id: "01900000-0000-7000-8000-000000000010",
    workspaceId: "01900000-0000-7000-8000-000000000011",
    projectId: "01900000-0000-7000-8000-000000000012",
    jobId,
    jobItemId: itemId,
    executionAttempt: 1,
    status
  };
}
