import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  acceptWorkspaceInviteInput,
  createWorkspaceInviteInput,
  updateWorkspaceMemberInput
} from "./team-input.js";

const projectId = "01900000-0000-7000-8000-000000000001";

test("parses a scoped workspace invitation", () => {
  assert.deepEqual(
    createWorkspaceInviteInput({
      email: "member@example.com",
      roleCode: "SEO_SPECIALIST",
      allProjects: false,
      projectAccesses: [{ projectId, level: "MEMBER" }],
      expiresInDays: 14
    }),
    {
      email: "member@example.com",
      roleCode: "SEO_SPECIALIST",
      allProjects: false,
      projectAccesses: [{ projectId, level: "MEMBER" }],
      expiresInDays: 14
    }
  );
});

test("rejects an owner assignment through ordinary member input", () => {
  assert.throws(
    () =>
      updateWorkspaceMemberInput({
        roleCode: "OWNER",
        allProjects: true,
        projectAccesses: []
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "INVALID_ROLE"
  );
});

test("requires an accessible project for limited membership", () => {
  assert.throws(
    () =>
      createWorkspaceInviteInput({
        email: "member@example.com",
        roleCode: "VIEWER",
        allProjects: false,
        projectAccesses: [{ projectId, level: "NONE" }]
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "PROJECT_ACCESS_REQUIRED"
  );
});

test("accepts an opaque invitation token", () => {
  const token = "a".repeat(64);
  assert.deepEqual(acceptWorkspaceInviteInput({ token }), { token });
});
