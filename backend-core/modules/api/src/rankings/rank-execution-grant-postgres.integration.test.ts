import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  rankEstimateProjectDomainHashPreimage,
  type InternalIssueRankExecutionGrantInputV1,
  type RankManifestHash
} from "@seo-platform/contracts";
import { Client } from "pg";
import { uuidV7 } from "../common/uuid-v7.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import type { RankExecutionGrantPolicy } from "./rank-execution-grant.policy.js";
import { RankExecutionGrantService } from "./rank-execution-grant.service.js";

const databaseUrl = process.env.PLATFORM_API_RANK_GRANT_TEST_DATABASE_URL;

test(
  "PostgreSQL 18 enforces grant quota, TTL, input and immutability constraints",
  { skip: databaseUrl === undefined, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await assertPostgres18(client);
      const decidedAt = new Date();
      const reservationId = uuidV7();

      await assert.rejects(
        insertReceipt(client, {
          decision: "GRANTED",
          denialReason: null,
          decidedAt,
          expiresAt: new Date(decidedAt.getTime() + 30_000),
          quotaReservationId: null
        }),
        hasSqlState("23514")
      );
      await assert.rejects(
        insertReceipt(client, {
          decision: "DENIED",
          denialReason: "ENTITLEMENT_NOT_AVAILABLE",
          decidedAt: "infinity",
          expiresAt: null,
          quotaReservationId: null
        }),
        hasSqlState("23514")
      );
      await assert.rejects(
        insertReceipt(client, {
          decision: "GRANTED",
          denialReason: null,
          decidedAt,
          expiresAt: null,
          quotaReservationId: reservationId
        }),
        hasSqlState("23514")
      );
      await assert.rejects(
        insertReceipt(client, {
          decision: "GRANTED",
          denialReason: null,
          decidedAt,
          expiresAt: new Date(decidedAt.getTime() + 29_999),
          quotaReservationId: reservationId
        }),
        hasSqlState("23514")
      );
      await assert.rejects(
        insertReceipt(client, {
          decision: "DENIED",
          denialReason: "QUOTA_EXHAUSTED",
          decidedAt,
          expiresAt: null,
          quotaReservationId: reservationId
        }),
        hasSqlState("23514")
      );
      await assert.rejects(
        insertReceipt(client, {
          decision: "DENIED",
          denialReason: "ENTITLEMENT_NOT_AVAILABLE",
          decidedAt,
          expiresAt: null,
          quotaReservationId: null,
          idempotencyKey: "too-short"
        }),
        hasSqlState("23514")
      );

      const receiptId = await insertReceipt(client, {
        decision: "DENIED",
        denialReason: "ENTITLEMENT_NOT_AVAILABLE",
        decidedAt,
        expiresAt: null,
        quotaReservationId: null
      });
      await assert.rejects(
        client.query(
          `UPDATE rank_execution_grant_receipts
           SET correlation_id = correlation_id
           WHERE id = $1::uuid`,
          [receiptId]
        ),
        hasSqlState("55000")
      );
    } finally {
      await client.end();
    }
  }
);

test(
  "two concurrent exact issuers persist one immutable decision",
  { skip: databaseUrl === undefined, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    const prisma = grantPrisma(databaseUrl, 6);
    const monitor = new Client({ connectionString: databaseUrl });
    const fixture = await createGrantFixture(prisma, {
      provider: "XMLSTOCK",
      policyVersion: "manual-xmlstock-serp@2.0.0"
    });
    const service = new RankExecutionGrantService(
      prisma,
      grantingPolicy()
    );

    try {
      await monitor.connect();
      await assertPostgres18(monitor);
      const results = await Promise.all([
        service.issue(
          fixture.input,
          "rank-grant-concurrent-0001",
          "rank-grant-concurrent-a"
        ),
        service.issue(
          fixture.input,
          "rank-grant-concurrent-0001",
          "rank-grant-concurrent-b"
        )
      ]);

      assert.deepEqual(
        results.map((result) => result.created).sort(),
        [false, true]
      );
      assert.deepEqual(results[0]?.decision, results[1]?.decision);
      assert.equal(
        await prisma.rankExecutionGrantReceipt.count({
          where: {
            workspaceId: fixture.input.workspaceId,
            idempotencyKey: "rank-grant-concurrent-0001"
          }
        }),
        1
      );
    } finally {
      await cleanupGrantFixture(prisma, fixture);
      await Promise.allSettled([monitor.end(), prisma.$disconnect()]);
    }
  }
);

