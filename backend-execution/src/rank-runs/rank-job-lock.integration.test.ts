import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import type { QueueService } from "../queue/queue.service.js";
import { RankRunService } from "./rank-run.service.js";

const databaseUrl = process.env.JOBS_RANK_TEST_DATABASE_URL;

test(
  "serializes cancellation on Job before locking RankJobRun",
  { skip: databaseUrl === undefined, timeout: 15_000 },
  async () => {
    assert.ok(databaseUrl);
    const prisma = new PrismaService({
      databaseUrl,
      databasePoolMax: 4
    } as AppConfig);
    const parentLock = new Client({ connectionString: databaseUrl });
    const childProbe = new Client({ connectionString: databaseUrl });
    const monitor = new Client({ connectionString: databaseUrl });
    const ids = await createPendingRankJob(prisma);
    const service = new RankRunService(
      prisma,
      {
        enqueueRankPreparation: async () => undefined
      } as unknown as QueueService
    );
    let parentTransactionOpen = false;
    let childTransactionOpen = false;
    let cancellation: Promise<unknown> | undefined;

    try {
      await Promise.all([
        parentLock.connect(),
        childProbe.connect(),
        monitor.connect()
      ]);
      await parentLock.query("BEGIN");
      parentTransactionOpen = true;
      await parentLock.query(
        `SELECT id FROM jobs WHERE id = $1::uuid FOR UPDATE`,
        [ids.jobId]
      );

      cancellation = service.cancel({
        workspaceId: ids.workspaceId,
        projectId: ids.projectId,
        actorId: ids.cancelActorId,
        jobId: ids.jobId
      });
      await waitForBlockedJobLock(monitor);

      await childProbe.query("BEGIN");
      childTransactionOpen = true;
      const probe = await childProbe.query(
        `SELECT job_id
         FROM rank_job_runs
         WHERE job_id = $1::uuid
         FOR UPDATE NOWAIT`,
        [ids.jobId]
      );
      assert.equal(probe.rowCount, 1);
      await childProbe.query("COMMIT");
      childTransactionOpen = false;

      await parentLock.query("COMMIT");
      parentTransactionOpen = false;
      const summary = await cancellation;
      assert.equal(
        (summary as { readonly status: string }).status,
        "CANCELLED"
      );

      const stored = await prisma.job.findUnique({
        where: { id: ids.jobId },
        include: { rankRun: true }
      });
      assert.equal(stored?.status, "CANCELLED");
      assert.equal(stored?.rankRun?.sealState, "NOT_SEALED");
      assert.equal(
        stored?.rankRun?.cancelRequestedBy,
        ids.cancelActorId
      );
    } finally {
      if (childTransactionOpen) {
        await childProbe.query("ROLLBACK").catch(() => undefined);
      }
      if (parentTransactionOpen) {
        await parentLock.query("ROLLBACK").catch(() => undefined);
      }
      await cancellation?.catch(() => undefined);
      await Promise.allSettled([
        parentLock.end(),
        childProbe.end(),
        monitor.end(),
        prisma.$disconnect()
      ]);
    }
  }
);

