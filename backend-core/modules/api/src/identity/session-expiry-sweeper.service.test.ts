import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  SessionExpirySweeperService,
  type SessionExpirySweeperLogger,
  type SessionExpirySweeperScheduler
} from "./session-expiry-sweeper.service.js";
import type { SessionService } from "./session.service.js";

const USER_A = "01900000-0000-7000-8000-000000000001";
const USER_B = "01900000-0000-7000-8000-000000000002";
const FAMILY_A = "01900000-0000-7000-8000-000000000010";
const FAMILY_B = "01900000-0000-7000-8000-000000000020";
const FAMILY_C = "01900000-0000-7000-8000-000000000030";
const FAMILY_D = "01900000-0000-7000-8000-000000000040";

interface Candidate {
  readonly user_id: string;
  readonly family_id: string;
}

interface QueryCall {
  readonly transaction: Prisma.TransactionClient;
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface RevokeCall {
  readonly transaction: Prisma.TransactionClient;
  readonly input: {
    readonly userId: string;
    readonly familyIds?: readonly string[];
    readonly requestId: string;
  };
}

test("is disabled by default without scheduling or touching the database", async () => {
  const fixture = sweeperFixture({ enabled: false, candidates: [candidate()] });

  fixture.service.onApplicationBootstrap();

  assert.equal(await fixture.service.runOnce(), 0);
  assert.equal(fixture.transactionCalls, 0);
  assert.deepEqual(fixture.scheduledDelays, []);
  assert.deepEqual(fixture.revokeCalls, []);
});

test("uses the indexed DB-clock due query and the shared transactional family revoke", async () => {
  const fixture = sweeperFixture({ candidates: [candidate()] });

  assert.equal(await fixture.service.runOnce(), 1);

  const candidateQuery = fixture.queryCalls.find(({ sql }) =>
    sql.includes("ORDER BY expires_at ASC, id ASC")
  );
  assert.ok(candidateQuery);
  assert.match(candidateQuery.sql, /revoked_at IS NULL/u);
  assert.match(candidateQuery.sql, /expires_at <= CURRENT_TIMESTAMP/u);
  assert.match(candidateQuery.sql, /ORDER BY expires_at ASC, id ASC/u);
  assert.match(candidateQuery.sql, /LIMIT \?/u);
  assert.deepEqual(candidateQuery.values, [3]);

  const dueQuery = fixture.queryCalls.find(({ sql }) =>
    sql.includes("SELECT EXISTS")
  );
  assert.ok(dueQuery);
  assert.match(dueQuery.sql, /user_id = \?::uuid/u);
  assert.match(dueQuery.sql, /family_id = \?::uuid/u);
  assert.match(dueQuery.sql, /revoked_at IS NULL/u);
  assert.match(dueQuery.sql, /expires_at <= CURRENT_TIMESTAMP/u);
  assert.deepEqual(dueQuery.values, [USER_A, FAMILY_A]);

  assert.deepEqual(fixture.operations, [
    "candidate-query",
    `lock:${USER_A}`,
    `due:${USER_A}:${FAMILY_A}`,
    `revoke:${USER_A}:${FAMILY_A}`
  ]);
  assert.equal(fixture.revokeCalls.length, 1);
  assert.strictEqual(
    fixture.revokeCalls[0]?.transaction,
    fixture.transactions[1]
  );
  assert.deepEqual(fixture.revokeCalls[0]?.input, {
    userId: USER_A,
    familyIds: [FAMILY_A],
    requestId: `session-expiry-${FAMILY_A}`
  });
  assert.doesNotMatch(
    fixture.revokeCalls[0]?.input.requestId ?? "",
    new RegExp(USER_A, "u")
  );
  assert.deepEqual(fixture.transactionOptions, [
    { maxWait: 500, timeout: 10_000 },
    { maxWait: 500, timeout: 10_000 }
  ]);
  for (const timeoutQuery of fixture.queryCalls.filter(({ sql }) =>
    sql.includes("set_config")
  )) {
    assert.deepEqual(timeoutQuery.values, ["500ms", "10000ms"]);
  }

  const schema = await readFile(
    new URL("../../prisma/schema.prisma", import.meta.url),
    "utf8"
  );
  assert.match(schema, /@@index\(\[expiresAt\]\)/u);
});

test("deduplicates user/family candidates in JS and enforces the configured per-run bound", async () => {
  const fixture = sweeperFixture({
    batchSize: 4,
    candidates: [
      candidate(USER_A, FAMILY_A),
      candidate(USER_A, FAMILY_A),
      candidate(USER_A, FAMILY_B),
      candidate(USER_B, FAMILY_C),
      candidate(USER_B, FAMILY_D),
      candidate(USER_A, FAMILY_D)
    ]
  });

  assert.equal(await fixture.service.runOnce(), 3);
  assert.deepEqual(
    fixture.revokeCalls.map(({ input }) => [
      input.userId,
      input.familyIds?.[0]
    ]),
    [
      [USER_A, FAMILY_A],
      [USER_A, FAMILY_B],
      [USER_B, FAMILY_C]
    ]
  );
  assert.ok(fixture.revokeCalls.length <= 4);
});

test("turns a no-longer-due race into a no-op before calling revokeFamilies", async () => {
  const fixture = sweeperFixture({
    candidates: [candidate()],
    initiallyDue: false
  });

  assert.equal(await fixture.service.runOnce(), 0);
  assert.deepEqual(fixture.revokeCalls, []);
  assert.deepEqual(fixture.operations, [
    "candidate-query",
    `lock:${USER_A}`,
    `due:${USER_A}:${FAMILY_A}`
  ]);
});

test("counts only a family actually changed by the shared helper", async () => {
  const fixture = sweeperFixture({
    candidates: [candidate()],
    revokeChangesFamily: false
  });

  assert.equal(await fixture.service.runOnce(), 0);
  assert.equal(fixture.revokeCalls.length, 1);
});

test("coalesces overlapping runs into one candidate transaction", async () => {
  const gate = deferred<void>();
  const fixture = sweeperFixture({ candidateQueryGate: gate.promise });

  const first = fixture.service.runOnce();
  const second = fixture.service.runOnce();

  assert.strictEqual(first, second);
  assert.equal(fixture.transactionCalls, 1);
  gate.resolve(undefined);
  assert.equal(await first, 0);
});

test("propagates a database failure to direct callers", async () => {
  const secret = "DATABASE_URL=postgresql://secret-never-log";
  const fixture = sweeperFixture({ candidateQueryError: new Error(secret) });

  await assert.rejects(fixture.service.runOnce(), { message: secret });
  assert.deepEqual(fixture.logs, []);
});

test("logs only a fixed failure code and retries at the bounded interval", async () => {
  const secret = "refresh_token=must-never-appear";
  const fixture = sweeperFixture({
    candidateQueryError: new Error(secret),
    intervalMs: 2_500
  });
  fixture.service.onApplicationBootstrap();
  assert.deepEqual(fixture.scheduledDelays, [0]);

  fixture.runScheduled(0);
  await flushMicrotasks();

  assert.deepEqual(fixture.logs, ["SESSION_EXPIRY_SWEEPER_TICK_FAILED"]);
  assert.doesNotMatch(fixture.logs.join(" "), /refresh_token|must-never/u);
  assert.deepEqual(fixture.scheduledDelays, [2_500]);
  await fixture.service.beforeApplicationShutdown();
  assert.equal(fixture.cancelCalls, 1);
});

test("shutdown waits for only the current bounded transaction and stops before another family", async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  const fixture = sweeperFixture({
    candidates: [
      candidate(USER_A, FAMILY_A),
      candidate(USER_B, FAMILY_B)
    ],
    onRevoke: async (familyId) => {
      if (familyId !== FAMILY_A) return;
      started.resolve(undefined);
      await release.promise;
    }
  });
  fixture.service.onApplicationBootstrap();
  const active = fixture.service.runOnce();
  await started.promise;

  let shutdownFinished = false;
  const shutdown = fixture.service.beforeApplicationShutdown().then(() => {
    shutdownFinished = true;
  });
  await Promise.resolve();
  assert.equal(shutdownFinished, false);
  assert.equal(fixture.cancelCalls, 1);

  release.resolve(undefined);
  assert.equal(await active, 1);
  await shutdown;
  assert.equal(shutdownFinished, true);
  assert.deepEqual(
    fixture.revokeCalls.map(({ input }) => input.familyIds?.[0]),
    [FAMILY_A]
  );
  assert.ok(
    fixture.transactionOptions.every(
      (options) => options.maxWait === 500 && options.timeout === 10_000
    )
  );
});