test(
  "workspace suspension racing issuance cannot leave a stale grant",
  { skip: databaseUrl === undefined, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    const prisma = grantPrisma(databaseUrl, 4);
    const locker = new Client({ connectionString: databaseUrl });
    const monitor = new Client({ connectionString: databaseUrl });
    const fixture = await createGrantFixture(prisma);
    let policyCalls = 0;
    const service = new RankExecutionGrantService(prisma, {
      evaluate: async () => {
        policyCalls += 1;
        return {
          entitlement: "ALLOWED",
          quota: "AVAILABLE",
          quotaReservationId: uuidV7()
        };
      }
    });
    let transactionOpen = false;
    let issuance: ReturnType<RankExecutionGrantService["issue"]> | undefined;

    try {
      await Promise.all([locker.connect(), monitor.connect()]);
      await assertPostgres18(monitor);
      await locker.query("BEGIN");
      transactionOpen = true;
      await locker.query(
        `SELECT id
         FROM workspaces
         WHERE id = $1::uuid
         FOR UPDATE`,
        [fixture.input.workspaceId]
      );

      issuance = service.issue(
        fixture.input,
        "rank-grant-suspension-0001",
        "rank-grant-suspension"
      );
      await waitForBlockedWorkspaceLock(monitor);
      await locker.query(
        `UPDATE workspaces
         SET status = 'SUSPENDED', version = version + 1
         WHERE id = $1::uuid`,
        [fixture.input.workspaceId]
      );
      await locker.query("COMMIT");
      transactionOpen = false;

      const result = await issuance;
      assert.equal(result.created, true);
      assert.equal(result.decision.status, "DENIED");
      if (result.decision.status !== "DENIED") {
        assert.fail("a stale execution grant was issued");
      }
      assert.equal(result.decision.reason, "WORKSPACE_NOT_ACTIVE");
      assert.equal(policyCalls, 0);
    } finally {
      if (transactionOpen) {
        await locker.query("ROLLBACK").catch(() => undefined);
      }
      await issuance?.catch(() => undefined);
      await cleanupGrantFixture(prisma, fixture);
      await Promise.allSettled([
        locker.end(),
        monitor.end(),
        prisma.$disconnect()
      ]);
    }
  }
);

interface ReceiptProbe {
  readonly decision: "GRANTED" | "DENIED";
  readonly denialReason:
    | "ENTITLEMENT_NOT_AVAILABLE"
    | "QUOTA_EXHAUSTED"
    | null;
  readonly decidedAt: Date | "infinity";
  readonly expiresAt: Date | "infinity" | null;
  readonly quotaReservationId: string | null;
  readonly idempotencyKey?: string;
}

async function insertReceipt(
  client: Client,
  probe: ReceiptProbe
): Promise<string> {
  const workspaceId = uuidV7();
  const projectId = uuidV7();
  const result = await client.query<{ readonly id: string }>(
    `INSERT INTO rank_execution_grant_receipts (
       workspace_id, project_id, actor_id, membership_id, job_id,
       job_item_id, execution_attempt, project_version,
       membership_version, policy_version, idempotency_scope,
       idempotency_key, request_hash, scope_hash, request_snapshot,
       response_snapshot, decision, denial_reason, decided_at, expires_at,
       quota_reservation_id, correlation_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       $6::uuid, 1, 1, 1, 'manual-arsenkin-positions@1.0.0', $7,
       $8, decode(repeat('01', 32), 'hex'),
       decode(repeat('02', 32), 'hex'), '{}'::jsonb, '{}'::jsonb,
       $9::"RankExecutionGrantDecision",
       $10::"RankExecutionGrantDenialReason", $11, $12, $13::uuid,
       'rank-grant-postgres'
     ) RETURNING id::text`,
    [
      workspaceId,
      projectId,
      uuidV7(),
      uuidV7(),
      uuidV7(),
      uuidV7(),
      `rank-execution-grant:${projectId}`,
      probe.idempotencyKey ?? `rank-grant-probe-${uuidV7()}`,
      probe.decision,
      probe.denialReason,
      probe.decidedAt,
      probe.expiresAt,
      probe.quotaReservationId
    ]
  );
  const id = result.rows[0]?.id;
  assert.ok(id);
  return id;
}

interface GrantFixture {
  readonly input: InternalIssueRankExecutionGrantInputV1;
  readonly projectAccessId: string;
}

