import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedRequest } from "./identity.types.js";
import { ApiTokenOnlyGuard } from "./api-token-only.guard.js";

test("accepts only an authenticated API-token request", () => {
  const guard = new ApiTokenOnlyGuard();
  const tokenRequest = {
    principal: { userId: "01900000-0000-7000-8000-000000000001" },
    apiTokenAuthorization: {
      tokenId: "01900000-0000-7000-8000-000000000002",
      workspaceId: "01900000-0000-7000-8000-000000000003",
      name: "Agent",
      scopes: ["semantics:read"],
      allProjects: true,
      projectIds: []
    }
  } as unknown as AuthenticatedRequest;

  assert.equal(guard.canActivate(context(tokenRequest)), true);
  for (const request of [
    {} as AuthenticatedRequest,
    { principal: tokenRequest.principal } as AuthenticatedRequest
  ]) {
    assert.throws(
      () => guard.canActivate(context(request)),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 403 &&
        error.code === "FORBIDDEN"
    );
  }
});

function context(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}
