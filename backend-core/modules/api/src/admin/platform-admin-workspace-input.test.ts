import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  adminSubscriptionPrecondition,
  adminWorkspaceSearchQuery,
  grantAdminWorkspaceSubscriptionInput
} from "./platform-admin-workspace-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const now = new Date("2026-08-05T20:00:00.000Z");

test("parses a confirmed bounded workspace subscription grant", () => {
  assert.deepEqual(
    grantAdminWorkspaceSubscriptionInput(
      {
        planCode: "AGENCY",
        planVersion: 3,
        currentPeriodEnd: "2031-08-05T19:59:59.000Z",
        confirmWorkspaceId: workspaceId,
        confirmed: true,
        reason: "Founder production workspace grant"
      },
      workspaceId,
      now
    ),
    {
      planCode: "AGENCY",
      planVersion: 3,
      currentPeriodEnd: "2031-08-05T19:59:59.000Z",
      confirmWorkspaceId: workspaceId,
      confirmed: true,
      reason: "Founder production workspace grant"
    }
  );
});

test("rejects an unconfirmed, mismatched or overlong grant", () => {
  const base = {
    planCode: "AGENCY",
    planVersion: 3,
    currentPeriodEnd: "2031-08-05T19:59:59.000Z",
    confirmWorkspaceId: workspaceId,
    confirmed: true,
    reason: "Founder production workspace grant"
  };
  for (const changed of [
    { confirmed: false },
    { confirmWorkspaceId: "01900000-0000-7000-8000-000000000002" },
    { currentPeriodEnd: "2031-08-05T20:00:01.000Z" },
    { internalOverride: true }
  ]) {
    assert.throws(
      () =>
        grantAdminWorkspaceSubscriptionInput(
          { ...base, ...changed },
          workspaceId,
          now
        ),
      DomainError
    );
  }
});

test("requires one exact version precondition", () => {
  assert.deepEqual(adminSubscriptionPrecondition("v7", undefined), {
    createOnly: false,
    expectedVersion: 7
  });
  assert.deepEqual(adminSubscriptionPrecondition(undefined, "*"), {
    createOnly: true
  });
  assert.throws(
    () => adminSubscriptionPrecondition(undefined, undefined),
    (error: unknown) =>
      error instanceof DomainError && error.statusCode === 428
  );
  assert.throws(
    () => adminSubscriptionPrecondition("v1", "*"),
    DomainError
  );
});

test("normalizes bounded printable workspace search", () => {
  assert.equal(adminWorkspaceSearchQuery("  Кирилл  "), "Кирилл");
  assert.equal(adminWorkspaceSearchQuery(undefined), "");
  assert.throws(() => adminWorkspaceSearchQuery("bad\nquery"), DomainError);
});
