import assert from "node:assert/strict";
import test from "node:test";
import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type { ApiTokenAccessDiscovery } from "@seo-platform/contracts";
import { ApiTokenOnlyGuard } from "../identity/api-token-only.guard.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest
} from "../identity/identity.types.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { ApiTokenDiscoveryController } from "./api-token-discovery.controller.js";
import type { ApiTokenService } from "./api-token.service.js";

test("publishes one exact token-only GET /api/v1/access route", () => {
  const handler = ApiTokenDiscoveryController.prototype.discover;

  assert.equal(
    Reflect.getMetadata(PATH_METADATA, ApiTokenDiscoveryController),
    "api/v1"
  );
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), "access");
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.GET);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [
    SessionAuthGuard,
    ApiTokenOnlyGuard
  ]);
});

test("discovers access from the bearer context without route identifiers", async () => {
  const principal = {
    userId: "01900000-0000-7000-8000-000000000001"
  } as AuthenticatedPrincipal;
  const authorization = {
    tokenId: "01900000-0000-7000-8000-000000000002",
    workspaceId: "01900000-0000-7000-8000-000000000003",
    name: "Agent",
    scopes: ["semantics:read" as const],
    allProjects: false,
    projectIds: ["01900000-0000-7000-8000-000000000004"]
  };
  const discovery: ApiTokenAccessDiscovery = {
    apiVersion: "v1",
    token: {
      id: authorization.tokenId,
      name: authorization.name,
      scopes: authorization.scopes,
      allProjects: false
    },
    workspace: {
      id: authorization.workspaceId,
      name: "Workspace",
      slug: "workspace",
      status: "ACTIVE"
    },
    projects: []
  };
  let received: readonly unknown[] = [];
  const controller = new ApiTokenDiscoveryController({
    discover: async (...args: unknown[]) => {
      received = args;
      return discovery;
    }
  } as unknown as ApiTokenService);
  const request = {
    id: "request-access-discovery",
    apiTokenAuthorization: authorization
  } as unknown as AuthenticatedRequest;

  const response = await controller.discover(request, principal);

  assert.deepEqual(received, [principal.userId, authorization]);
  assert.deepEqual(response, {
    data: discovery,
    meta: { requestId: "request-access-discovery" }
  });
});