function candidate(
  userId = USER_A,
  familyId = FAMILY_A
): Candidate {
  return { user_id: userId, family_id: familyId };
}

function sweeperFixture(options: {
  readonly enabled?: boolean;
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly candidates?: readonly Candidate[];
  readonly initiallyDue?: boolean;
  readonly revokeChangesFamily?: boolean;
  readonly candidateQueryGate?: Promise<void>;
  readonly candidateQueryError?: Error;
  readonly onRevoke?: (familyId: string) => Promise<void>;
} = {}): {
  readonly service: SessionExpirySweeperService;
  readonly queryCalls: QueryCall[];
  readonly revokeCalls: RevokeCall[];
  readonly operations: string[];
  readonly logs: string[];
  readonly transactions: Prisma.TransactionClient[];
  readonly transactionOptions: Array<{ maxWait: number; timeout: number }>;
  readonly scheduledDelays: readonly number[];
  readonly transactionCalls: number;
  readonly cancelCalls: number;
  runScheduled(index: number): void;
} {
  const queryCalls: QueryCall[] = [];
  const revokeCalls: RevokeCall[] = [];
  const operations: string[] = [];
  const logs: string[] = [];
  const transactions: Prisma.TransactionClient[] = [];
  const transactionOptions: Array<{ maxWait: number; timeout: number }> = [];
  const scheduled: Array<{
    readonly task: () => void;
    readonly delayMs: number;
  }> = [];
  const dueFamilies = new Map<string, boolean>();
  for (const row of options.candidates ?? []) {
    dueFamilies.set(
      `${row.user_id}:${row.family_id}`,
      options.initiallyDue ?? true
    );
  }
  let transactionCalls = 0;
  let cancelCalls = 0;

  const prisma = {
    $transaction: async <T>(
      operation: (transaction: Prisma.TransactionClient) => Promise<T>,
      transactionOption: { maxWait: number; timeout: number }
    ): Promise<T> => {
      transactionCalls += 1;
      transactionOptions.push(transactionOption);
      let transaction: Prisma.TransactionClient;
      const queryRaw = async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<unknown> => {
        const sql = normalizeSql(strings);
        queryCalls.push({ transaction, sql, values });
        if (sql.includes("set_config")) return [];
        if (sql.includes("ORDER BY expires_at ASC, id ASC")) {
          operations.push("candidate-query");
          if (options.candidateQueryGate) {
            await options.candidateQueryGate;
          }
          if (options.candidateQueryError) {
            throw options.candidateQueryError;
          }
          return [...(options.candidates ?? [])];
        }
        if (sql.includes("SELECT EXISTS")) {
          const userId = values[0] as string;
          const familyId = values[1] as string;
          operations.push(`due:${userId}:${familyId}`);
          return [
            {
              is_due: dueFamilies.get(`${userId}:${familyId}`) ?? false
            }
          ];
        }
        throw new Error("Unexpected session expiry SQL");
      };
      transaction = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;
      transactions.push(transaction);
      return operation(transaction);
    }
  } as unknown as PrismaService;
  const sessions = {
    lockUserSessionLifecycle: async (
      _transaction: Prisma.TransactionClient,
      userId: string
    ) => {
      operations.push(`lock:${userId}`);
    },
    revokeFamilies: async (
      transaction: Prisma.TransactionClient,
      input: RevokeCall["input"]
    ) => {
      const familyId = input.familyIds?.[0];
      assert.ok(familyId);
      operations.push(`revoke:${input.userId}:${familyId}`);
      revokeCalls.push({ transaction, input });
      await options.onRevoke?.(familyId);
      if (options.revokeChangesFamily === false) {
        return { revokedSessionCount: 0, revokedFamilyIds: [] };
      }
      dueFamilies.set(`${input.userId}:${familyId}`, false);
      return { revokedSessionCount: 1, revokedFamilyIds: [familyId] };
    }
  } as unknown as SessionService;
  const scheduler: SessionExpirySweeperScheduler = {
    schedule: (task, delayMs) => {
      const handle = { task, delayMs };
      scheduled.push(handle);
      return handle;
    },
    cancel: () => {
      cancelCalls += 1;
    }
  };
  const logger: SessionExpirySweeperLogger = {
    warn: (message) => logs.push(message)
  };
  const config = {
    sessionExpirySweeper: {
      enabled: options.enabled ?? true,
      intervalMs: options.intervalMs ?? 1_000,
      batchSize: options.batchSize ?? 3,
      transactionTimeoutMs: 10_000,
      lockTimeoutMs: 500
    }
  } as AppConfig;
  const service = new SessionExpirySweeperService(
    config,
    prisma,
    sessions,
    scheduler,
    logger
  );

  return {
    service,
    queryCalls,
    revokeCalls,
    operations,
    logs,
    transactions,
    transactionOptions,
    get scheduledDelays() {
      return scheduled.map(({ delayMs }) => delayMs);
    },
    get transactionCalls() {
      return transactionCalls;
    },
    get cancelCalls() {
      return cancelCalls;
    },
    runScheduled(index) {
      const scheduledTask = scheduled.splice(index, 1)[0];
      assert.ok(scheduledTask);
      scheduledTask.task();
    }
  };
}

function normalizeSql(strings: TemplateStringsArray): string {
  return strings.join("?").replace(/\s+/gu, " ").trim();
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      assert.ok(resolvePromise);
      resolvePromise(value);
    }
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}
