import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePushInstallationRecord,
  pushReconciliationRequired,
  PushInstallationStorageError,
  reconcilePushInstallationRecord,
  type PushInstallationRecord,
  withCompletedPushReconciliation,
  withRequestedPushReconciliation
} from "./push-installation.ts";

const ownerId = "01900000-0000-7000-8000-000000000001";
const otherOwnerId = "01900000-0000-7000-8000-000000000002";
const installationId = "ba8f5c70-b5ab-4ac0-ae49-649f60df7fc4";
const timestamp = "2026-07-29T12:00:00.000Z";

test("creates one durable installation with pending generation", () => {
  const binding = reconcilePushInstallationRecord(
    undefined,
    ownerId,
    () => installationId,
    () => timestamp
  );

  assert.deepEqual(binding, {
    record: {
      schemaVersion: 2,
      installationId,
      ownerUserId: ownerId,
      reconcileGeneration: 1,
      reconciledGeneration: 0,
      updatedAt: timestamp
    },
    ownerConflict: false,
    created: true
  });
  assert.equal(pushReconciliationRequired(binding.record), true);
});

test("never silently transfers an installation to another account", () => {
  const record = validRecord();
  const binding = reconcilePushInstallationRecord(
    record,
    otherOwnerId,
    () => {
      throw new Error("must not rotate implicitly");
    },
    () => {
      throw new Error("must not mutate implicitly");
    }
  );

  assert.equal(binding.record, record);
  assert.equal(binding.ownerConflict, true);
  assert.equal(binding.created, false);
});

test("migrates both v1 marker states and rejects a future schema", () => {
  assert.deepEqual(
    parsePushInstallationRecord(versionOneRecord(true)),
    {
      ...validRecord(),
      reconcileGeneration: 1,
      reconciledGeneration: 0
    }
  );
  assert.deepEqual(
    parsePushInstallationRecord(versionOneRecord(false)),
    {
      ...validRecord(),
      reconcileGeneration: 0,
      reconciledGeneration: 0
    }
  );
  assert.throws(
    () =>
      parsePushInstallationRecord({
        schemaVersion: 3,
        installationId,
        ownerUserId: ownerId,
        updatedAt: timestamp
      }),
    (error: unknown) =>
      error instanceof PushInstallationStorageError &&
      error.code === "FUTURE_VERSION"
  );
});

test("CAS completion preserves newer SW and multi-tab generations", () => {
  const foreground = withRequestedPushReconciliation(
    validRecord(),
    ownerId,
    installationId,
    () => "2026-07-29T12:01:00.000Z"
  );
  const serviceWorker = withRequestedPushReconciliation(
    foreground,
    ownerId,
    installationId,
    () => "2026-07-29T12:02:00.000Z"
  );
  const otherTab = withRequestedPushReconciliation(
    serviceWorker,
    ownerId,
    installationId,
    () => "2026-07-29T12:03:00.000Z"
  );

  assert.equal(foreground.reconcileGeneration, 2);
  assert.equal(serviceWorker.reconcileGeneration, 3);
  assert.equal(otherTab.reconcileGeneration, 4);

  const staleForeground = withCompletedPushReconciliation(
    otherTab,
    ownerId,
    installationId,
    foreground.reconcileGeneration,
    () => "2026-07-29T12:04:00.000Z"
  );
  const staleWorker = withCompletedPushReconciliation(
    staleForeground.record,
    ownerId,
    installationId,
    serviceWorker.reconcileGeneration,
    () => "2026-07-29T12:05:00.000Z"
  );
  assert.equal(staleForeground.cleared, false);
  assert.equal(staleWorker.cleared, false);
  assert.equal(staleWorker.record.reconcileGeneration, 4);
  assert.equal(staleWorker.record.reconciledGeneration, 0);

  const currentCompletion = withCompletedPushReconciliation(
    staleWorker.record,
    ownerId,
    installationId,
    otherTab.reconcileGeneration,
    () => "2026-07-29T12:06:00.000Z"
  );
  assert.equal(currentCompletion.cleared, true);
  assert.equal(currentCompletion.record.reconciledGeneration, 4);
  assert.equal(pushReconciliationRequired(currentCompletion.record), false);

  const lateForeground = withCompletedPushReconciliation(
    currentCompletion.record,
    ownerId,
    installationId,
    foreground.reconcileGeneration,
    () => "2026-07-29T12:07:00.000Z"
  );
  assert.equal(lateForeground.cleared, false);
  assert.equal(lateForeground.record.reconciledGeneration, 4);
});

test("rejects reconciliation for a stale account or installation", () => {
  assert.throws(
    () =>
      withRequestedPushReconciliation(
        validRecord(),
        otherOwnerId,
        installationId,
        () => timestamp
      ),
    (error: unknown) =>
      error instanceof PushInstallationStorageError &&
      error.code === "STALE_RECORD"
  );
});

function versionOneRecord(reconcileRequired: boolean) {
  return {
    schemaVersion: 1,
    installationId,
    ownerUserId: ownerId,
    reconcileRequired,
    updatedAt: timestamp
  };
}

function validRecord(): PushInstallationRecord {
  return {
    schemaVersion: 2,
    installationId,
    ownerUserId: ownerId,
    reconcileGeneration: 1,
    reconciledGeneration: 0,
    updatedAt: timestamp
  };
}
