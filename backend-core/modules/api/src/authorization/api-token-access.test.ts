import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { DomainError } from "../common/domain-error.js";
import type { ApiTokenAuthorization } from "../identity/identity.types.js";
import {
  apiTokenScopeForRoute,
  assertApiTokenAccess
} from "./api-token-access.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const otherProjectId = "01900000-0000-7000-8000-000000000003";

test("maps paid operations to separate position and frequency scopes", () => {
  assert.equal(
    apiTokenScopeForRoute(
      "POST",
      "/api/v1/projects/:projectId/rank-runs"
    ),
    "positions:run"
  );
  assert.equal(
    apiTokenScopeForRoute(
      "POST",
      "/api/v1/projects/:projectId/frequency-collections"
    ),
    "frequency:run"
  );
  assert.equal(
    apiTokenScopeForRoute(
      "GET",
      "/api/v1/projects/:projectId/frequency-collections/:jobId/result"
    ),
    "frequency:read"
  );
  assert.equal(
    apiTokenScopeForRoute(
      "POST",
      "/api/v1/projects/:projectId/automations"
    ),
    "automations:manage"
  );
});

test("maps every documented tenant API family to its least-privilege scope", () => {
  const cases = [
    ["GET", "/api/v1/workspaces/:workspaceId/projects", "projects:read"],
    ["PUT", "/api/v1/workspaces/:workspaceId/projects/order", "projects:write"],
    ["GET", "/api/v1/workspaces/:workspaceId/project-capabilities", "projects:read"],
    ["PATCH", "/api/v1/projects/:projectId", "projects:write"],
    ["GET", "/api/v1/projects/:projectId/keywords", "semantics:read"],
    ["POST", "/api/v1/projects/:projectId/keywords/list", "semantics:read"],
    ["POST", "/api/v1/projects/:projectId/semantic-duplicates/preview", "semantics:read"],
    ["POST", "/api/v1/projects/:projectId/negative-keywords/preview", "semantics:read"],
    ["POST", "/api/v1/projects/:projectId/semantic-group-color-legend/seen", "semantics:read"],
    ["POST", "/api/v1/projects/:projectId/imports", "semantics:write"],
    ["GET", "/api/v1/projects/:projectId/rank-history", "positions:read"],
    ["POST", "/api/v1/projects/:projectId/rank-workbench/positions", "positions:read"],
    ["POST", "/api/v1/projects/:projectId/rank-workbench/serp", "positions:read"],
    ["POST", "/api/v1/projects/:projectId/rank-workbench/dimension-merges", "positions:run"],
    ["GET", "/api/v1/projects/:projectId/keyword-ranks/dimensions", "positions:read"],
    ["POST", "/api/v1/projects/:projectId/keyword-ranks/comparison", "positions:read"],
    ["POST", "/api/v1/projects/:projectId/rank-estimates", "positions:run"],
    ["GET", "/api/v1/projects/:projectId/ai-answer-collections", "ai:read"],
    ["POST", "/api/v1/projects/:projectId/ai-answer-collections", "ai:run"],
    ["GET", "/api/v1/projects/:projectId/keyword-research-runs", "research:read"],
    ["POST", "/api/v1/projects/:projectId/crawls", "audits:run"],
    ["PATCH", "/api/v1/projects/:projectId/pages/:pageId", "pages:write"],
    ["GET", "/api/v1/projects/:projectId/notes", "notes:read"],
    ["PATCH", "/api/v1/projects/:projectId/integration-settings", "integrations:write"],
    ["GET", "/api/v1/projects/:projectId/crawl-automations", "automations:read"]
  ] as const;
  for (const [method, route, scope] of cases) {
    assert.equal(apiTokenScopeForRoute(method, route), scope);
  }
});

test("maps a shared operation-estimate route from its validated operation kind", () => {
  const cases = [
    ["FREQUENCY_COLLECTION", "frequency:run"],
    ["AI_ANSWER_COLLECTION", "ai:run"],
    ["CLUSTERING_RUN", "semantics:write"],
    ["KEYWORD_RESEARCH", "research:run"]
  ] as const;
  for (const [kind, scope] of cases) {
    assert.equal(
      apiTokenScopeForRoute(
        "POST",
        "/api/v1/projects/:projectId/operation-estimates",
        { kind, command: {} }
      ),
      scope
    );
  }
  assert.equal(
    apiTokenScopeForRoute(
      "POST",
      "/api/v1/projects/:projectId/operation-estimates",
      { kind: "UNKNOWN", command: {} }
    ),
    undefined
  );
});

test("authorizes notes and group colors through their dedicated API-token scopes", () => {
  const projectToken: ApiTokenAuthorization = {
    ...token(),
    scopes: ["notes:read", "notes:write", "semantics:read", "semantics:write"]
  };
  for (const [method, route] of [
    ["GET", "/api/v1/projects/:projectId/notes"],
    ["PATCH", "/api/v1/projects/:projectId/notes/:noteId"],
    ["GET", "/api/v1/projects/:projectId/semantic-group-color-legend"],
    ["PATCH", "/api/v1/projects/:projectId/semantic-group-color-legend"]
  ] as const) {
    assert.doesNotThrow(() =>
      assertApiTokenAccess(request(method, route), projectToken, { projectId })
    );
  }
});

test("fails closed for API-token management and account endpoints", () => {
  assert.equal(
    apiTokenScopeForRoute(
      "GET",
      "/api/v1/workspaces/:workspaceId/api-tokens"
    ),
    undefined
  );
  assert.equal(apiTokenScopeForRoute("GET", "/api/v1/me"), undefined);
  assert.equal(
    apiTokenScopeForRoute(
      "PATCH",
      "/api/v1/workspaces/:workspaceId"
    ),
    undefined
  );
});

test("keeps identifier-free discovery outside the tenant route scope mapper", () => {
  assert.equal(apiTokenScopeForRoute("GET", "/api/v1/access"), undefined);
});

test("treats an automatic HEAD route as read-only", () => {
  assert.equal(
    apiTokenScopeForRoute(
      "HEAD",
      "/api/v1/projects/:projectId/rank-history"
    ),
    "positions:read"
  );
});

test("enforces the project allowlist before the user authorization lookup", () => {
  assert.throws(
    () =>
      assertApiTokenAccess(
        request("GET", "/api/v1/projects/:projectId/rank-history"),
        token(),
        { projectId: otherProjectId }
      ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.statusCode === 404 &&
      error.code === "NOT_FOUND"
  );
});

test("allows a restricted token to list only its project collection route", () => {
  assert.doesNotThrow(() =>
    assertApiTokenAccess(
      request("GET", "/api/v1/workspaces/:workspaceId/projects"),
      token(),
      { workspaceId }
    )
  );
  assert.throws(() =>
    assertApiTokenAccess(
      request("GET", "/api/v1/workspaces/:workspaceId"),
      token(),
      { workspaceId }
    )
  );
});

function token(): ApiTokenAuthorization {
  return {
    tokenId: "01900000-0000-7000-8000-000000000004",
    workspaceId,
    name: "Agent",
    scopes: ["projects:read", "positions:read"],
    allProjects: false,
    projectIds: [projectId]
  };
}

function request(method: string, route: string, body?: unknown): FastifyRequest {
  return {
    method,
    routeOptions: { url: route },
    ...(body === undefined ? {} : { body })
  } as FastifyRequest;
}
