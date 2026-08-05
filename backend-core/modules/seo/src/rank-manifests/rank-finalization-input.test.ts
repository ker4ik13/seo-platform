import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { internalFinalizeRankCheckInput } from "./rank-finalization-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const manifestId = "01900000-0000-7000-8000-000000000005";

test("validates the exact finalization contract and canonicalizes UUIDs", () => {
  for (const status of [
    "COMPLETED",
    "PARTIALLY_COMPLETED",
    "CANCELLED",
    "FAILED",
    "ACTION_REQUIRED"
  ] as const) {
    assert.deepEqual(
      internalFinalizeRankCheckInput({
        ...command(status),
        workspaceId: workspaceId.toUpperCase()
      }),
      command(status)
    );
  }
});

test("rejects missing, unknown and extra finalization fields", () => {
  assert.throws(
    () =>
      internalFinalizeRankCheckInput({
        ...command("CANCELLED"),
        schemaVersion: "rank-finalize@2"
      }),
    BadRequestException
  );
  assert.throws(
    () => {
      const { actorId: _actorId, ...missingActor } =
        command("CANCELLED");
      return internalFinalizeRankCheckInput(missingActor);
    },
    BadRequestException
  );
  assert.throws(
    () =>
      internalFinalizeRankCheckInput({
        ...command("CANCELLED"),
        status: "QUEUED"
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalFinalizeRankCheckInput({
        ...command("CANCELLED"),
        persistedCount: "0"
      }),
    BadRequestException
  );
});

function command(
  status:
    | "COMPLETED"
    | "PARTIALLY_COMPLETED"
    | "CANCELLED"
    | "FAILED"
    | "ACTION_REQUIRED"
) {
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId,
    projectId,
    actorId,
    jobId,
    manifestId,
    status
  } as const;
}
