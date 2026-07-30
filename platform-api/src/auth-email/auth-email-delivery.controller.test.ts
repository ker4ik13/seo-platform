import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  MODULE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthEmailDeliveryController } from "./auth-email-delivery.controller.js";
import { AuthEmailDeliveryGuard } from "./auth-email-delivery.guard.js";
import { AuthEmailDeliveryModule } from "./auth-email-delivery.module.js";
import type { AuthEmailDeliveryService } from "./auth-email-delivery.service.js";

const EVENT_ID = "01900000-0000-7000-8000-000000000101";
const OTHER_ID = "01900000-0000-7000-8000-000000000102";
const REQUEST_ID = "request-auth-email-001";

test("declares only the two dedicated guarded internal POST routes", () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, AuthEmailDeliveryController),
    "internal/v1/auth-email-deliveries"
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, AuthEmailDeliveryController),
    [AuthEmailDeliveryGuard]
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      AuthEmailDeliveryController.prototype.material
    ),
    ":eventId/material"
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      AuthEmailDeliveryController.prototype.complete
    ),
    ":eventId/complete"
  );
  assert.equal(
    Reflect.getMetadata(
      HTTP_CODE_METADATA,
      AuthEmailDeliveryController.prototype.material
    ),
    200
  );
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    AuthEmailDeliveryModule
  ) as readonly unknown[];
  assert.deepEqual(controllers, [AuthEmailDeliveryController]);
});

test("returns strict no-store material and completion receipts with request metadata", async () => {
  const calls: string[] = [];
  const controller = new AuthEmailDeliveryController({
    material: async (eventId: string) => {
      calls.push(`material:${eventId}`);
      return {
        schemaVersion: "auth-email-material-decision@1",
        decision: "SKIPPED",
        eventId,
        reason: "NOT_DELIVERABLE"
      };
    },
    complete: async (eventId: string, outcome: "DELIVERED" | "BOUNCED") => {
      calls.push(`complete:${eventId}:${outcome}`);
      return {
        schemaVersion: "auth-email-completion-receipt@1",
        eventId,
        outcome
      };
    }
  } as AuthEmailDeliveryService);
  const materialReply = reply();
  assert.deepEqual(
    await controller.material(
      EVENT_ID.toUpperCase(),
      {},
      request(),
      materialReply.value
    ),
    {
      data: {
        schemaVersion: "auth-email-material-decision@1",
        decision: "SKIPPED",
        eventId: EVENT_ID,
        reason: "NOT_DELIVERABLE"
      },
      meta: { requestId: REQUEST_ID }
    }
  );
  assert.equal(materialReply.headers.get("cache-control"), "no-store");

  const completeReply = reply();
  assert.deepEqual(
    await controller.complete(
      EVENT_ID,
      {
        schemaVersion: "auth-email-completion@1",
        eventId: EVENT_ID,
        outcome: "DELIVERED"
      },
      request(),
      completeReply.value
    ),
    {
      data: {
        schemaVersion: "auth-email-completion-receipt@1",
        eventId: EVENT_ID,
        outcome: "DELIVERED"
      },
      meta: { requestId: REQUEST_ID }
    }
  );
  assert.equal(completeReply.headers.get("cache-control"), "no-store");
  const bouncedReply = reply();
  assert.deepEqual(
    await controller.complete(
      EVENT_ID,
      {
        schemaVersion: "auth-email-completion@1",
        eventId: EVENT_ID,
        outcome: "BOUNCED"
      },
      request(),
      bouncedReply.value
    ),
    {
      data: {
        schemaVersion: "auth-email-completion-receipt@1",
        eventId: EVENT_ID,
        outcome: "BOUNCED"
      },
      meta: { requestId: REQUEST_ID }
    }
  );
  assert.equal(bouncedReply.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, [
    `material:${EVENT_ID}`,
    `complete:${EVENT_ID}:DELIVERED`,
    `complete:${EVENT_ID}:BOUNCED`
  ]);
});

test("rejects request-id mismatch, non-empty material and completion path/body mismatch before service", async () => {
  let calls = 0;
  const controller = new AuthEmailDeliveryController({
    material: async () => {
      calls += 1;
      throw new Error("unreachable");
    },
    complete: async () => {
      calls += 1;
      throw new Error("unreachable");
    }
  } as unknown as AuthEmailDeliveryService);

  await assert.rejects(
    controller.material(
      EVENT_ID,
      { extra: true },
      request(),
      reply().value
    ),
    BadRequestException
  );
  await assert.rejects(
    controller.material(
      EVENT_ID,
      {},
      request({ id: "another-request" }),
      reply().value
    ),
    BadRequestException
  );
  await assert.rejects(
    controller.complete(
      EVENT_ID,
      {
        schemaVersion: "auth-email-completion@1",
        eventId: OTHER_ID,
        outcome: "DELIVERED"
      },
      request(),
      reply().value
    ),
    BadRequestException
  );
  await assert.rejects(
    controller.material(
      "01900000-0000-4000-8000-000000000101",
      {},
      request(),
      reply().value
    ),
    BadRequestException
  );
  assert.equal(calls, 0);
});

function request(
  overrides: { readonly id?: string; readonly requestHeader?: string } = {}
): FastifyRequest {
  return {
    id: overrides.id ?? REQUEST_ID,
    headers: {
      "x-request-id": overrides.requestHeader ?? REQUEST_ID
    }
  } as unknown as FastifyRequest;
}

function reply(): {
  readonly value: FastifyReply;
  readonly headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  return {
    value: {
      header: (name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
      }
    } as unknown as FastifyReply,
    headers
  };
}
