import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptProjectTransferInput,
  createProjectTransferInput
} from "./project-transfer.input.js";

const MEMBER_ID = "01900000-0000-7000-8000-000000000101";
const WORKSPACE_ID = "01900000-0000-7000-8000-000000000102";

test("accepts only a canonical target workspace member id", () => {
  assert.deepEqual(createProjectTransferInput({ targetMemberId: MEMBER_ID }), {
    targetMemberId: MEMBER_ID
  });
  assert.throws(
    () => createProjectTransferInput({ targetMemberId: "not-a-member" })
  );
  assert.throws(() => createProjectTransferInput({}));
});

test("accepts only a canonical destination workspace id", () => {
  assert.deepEqual(
    acceptProjectTransferInput({ destinationWorkspaceId: WORKSPACE_ID }),
    { destinationWorkspaceId: WORKSPACE_ID }
  );
  assert.throws(() => acceptProjectTransferInput({ destinationWorkspaceId: "bad" }));
  assert.throws(() => acceptProjectTransferInput({}));
});
