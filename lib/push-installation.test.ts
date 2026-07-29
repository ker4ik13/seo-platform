import assert from "node:assert/strict";
import test from "node:test";
import {
  PushInstallationStorageError,
  reconcilePushInstallationRecord,
  type PushInstallationRecord,
  withPushReconciliation
} from "./push-installation.ts";

const ownerId = "01900000-0000-7000-8000-000000000001";
const otherOwnerId = "01900000-0000-7000-8000-000000000002";
const installationId = "ba8f5c70-b5ab-4ac0-ae49-649f60df7fc4";
const timestamp = "2026-07-29T12:00:00.000Z";

test("creates one durable installation bound to the current account", () => {
  const binding = reconcilePushInstallationRecord(
    undefined,
    ownerId,
    () => installationId,
    () => timestamp
  );

  assert.deepEqual(binding, {
    record: {
      schemaVersion: 1,
      installationId,
      ownerUserId: ownerId,
      reconcileRequired: true,
      updatedAt: timestamp
    },
    ownerConflict: false,
    created: true
  });
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

test("marks only the expected account and installation as reconciled", () => {
  assert.deepEqual(
    withPushReconciliation(
      validRecord(),
      ownerId,
      installationId,
      false,
      () => "2026-07-29T12:01:00.000Z"
    ),
    {
      ...validRecord(),
      reconcileRequired: false,
      updatedAt: "2026-07-29T12:01:00.000Z"
    }
  );
  assert.throws(
    () =>
      withPushReconciliation(
        validRecord(),
        otherOwnerId,
        installationId,
        false,
        () => timestamp
      ),
    (error: unknown) =>
      error instanceof PushInstallationStorageError &&
      error.code === "STALE_RECORD"
  );
});

function validRecord(): PushInstallationRecord {
  return {
    schemaVersion: 1,
    installationId,
    ownerUserId: ownerId,
    reconcileRequired: true,
    updatedAt: timestamp
  };
}
