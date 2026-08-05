import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type {
  InternalFinalizeRankCheckInput,
  RankCheckFinalStatus
} from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import { RankFinalizationService } from "./rank-finalization.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const manifestId = "01900000-0000-7000-8000-000000000005";
const trackingContextId =
  "01900000-0000-7000-8000-000000000006";
const finalizedAt = new Date("2026-07-29T12:10:00.000Z");

test("atomically closes a sealed manifest with a zero-result receipt", async () => {
  const harness = finalizationHarness();
  const result = await new RankFinalizationService(
    harness.prisma
  ).finalize(command("CANCELLED"));

  assert.deepEqual(harness.transactionOptions, [
    {
      isolationLevel: "ReadCommitted",
      maxWait: 5_000,
      timeout: 60_000
    }
  ]);
  assert.equal(harness.lockCalls, 1);
  assert.equal(harness.manifestUpdates, 1);
  assert.equal(harness.receiptWrites, 1);
  assert.equal(harness.outboxWrites, 0);
  assert.equal(harness.status, "CLOSED");
  assert.equal(result.status, "CANCELLED");
  assert.equal(result.pairCount, "2");
  assert.equal(result.persistedCount, "0");
  assert.equal(result.foundCount, "0");
  assert.equal(result.notFoundCount, "0");
  assert.equal(result.missingCount, "2");
  assert.equal(result.finalizedAt, finalizedAt.toISOString());
  assert.match(result.requestHash.value, /^[0-9a-f]{64}$/u);
  assert.equal(
    result.requestHash.value,
    "114ebd38191558a37d1805baca09128ce05dcc007a7335bf2c0c3b241bdf9409"
  );
});

test("returns the immutable receipt for same-status replay without rewriting it", async () => {
  const harness = finalizationHarness();
  const service = new RankFinalizationService(harness.prisma);
  const first = await service.finalize(command("FAILED"));
  const replay = await service.finalize({
    ...command("FAILED"),
    actorId: "01900000-0000-7000-8000-000000000099"
  });

  assert.deepEqual(replay, first);
  assert.equal(harness.lockCalls, 2);
  assert.equal(harness.manifestUpdates, 1);
  assert.equal(harness.receiptWrites, 1);
  assert.equal(harness.finalizedBy, actorId);
});

test("conflicts when an already finalized manifest receives another status", async () => {
  const harness = finalizationHarness();
  const service = new RankFinalizationService(harness.prisma);
  await service.finalize(command("CANCELLED"));

  await assert.rejects(
    () => service.finalize(command("FAILED")),
    (error: unknown) =>
      hasError(error, 409, "RANK_FINALIZATION_CONFLICT")
  );
  assert.equal(harness.manifestUpdates, 1);
  assert.equal(harness.receiptWrites, 1);
});

test("allows all safe zero-result terminal statuses", async () => {
  for (const status of [
    "CANCELLED",
    "FAILED",
    "ACTION_REQUIRED"
  ] as const) {
    const harness = finalizationHarness();
    const result = await new RankFinalizationService(
      harness.prisma
    ).finalize(command(status));
    assert.equal(result.status, status);
  }
});

test("fails closed when result-bearing status disagrees with persisted rows", async () => {
  for (const status of [
    "COMPLETED",
    "PARTIALLY_COMPLETED"
  ] as const) {
    const harness = finalizationHarness();
    await assert.rejects(
      () =>
        new RankFinalizationService(harness.prisma).finalize(
          command(status)
        ),
      (error: unknown) =>
        hasError(
          error,
          409,
          "RANK_FINALIZATION_OUTCOME_CONFLICT"
        )
    );
    assert.equal(harness.lockCalls, 1);
    assert.equal(harness.manifestUpdates, 0);
    assert.equal(harness.receiptWrites, 0);
    assert.equal(harness.outboxWrites, 0);
  }
});

test("derives complete counts and writes one redacted outbox event", async () => {
  const harness = finalizationHarness({
    ingest: {
      persistedCount: 2,
      foundCount: 1,
      notFoundCount: 1
    }
  });
  const result = await new RankFinalizationService(
    harness.prisma
  ).finalize(command("COMPLETED"));

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.persistedCount, "2");
  assert.equal(result.foundCount, "1");
  assert.equal(result.notFoundCount, "1");
  assert.equal(result.missingCount, "0");
  assert.equal(harness.outboxWrites, 1);
  assert.deepEqual(harness.outboxPayload, {
    jobId,
    manifestId,
    workspaceId,
    projectId,
    trackingContextId,
    configurationVersion: 2,
    status: "COMPLETED",
    pairCount: "2",
    persistedCount: "2",
    foundCount: "1",
    notFoundCount: "1",
    completedAt: finalizedAt.toISOString()
  });
});

test("derives partial counts and writes one completion event", async () => {
  const harness = finalizationHarness({
    ingest: {
      persistedCount: 1,
      foundCount: 0,
      notFoundCount: 1
    }
  });
  const result = await new RankFinalizationService(
    harness.prisma
  ).finalize(command("PARTIALLY_COMPLETED"));

  assert.equal(result.status, "PARTIALLY_COMPLETED");
  assert.equal(result.persistedCount, "1");
  assert.equal(result.missingCount, "1");
  assert.equal(harness.outboxWrites, 1);
});