test(
  "rejects half-null rank execution and lifecycle receipts",
  { skip: databaseUrl === undefined, timeout: 15_000 },
  async () => {
    assert.ok(databaseUrl);
    const prisma = new PrismaService({
      databaseUrl,
      databasePoolMax: 2
    } as AppConfig);
    const client = new Client({ connectionString: databaseUrl });
    const ids = await createPendingRankJob(prisma);

    try {
      await client.connect();
      await client.query(
        `CREATE TEMP TABLE rank_estimate_constraint_probe
         (LIKE rank_estimates INCLUDING ALL)`
      );
      await client.query(
        `INSERT INTO rank_estimate_constraint_probe
         SELECT *
         FROM rank_estimates
         WHERE id = $1::uuid`,
        [ids.estimateId]
      );
      await assert.rejects(
        client.query(
          `UPDATE rank_estimate_constraint_probe
           SET execution_snapshot = '{}'::jsonb,
               execution_snapshot_hash = NULL
           WHERE id = $1::uuid`,
          [ids.estimateId]
        ),
        hasConstraint("rank_estimates_execution_snapshot_pair")
      );
      await assert.rejects(
        client.query(
          `UPDATE rank_estimate_constraint_probe
           SET execution_snapshot = NULL,
               execution_snapshot_hash = decode(repeat('01', 32), 'hex')
           WHERE id = $1::uuid`,
          [ids.estimateId]
        ),
        hasConstraint("rank_estimates_execution_snapshot_pair")
      );
      await assert.rejects(
        client.query(
          `UPDATE rank_estimates
           SET response_snapshot = response_snapshot
           WHERE id = $1::uuid`,
          [ids.estimateId]
        ),
        hasSqlState("55000")
      );
      await assert.rejects(
        client.query(
          `UPDATE rank_job_runs
           SET cancel_requested_by = $2::uuid
           WHERE job_id = $1::uuid`,
          [ids.jobId, ids.cancelActorId]
        ),
        hasSqlState("23514")
      );
      await assert.rejects(
        client.query(
          `UPDATE jobs
           SET version = version
           WHERE id = $1::uuid`,
          [ids.jobId]
        ),
        hasSqlState("23514")
      );
      await client.query("BEGIN");
      await client.query(
        `UPDATE jobs
         SET attempt = 1,
             version = version + 1
         WHERE id = $1::uuid`,
        [ids.jobId]
      );
      await assert.rejects(
        client.query("COMMIT"),
        hasSqlState("23514")
      );
      await client.query("BEGIN");
      await client.query(
        `UPDATE jobs
         SET attempt = 1,
             version = version + 1
         WHERE id = $1::uuid`,
        [ids.jobId]
      );
      await client.query(
        `UPDATE rank_job_runs
         SET seal_state = 'OUTCOME_UNKNOWN',
             seal_attempt_count = 1,
             last_seal_attempt_at = clock_timestamp()
         WHERE job_id = $1::uuid`,
        [ids.jobId]
      );
      await client.query("COMMIT");
      await assert.rejects(
        client.query(
          `UPDATE rank_job_runs
           SET seal_state = 'SEALED',
               manifest_id = $2::uuid,
               manifest_hash_schema = 'rank-manifest@1',
               manifest_hash = NULL,
               manifest_deduplication_hash =
                 decode(repeat('02', 32), 'hex'),
               manifest_pair_count = 3,
               manifest_chunk_count = 1,
               manifest_chunk_size = 250,
               manifest_sealed_at = clock_timestamp()
           WHERE job_id = $1::uuid`,
          [ids.jobId, randomUUID()]
        ),
        hasConstraint("rank_job_runs_manifest_receipt")
      );
      await client.query("BEGIN");
      await client.query(
        `UPDATE jobs
         SET status = 'QUEUED',
             stage = 'WAITING_FOR_QUEUE',
             queued_at = clock_timestamp(),
             version = version + 1
         WHERE id = $1::uuid`,
        [ids.jobId]
      );
      await client.query(
        `UPDATE rank_job_runs
         SET seal_state = 'SEALED',
             manifest_id = $2::uuid,
             manifest_hash_schema = 'rank-manifest@1',
             manifest_hash = decode(repeat('03', 32), 'hex'),
             manifest_deduplication_hash =
               decode(repeat('04', 32), 'hex'),
             manifest_pair_count = 3,
             manifest_chunk_count = 1,
             manifest_chunk_size = 250,
             manifest_sealed_at = clock_timestamp()
         WHERE job_id = $1::uuid`,
        [ids.jobId, randomUUID()]
      );
      await client.query("COMMIT");
      await assert.rejects(
        client.query(
          `UPDATE rank_job_runs
           SET seal_state = 'FINALIZED',
               finalization_status = 'COMPLETED',
               finalization_request_hash = NULL,
               finalized_at = clock_timestamp()
           WHERE job_id = $1::uuid`,
          [ids.jobId]
        ),
        hasConstraint("rank_job_runs_finalization_receipt")
      );
      await client.query("BEGIN");
      await client.query(
        `UPDATE rank_job_runs
         SET seal_state = 'FINALIZED',
             finalization_status = 'COMPLETED',
             finalization_request_hash =
               decode(repeat('05', 32), 'hex'),
             finalized_at = clock_timestamp()
         WHERE job_id = $1::uuid`,
        [ids.jobId]
      );
      await assert.rejects(
        client.query("COMMIT"),
        hasSqlState("23514")
      );
    } finally {
      await Promise.allSettled([client.end(), prisma.$disconnect()]);
    }
  }
);