async function createGrantFixture(
  prisma: PrismaService,
  options: Readonly<{
    provider?: "ARSENKIN" | "XMLSTOCK";
    policyVersion?: string;
  }> = {}
): Promise<GrantFixture> {
  const workspaceId = uuidV7();
  const projectId = uuidV7();
  const actorId = uuidV7();
  const membershipId = uuidV7();
  const projectAccessId = uuidV7();
  const domain = "grant-race.example.com";

  await prisma.user.create({
    data: {
      id: actorId,
      emailNormalized: `${actorId}@example.test`,
      emailDisplay: `${actorId}@example.test`,
      emailVerifiedAt: new Date(),
      displayName: "Rank grant race actor",
      status: "ACTIVE"
    }
  });
  await prisma.workspace.create({
    data: {
      id: workspaceId,
      name: "Rank grant race workspace",
      slug: `rank-grant-${workspaceId}`,
      ownerUserId: actorId,
      status: "ACTIVE"
    }
  });
  await prisma.project.create({
    data: {
      id: projectId,
      workspaceId,
      name: "Rank grant race project",
      slug: `rank-grant-${projectId}`,
      domain,
      status: "ACTIVE",
      createdBy: actorId,
      ownerUserId: actorId
    }
  });
  await prisma.workspaceMember.create({
    data: {
      id: membershipId,
      workspaceId,
      userId: actorId,
      roleCode: "OWNER",
      allProjects: true,
      status: "ACTIVE",
      joinedAt: new Date()
    }
  });
  await prisma.projectMemberAccess.create({
    data: {
      id: projectAccessId,
      projectId,
      memberId: membershipId,
      level: "MANAGER"
    }
  });

  return {
    projectAccessId,
    input: {
      schemaVersion: "rank-execution-grant-request@1",
      workspaceId,
      projectId,
      actorId,
      membership: { id: membershipId, version: 1 },
      project: {
        version: 1,
        domainHash: projectDomainHash(domain)
      },
      jobId: uuidV7(),
      jobItemId: uuidV7(),
      jobVersion: 1,
      executionAttempt: 1,
      purpose: "PROVIDER_SUBMIT",
      provider: options.provider ?? "ARSENKIN",
      operation: "POSITIONS",
      capability: "SERP_RANK_TRACKING",
      credentialMode: "BYOK_API_KEY",
      manifest: {
        id: uuidV7(),
        hash: hash("b"),
        chunkIndex: 0
      },
      executionEvidenceHash: hash("c"),
      policyVersion:
        options.policyVersion ?? "manual-arsenkin-positions@1.0.0",
      usageIntent: { meter: "RANK_PROVIDER_TASK", quantity: "1" }
    }
  };
}

async function cleanupGrantFixture(
  prisma: PrismaService,
  fixture: GrantFixture
): Promise<void> {
  await prisma.projectMemberAccess.deleteMany({
    where: { id: fixture.projectAccessId }
  }).catch(() => undefined);
  await prisma.project.deleteMany({
    where: { id: fixture.input.projectId }
  }).catch(() => undefined);
  await prisma.workspaceMember.deleteMany({
    where: { id: fixture.input.membership.id }
  }).catch(() => undefined);
  await prisma.workspace.deleteMany({
    where: { id: fixture.input.workspaceId }
  }).catch(() => undefined);
  await prisma.user.deleteMany({
    where: { id: fixture.input.actorId }
  }).catch(() => undefined);
}

function grantPrisma(url: string, poolSize: number): PrismaService {
  return new PrismaService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: url,
      DATABASE_POOL_MAX: String(poolSize)
    })
  );
}

function grantingPolicy(): RankExecutionGrantPolicy {
  return {
    evaluate: async (transaction, input) => {
      const [clock] = await transaction.$queryRaw<
        readonly { readonly now: Date }[]
      >`SELECT clock_timestamp() AS "now"`;
      assert.ok(clock?.now instanceof Date);
      assert.equal(Number.isNaN(clock.now.getTime()), false);
      const createdAt = clock.now;
      const windowStartedAt = new Date(
        Date.UTC(
          createdAt.getUTCFullYear(),
          createdAt.getUTCMonth(),
          createdAt.getUTCDate()
        )
      );
      const windowEndsAt = new Date(
        windowStartedAt.getTime() + 24 * 60 * 60 * 1_000
      );
      const reservation =
        await transaction.rankExecutionQuotaReservation.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            actorId: input.actorId,
            jobId: input.jobId,
            jobItemId: input.jobItemId,
            executionAttempt: input.executionAttempt,
            meter: input.usageIntent.meter,
            quantity: input.usageIntent.quantity,
            policyVersion: input.policyVersion,
            windowStartedAt,
            windowEndsAt,
            createdAt
          },
          select: { id: true }
        });
      return {
        entitlement: "ALLOWED",
        quota: "AVAILABLE",
        quotaReservationId: reservation.id
      };
    }
  };
}

function projectDomainHash(domain: string): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: createHash("sha256")
      .update(rankEstimateProjectDomainHashPreimage(domain), "utf8")
      .digest("hex")
  };
}

function hash(character: string): RankManifestHash {
  return { algorithm: "SHA_256", value: character.repeat(64) };
}

async function assertPostgres18(client: Client): Promise<void> {
  const result = await client.query<{
    readonly serverVersionNum: string;
    readonly timezone: string;
  }>(`
    SELECT
      current_setting('server_version_num') AS "serverVersionNum",
      current_setting('TimeZone') AS "timezone"
  `);
  const version = Number(result.rows[0]?.serverVersionNum);
  assert.equal(Math.floor(version / 10_000), 18);
  assert.equal(result.rows[0]?.timezone, "UTC");
}

async function waitForBlockedWorkspaceLock(client: Client): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND query LIKE '%FROM "workspaces"%'
         AND query LIKE '%FOR UPDATE%'`
    );
    if (result.rows[0]?.count !== "0") return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Grant issuance did not wait on the workspace lock");
}

function hasSqlState(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === expected;
}