test("keeps foreign tenant/job/manifest scope indistinguishable from missing", async () => {
  const harness = finalizationHarness();
  await assert.rejects(
    () =>
      new RankFinalizationService(harness.prisma).finalize({
        ...command("CANCELLED"),
        jobId: "01900000-0000-7000-8000-000000000099"
      }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 404
  );
  assert.equal(harness.manifestUpdates, 0);
  assert.equal(harness.receiptWrites, 0);
});

test("fails closed when a closed manifest has no immutable receipt", async () => {
  const harness = finalizationHarness({
    status: "CLOSED",
    closedAt: finalizedAt
  });
  await assert.rejects(
    () =>
      new RankFinalizationService(harness.prisma).finalize(
        command("CANCELLED")
      ),
    /has no finalization receipt/u
  );
  assert.equal(harness.manifestUpdates, 0);
  assert.equal(harness.receiptWrites, 0);
});

function command(
  status: RankCheckFinalStatus
): InternalFinalizeRankCheckInput {
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId,
    projectId,
    actorId,
    jobId,
    manifestId,
    status
  };
}

function hasError(
  error: unknown,
  status: number,
  code: string
): boolean {
  if (!(error instanceof HttpException) || error.getStatus() !== status) {
    return false;
  }
  const response = error.getResponse();
  return (
    typeof response === "object" &&
    response !== null &&
    "error" in response &&
    typeof response.error === "object" &&
    response.error !== null &&
    "code" in response.error &&
    response.error.code === code
  );
}

function finalizationHarness(
  initial: {
    readonly status?: "SEALED" | "CLOSED";
    readonly closedAt?: Date | null;
    readonly ingest?: {
      readonly persistedCount: number;
      readonly foundCount: number;
      readonly notFoundCount: number;
    };
  } = {}
) {
  let status = initial.status ?? ("SEALED" as "SEALED" | "CLOSED");
  let closedAt = initial.closedAt ?? null;
  let receipt: Record<string, unknown> | null = null;
  let lockCalls = 0;
  let manifestUpdates = 0;
  let receiptWrites = 0;
  let outboxWrites = 0;
  let outboxPayload: unknown;
  const transactionOptions: unknown[] = [];

  const transaction = {
    $queryRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      lockCalls += 1;
      const sql = strings.join("");
      assert.match(sql, /FROM "rank_execution_manifests"/u);
      assert.match(sql, /FOR UPDATE/u);
      assert.match(sql, /GREATEST\(clock_timestamp\(\), "sealed_at"\)/u);
      if (
        values[0] !== workspaceId ||
        values[1] !== projectId ||
        values[2] !== manifestId ||
        values[3] !== jobId
      ) {
        return [];
      }
      return [
        {
          id: manifestId,
          workspaceId,
          projectId,
          jobId,
          trackingContextId,
          configurationVersion: 2,
          pairCount: 2,
          status,
          sealedAt: new Date("2026-07-29T12:00:00.000Z"),
          closedAt,
          finalizedAt
        }
      ];
    },
    rankExecutionManifest: {
      update: async ({
        where,
        data
      }: {
        where: Readonly<Record<string, unknown>>;
        data: Readonly<Record<string, unknown>>;
      }) => {
        assert.deepEqual(where, { id: manifestId });
        assert.deepEqual(data, {
          status: "CLOSED",
          closedAt: finalizedAt
        });
        assert.equal(status, "SEALED");
        manifestUpdates += 1;
        status = "CLOSED";
        closedAt = finalizedAt;
        return { id: manifestId };
      }
    },
    rankChunkIngestReceipt: {
      aggregate: async ({
        where
      }: {
        where: Readonly<Record<string, unknown>>;
      }) => {
        assert.deepEqual(where, {
          workspaceId,
          projectId,
          manifestId,
          jobId
        });
        return {
          _sum: {
            persistedCount:
              initial.ingest?.persistedCount ?? null,
            foundCount: initial.ingest?.foundCount ?? null,
            notFoundCount:
              initial.ingest?.notFoundCount ?? null
          }
        };
      }
    },
    rankCheckFinalizationReceipt: {
      findUnique: async () => receipt,
      create: async ({
        data
      }: {
        data: Record<string, unknown>;
      }) => {
        assert.equal(status, "CLOSED");
        receiptWrites += 1;
        receipt = { ...data };
        return receipt;
      }
    },
    outboxEvent: {
      create: async ({
        data
      }: {
        data: Readonly<Record<string, unknown>>;
      }) => {
        assert.equal(
          data.eventType,
          "seo.rank-check.completed.v1"
        );
        assert.equal(data.aggregateId, manifestId);
        assert.equal(data.workspaceId, workspaceId);
        assert.equal(data.projectId, projectId);
        assert.deepEqual(data.metadata, {
          producer: "seo-data",
          source: "rank-results"
        });
        outboxWrites += 1;
        outboxPayload = data.payload;
        return { id: "01900000-0000-7000-8000-000000000090" };
      }
    }
  };
  const prisma = {
    $transaction: async (
      work: (value: unknown) => Promise<unknown>,
      options: unknown
    ) => {
      transactionOptions.push(options);
      return work(transaction);
    }
  } as unknown as PrismaService;

  return {
    prisma,
    transactionOptions,
    get lockCalls() {
      return lockCalls;
    },
    get manifestUpdates() {
      return manifestUpdates;
    },
    get receiptWrites() {
      return receiptWrites;
    },
    get outboxWrites() {
      return outboxWrites;
    },
    get outboxPayload() {
      return outboxPayload;
    },
    get status() {
      return status;
    },
    get finalizedBy() {
      return receipt?.finalizedBy;
    }
  };
}
