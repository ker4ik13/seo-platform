import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { FastifyRequest } from "fastify";
import type { AuthorizationService } from "../authorization/authorization.service.js";
import { DomainError } from "../common/domain-error.js";
import { DeliveryAuthorizationController } from "./delivery-authorization.controller.js";
import { DeliveryAuthorizationGuard } from "./delivery-authorization.guard.js";
import { deliveryAuthorizationInput } from "./delivery-authorization.input.js";

const userId = "01900000-0000-7000-8000-000000000001";
const workspaceId = "01900000-0000-7000-8000-000000000002";
const projectId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";

test("protects fresh notification authorization with its dedicated guard", () => {
  assert.deepEqual(
    Reflect.getMetadata(
      GUARDS_METADATA,
      DeliveryAuthorizationController
    ),
    [DeliveryAuthorizationGuard]
  );
});

test("authorizes only the exact active membership generation", async () => {
  const controller = new DeliveryAuthorizationController({
    forProject: async () => tenant(7)
  } as unknown as AuthorizationService);

  const accepted = await controller.authorize(
    projectId,
    input(7),
    request()
  );
  const stale = await controller.authorize(
    projectId,
    input(6),
    request()
  );

  assert.deepEqual(accepted.data, {
    authorized: true,
    reason: "AUTHORIZED"
  });
  assert.deepEqual(stale.data, {
    authorized: false,
    reason: "SCOPE_CHANGED"
  });
});

test("converts revoked project access into a fail-closed decision", async () => {
  const controller = new DeliveryAuthorizationController({
    forProject: async () => {
      throw new DomainError({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Not found"
      });
    }
  } as unknown as AuthorizationService);

  const response = await controller.authorize(
    projectId,
    input(7),
    request()
  );
  assert.deepEqual(response.data, {
    authorized: false,
    reason: "ACCESS_REVOKED"
  });
});

test("rejects extra fields and mismatched event permissions", () => {
  assert.throws(
    () => deliveryAuthorizationInput({ ...input(7), endpoint: "secret" }),
    /Invalid project notification/u
  );
  assert.throws(
    () => deliveryAuthorizationInput({ ...input(7), permission: "project.view" }),
    /Invalid project notification/u
  );
});

function input(membershipVersion: number) {
  return {
    userId,
    workspaceId,
    projectId,
    membershipId,
    membershipVersion,
    eventType: "CRAWL_RADAR" as const,
    permission: "page.view" as const
  };
}

function tenant(membershipVersion: number) {
  return {
    workspaceId,
    workspaceStatus: "ACTIVE" as const,
    projectId,
    projectStatus: "ACTIVE" as const,
    roleCode: "OWNER",
    membershipId,
    membershipVersion
  };
}

function request(): FastifyRequest {
  return { id: "request-delivery-authorization-001" } as FastifyRequest;
}
