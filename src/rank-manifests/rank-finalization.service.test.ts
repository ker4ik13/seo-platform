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
      timeout: 15_000
    }
  ]);
  assert.equal(harness.lockCalls, 1);
  assert.equal(harness.manifestUpdates, 1);
  assert.equal(harness.receiptWrites, 1);
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

test("fails closed for result-bearing terminal statuses before storage access", async () => {
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
        hasError(error, 409, "RANK_INGEST_NOT_READY")
    );
    assert.equal(harness.lockCalls, 0);
    assert.equal(harness.manifestUpdates, 0);
    assert.equal(harness.receiptWrites, 0);
  }
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
  } = {}
) {
  let status = initial.status ?? ("SEALED" as "SEALED" | "CLOSED");
  let closedAt = initial.closedAt ?? null;
  let receipt: Record<string, unknown> | null = null;
  let lockCalls = 0;
  let manifestUpdates = 0;
  let receiptWrites = 0;
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
    get status() {
      return status;
    },
    get finalizedBy() {
      return receipt?.finalizedBy;
    }
  };
}
