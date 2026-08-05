import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../generated/prisma/client.js";
import {
  lockRankExecutionGrantAttempt,
  lockRankExecutionProjection,
  lockRankJobGraph,
  lockRankJobItem
} from "./rank-job-lock.js";

const identity = {
  jobId: "01900000-0000-7000-8000-000000000001",
  workspaceId: "01900000-0000-7000-8000-000000000002",
  projectId: "01900000-0000-7000-8000-000000000003"
} as const;

test("centralizes Job to private execution evidence lock order", async () => {
  const comments: string[] = [];
  const transaction = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      const comment = /\/\* ([a-z-]+(?:-[a-z]+)*:[a-z-]+) \*\//u.exec(
        sql
      )?.[1];
      assert.ok(comment);
      comments.push(comment);
      if (comment === "rank-job-graph:job") return [identity];
      return [{ id: identity.jobId, jobId: identity.jobId }];
    }
  } as unknown as Prisma.TransactionClient;

  const locked = await lockRankJobGraph(transaction, identity.jobId);
  assert.deepEqual(locked, identity);
  assert.equal(
    await lockRankJobItem(
      transaction,
      identity,
      "01900000-0000-7000-8000-000000000004"
    ),
    true
  );
  assert.equal(
    await lockRankExecutionProjection(transaction, {
      ...identity,
      jobItemId: "01900000-0000-7000-8000-000000000004",
      credentialId: "01900000-0000-7000-8000-000000000005",
      validationJobId: "01900000-0000-7000-8000-000000000006",
      bindingId: "01900000-0000-7000-8000-000000000007",
      routeId: "01900000-0000-7000-8000-000000000008"
    }),
    true
  );
  assert.equal(
    await lockRankExecutionGrantAttempt(
      transaction,
      identity,
      "01900000-0000-7000-8000-000000000004",
      "01900000-0000-7000-8000-000000000009"
    ),
    true
  );

  assert.deepEqual(comments, [
    "rank-job-graph:job",
    "rank-job-graph:run",
    "rank-job-graph:item",
    "rank-execution-graph:credential",
    "rank-execution-graph:validation-job",
    "rank-execution-graph:binding",
    "rank-execution-graph:route",
    "rank-execution-graph:grant-attempt"
  ]);
});
