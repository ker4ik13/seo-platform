import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import {
  IntegrationCredentialExecutionBrokerService
} from "./integration-credential-execution-broker.service.js";

test("execution canary request rejects invalid or unbounded versions before SQL", async () => {
  const { broker, queryCalls } = brokerReturning([]);
  const invalid: readonly (readonly number[])[] = [
    [0],
    [2_147_483_648],
    [1, 1],
    Array.from({ length: 129 }, (_, index) => index + 1)
  ];

  for (const versions of invalid) {
    await assert.rejects(
      broker.executionKekCanaries(versions),
      /Invalid integration credential broker/u
    );
  }
  assert.equal(queryCalls(), 0);
});

test("execution canary response requires every requested version", async () => {
  const { broker } = brokerReturning([]);

  await assert.rejects(
    broker.executionKekCanaries([2]),
    /missing requested canary version/u
  );
});

test("execution canary response allows used but rejects unused unrequested versions", async () => {
  const allowed = brokerReturning([
    canaryRow(2, false),
    canaryRow(7, true)
  ]).broker;
  assert.deepEqual(
    await allowed.executionKekCanaries([2]),
    [
      { keyVersion: 2, usedByCredential: false },
      { keyVersion: 7, usedByCredential: true }
    ]
  );

  const rejected = brokerReturning([
    canaryRow(2, false),
    canaryRow(7, false)
  ]).broker;
  await assert.rejects(
    rejected.executionKekCanaries([2]),
    /unrequested unused canary version/u
  );
});

test("execution canary response rejects a missing usage marker", async () => {
  const row = canaryRow(2, false);
  const { usedByCredential: _marker, ...withoutMarker } = row;
  const { broker } = brokerReturning([withoutMarker]);

  await assert.rejects(
    broker.executionKekCanaries([2]),
    /canary usage marker/u
  );
});

test("execution canary response rejects an oversized projection", async () => {
  const rows = Array.from({ length: 129 }, (_, index) =>
    canaryRow(index + 1, true)
  );
  const { broker } = brokerReturning(rows);

  await assert.rejects(
    broker.executionKekCanaries([1]),
    /canary projection limit/u
  );
});

test("claimed broker response requires a lease deadline", async () => {
  const { broker } = brokerReturning([
    claimRow({
      claimOutcome: "CLAIMED",
      scopeState: "STALE",
      leaseToken: "0190abcd-0000-7000-8000-0000000000d5",
      leaseExpiresAt: null
    })
  ]);

  await assert.rejects(
    broker.claimValidation(
      "0190abcd-0000-7000-8000-0000000000c4",
      "connector-worker-1",
      30
    ),
    /lease expiry/u
  );
});

test("unclaimed broker response rejects a leaked lease deadline", async () => {
  const { broker } = brokerReturning([
    claimRow({
      claimOutcome: "NOT_CLAIMABLE",
      scopeState: "NOT_APPLICABLE",
      leaseToken: null,
      leaseExpiresAt: new Date(Date.now() + 30_000)
    })
  ]);

  await assert.rejects(
    broker.claimValidation(
      "0190abcd-0000-7000-8000-0000000000c4",
      "connector-worker-1",
      30
    ),
    /unclaimed lease projection/u
  );
});

function brokerReturning(rows: readonly unknown[]): {
  readonly broker: IntegrationCredentialExecutionBrokerService;
  readonly queryCalls: () => number;
} {
  let calls = 0;
  const prisma = {
    $queryRaw: async () => {
      calls += 1;
      return rows;
    }
  } as unknown as PrismaService;
  return {
    broker: new IntegrationCredentialExecutionBrokerService(prisma),
    queryCalls: () => calls
  };
}

function canaryRow(keyVersion: number, usedByCredential: boolean) {
  return {
    keyVersion,
    usedByCredential,
    ciphertext: null,
    nonce: null,
    authTag: null,
    encryptedDataKey: null,
    dataKeyNonce: null,
    dataKeyAuthTag: null
  };
}

function claimRow(overrides: Readonly<Record<string, unknown>>) {
  return {
    claimOutcome: "NOT_CLAIMABLE",
    scopeState: "NOT_APPLICABLE",
    validationId: "0190abcd-0000-7000-8000-0000000000c4",
    leaseToken: null,
    leaseExpiresAt: null,
    jobVersion: 2,
    workspaceId: "0190abcd-0000-7000-8000-000000000001",
    provider: "KEYS_SO",
    credentialId: "0190abcd-0000-7000-8000-0000000000b3",
    credentialMaterialVersion: 3,
    connectorVersion: "keys-so@1.0.0",
    keyVersion: null,
    ciphertext: null,
    nonce: null,
    authTag: null,
    encryptedDataKey: null,
    dataKeyNonce: null,
    dataKeyAuthTag: null,
    jobStatus: "RUNNING",
    errorCode: null,
    requestedAt: new Date("2026-07-30T10:00:00.000Z"),
    startedAt: new Date("2026-07-30T10:00:01.000Z"),
    retryAt: null,
    finishedAt: null,
    ...overrides
  };
}
