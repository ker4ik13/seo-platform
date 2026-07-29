import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  assertInternalContext,
  assertInternalWorkspaceContext,
  internalCommandContext,
  internalWorkspaceCommandContext
} from "./internal-command-context.js";

const context = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003"
} as const;

test("reads a complete trusted internal command context", () => {
  assert.deepEqual(
    internalCommandContext({
      "x-workspace-id": context.workspaceId,
      "x-project-id": context.projectId,
      "x-actor-id": context.actorId
    }),
    context
  );
});

test("rejects missing, malformed and mismatched trusted context", () => {
  assert.throws(
    () =>
      internalCommandContext({
        "x-workspace-id": context.workspaceId,
        "x-project-id": context.projectId
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalCommandContext({
        "x-workspace-id": "not-a-uuid",
        "x-project-id": context.projectId,
        "x-actor-id": context.actorId
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      assertInternalContext(context, {
        ...context,
        actorId: "01900000-0000-7000-8000-000000000004"
      }),
    BadRequestException
  );
});

test("reads and validates workspace-scoped trusted context", () => {
  const workspaceContext = {
    workspaceId: context.workspaceId,
    actorId: context.actorId
  };
  assert.deepEqual(
    internalWorkspaceCommandContext({
      "x-workspace-id": context.workspaceId,
      "x-actor-id": context.actorId
    }),
    workspaceContext
  );
  assert.throws(
    () =>
      assertInternalWorkspaceContext(workspaceContext, {
        ...workspaceContext,
        actorId: "01900000-0000-7000-8000-000000000004"
      }),
    BadRequestException
  );
});

test("canonicalizes trusted UUID headers before tenant comparison", () => {
  assert.deepEqual(
    internalWorkspaceCommandContext({
      "x-workspace-id": "0190ABCD-0000-7000-8000-0000000000EF",
      "x-actor-id": "0190ABCD-0000-7000-8000-0000000000AA"
    }),
    {
      workspaceId: "0190abcd-0000-7000-8000-0000000000ef",
      actorId: "0190abcd-0000-7000-8000-0000000000aa"
    }
  );
});