async function createPendingRankJob(
  prisma: PrismaService
): Promise<{
  readonly workspaceId: string;
  readonly projectId: string;
  readonly cancelActorId: string;
  readonly estimateId: string;
  readonly jobId: string;
}> {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  const cancelActorId = randomUUID();
  const trackingContextId = randomUUID();
  const estimateId = randomUUID();
  const jobId = randomUUID();
  const calculatedAt = new Date();
  const expiresAt = new Date(calculatedAt.getTime() + 5 * 60_000);
  const bytes = (value: number) => Uint8Array.from({ length: 32 }, () => value);

  await prisma.$transaction(async (transaction) => {
    await transaction.rankEstimate.create({
      data: {
        id: estimateId,
        workspaceId,
        projectId,
        actorId,
        trackingContextId,
        idempotencyScope: `rank-lock:${projectId}`,
        idempotencyKey: randomUUID(),
        requestHash: bytes(1),
        projectVersion: 1,
        projectDomainHash: bytes(2),
        contextVersion: 1,
        configurationVersion: 1,
        configurationHash: bytes(3),
        semanticScopeHash: bytes(4),
        scopeHash: bytes(5),
        provider: "ARSENKIN",
        credentialMode: "BYOK_API_KEY",
        providerPolicyVersion: "manual-arsenkin-positions@2.0.0",
        keywordCount: 3,
        providerTaskCount: 1,
        minimumSubmitRequestCount: 1,
        minimumCheckRequestCount: 1,
        minimumGetRequestCount: 1,
        blockers: [],
        responseSnapshot: {},
        executionSnapshot: {},
        executionSnapshotHash: bytes(8),
        calculatedAt,
        expiresAt
      }
    });
    await transaction.job.create({
      data: {
        id: jobId,
        workspaceId,
        projectId,
        type: "MANUAL_RANK_CHECK",
        status: "PREPARING",
        stage: "PREPARING_SCOPE",
        actorId,
        deduplicationKey: `rank-lock:${jobId}`,
        idempotencyScope: `rank-run:${projectId}`,
        idempotencyKey: randomUUID(),
        requestHash: bytes(6),
        inputSnapshot: {},
        scopeSnapshot: {},
        progressCurrent: 0n,
        progressTotal: 3n,
        progressUnit: "KEYWORD",
        estimatedCostMicro: 0n,
        currency: "RUB",
        credentialMode: "BYOK_API_KEY",
        provider: "ARSENKIN",
        maxAttempts: 20,
        correlationId: "rank-lock-integration"
      }
    });
    await transaction.rankJobRun.create({
      data: {
        jobId,
        workspaceId,
        projectId,
        estimateId,
        trackingContextId,
        projectDomain: "example.com",
        projectStatus: "ACTIVE",
        projectVersion: 1,
        manifestCommand: {},
        manifestCommandHash: bytes(7)
      }
    });
  });
  return {
    workspaceId,
    projectId,
    cancelActorId,
    estimateId,
    jobId
  };
}

function hasConstraint(
  expected: string
): (error: unknown) => boolean {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "constraint" in error &&
    error.constraint === expected;
}

function hasSqlState(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === expected;
}

async function waitForBlockedJobLock(client: Client): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE wait_event_type = 'Lock'
         AND query LIKE '%rank-job-graph:job-tenant%'`
    );
    if (result.rows[0]?.count !== "0") return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Cancellation did not wait on the parent Job lock");
}
