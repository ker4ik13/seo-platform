import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import {
  realtimeTicketRequestSchemaVersion,
  type RealtimeProjectTicket
} from "@seo-platform/contracts";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { RealtimeTicketController } from "./realtime-ticket.controller.js";
import { RealtimeTicketService } from "./realtime-ticket.service.js";

const ID = "0198f258-8cc7-7abc-8def-1234567890ab";

test("requires the Platform API credential and exact duplicated trusted context", async () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, RealtimeTicketController),
    [PlatformApiGuard]
  );
  let captured: readonly unknown[] | undefined;
  const controller = new RealtimeTicketController({
    issue: async (...args: unknown[]) => {
      captured = args;
      return ticketResult();
    }
  } as unknown as RealtimeTicketService);

  const response = await controller.issue(
    projectId(),
    headers(),
    command(),
    { id: "owner-request-001" } as never
  );

  assert.equal(response.data.namespace, "/collaboration");
  assert.deepEqual(captured?.[0], {
    actorId: ID,
    workspaceId: workspaceId(),
    projectId: projectId(),
    membershipId: membershipId(),
    membershipVersion: 4
  });
  assert.deepEqual(captured?.[1], command());
});

test("rejects route/header mismatch and extra command fields", async () => {
  const controller = new RealtimeTicketController({
    issue: async () => ticketResult()
  } as unknown as RealtimeTicketService);

  await assert.rejects(
    controller.issue(ID, headers(), command(), { id: "request" } as never),
    /does not match the route/u
  );
  await assert.rejects(
    controller.issue(
      projectId(),
      headers(),
      { ...command(), room: `project:${projectId()}` },
      { id: "request" } as never
    ),
    /Invalid realtime ticket authorization command/u
  );
});

function headers() {
  return {
    "x-actor-id": ID,
    "x-workspace-id": workspaceId(),
    "x-project-id": projectId(),
    "x-membership-id": membershipId(),
    "x-membership-version": "4"
  };
}

function command() {
  return {
    schemaVersion: realtimeTicketRequestSchemaVersion,
    userId: ID,
    sessionId: "0198f258-8cc7-7abc-8def-1234567890ac",
    sessionFamilyId: "0198f258-8cc7-7abc-8def-1234567890ad",
    sessionExpiresAt: "2026-08-30T12:00:00.000Z",
    workspaceId: workspaceId(),
    projectId: projectId(),
    membershipId: membershipId(),
    membershipVersion: 4,
    clientInstanceId: "0198f258-8cc7-7abc-8def-1234567890b1",
    origin: "https://app.example.test"
  } as const;
}

function ticketResult(): RealtimeProjectTicket {
  const issuedAt = new Date("2026-07-30T12:00:00.000Z");
  return {
    ticket: randomBytes(32).toString("base64url"),
    namespace: "/collaboration",
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 30_000).toISOString(),
    authorizationExpiresAt: new Date(
      issuedAt.getTime() + 60_000
    ).toISOString()
  };
}

function workspaceId(): string {
  return "0198f258-8cc7-7abc-8def-1234567890ae";
}

function projectId(): string {
  return "0198f258-8cc7-7abc-8def-1234567890af";
}

function membershipId(): string {
  return "0198f258-8cc7-7abc-8def-1234567890b0";
}
