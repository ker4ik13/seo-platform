import type { ApiTokenScope } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { DomainError } from "../common/domain-error.js";
import type { ApiTokenAuthorization } from "../identity/identity.types.js";

export function assertApiTokenAccess(
  request: FastifyRequest,
  authorization: ApiTokenAuthorization,
  input: {
    readonly workspaceId?: string;
    readonly projectId?: string;
  }
): void {
  if (
    input.workspaceId !== undefined &&
    input.workspaceId !== authorization.workspaceId
  ) {
    forbidden("API token belongs to another workspace");
  }
  if (
    input.projectId !== undefined &&
    !authorization.allProjects &&
    !authorization.projectIds.includes(input.projectId)
  ) {
    throw new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Project not found"
    });
  }

  const route = request.routeOptions.url ?? "";
  const scope = apiTokenScopeForRoute(request.method, route, request.body);
  if (!scope || !authorization.scopes.includes(scope)) {
    forbidden("API token does not have the required scope");
  }
  if (
    input.projectId === undefined &&
    !authorization.allProjects &&
    !restrictedWorkspaceRouteAllowed(request.method, route)
  ) {
    forbidden("A project-restricted API token cannot use this workspace route");
  }
}

export function apiTokenScopeForRoute(
  method: string,
  route: string,
  body?: unknown
): ApiTokenScope | undefined {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  if (!normalized.startsWith("/api/v1/")) return undefined;
  if (normalized.includes("/api-tokens")) return undefined;
  const read = ["GET", "HEAD"].includes(method.toUpperCase());

  if (normalized.includes("/operation-estimates")) {
    return method.toUpperCase() === "POST"
      ? operationEstimateScope(body)
      : undefined;
  }

  if (normalized.endsWith("/projects/:projectId/operations/:operationId")) {
    return method.toUpperCase() === "DELETE" ? "projects:write" : undefined;
  }

  if (
    normalized.includes("/automations") ||
    normalized.includes("/crawl-automations")
  ) {
    return read ? "automations:read" : "automations:manage";
  }
  if (
    normalized.includes("/tracking-contexts") ||
    normalized.includes("/rank-estimates") ||
    normalized.includes("/rank-runs") ||
    normalized.includes("/rank-history") ||
    /\/projects\/:projectId\/jobs(?:\/|$)/u.test(normalized)
  ) {
    return read ? "positions:read" : "positions:run";
  }
  if (normalized.includes("/keyword-ranks")) {
    return ["GET", "HEAD", "POST"].includes(method.toUpperCase())
      ? "positions:read"
      : undefined;
  }
  if (normalized.includes("/rank-workbench")) {
    if (
      method.toUpperCase() === "POST" &&
      /\/rank-workbench\/(?:positions|serp)$/u.test(normalized)
    ) {
      return "positions:read";
    }
    return read ? "positions:read" : "positions:run";
  }
  if (normalized.includes("/frequency-collections")) {
    return read ? "frequency:read" : "frequency:run";
  }
  if (normalized.includes("/ai-answer-collections")) {
    return read ? "ai:read" : "ai:run";
  }
  if (normalized.includes("/keyword-research-runs")) {
    return read ? "research:read" : "research:run";
  }
  if (
    normalized.includes("/crawls") ||
    normalized.includes("/crawl-issues") ||
    normalized.includes("/crawl-changes")
  ) {
    return read ? "audits:read" : "audits:run";
  }
  if (normalized.includes("/pages")) {
    return read ? "pages:read" : "pages:write";
  }
  if (normalized.includes("/notes")) {
    return read ? "notes:read" : "notes:write";
  }
  if (
    normalized.includes("/integrations") ||
    normalized.includes("/integration-settings")
  ) {
    return read ? "integrations:read" : "integrations:write";
  }
  if (
    method.toUpperCase() === "POST" &&
    (
      normalized.endsWith("/keywords/search") ||
      normalized.endsWith("/keywords/list") ||
      normalized.endsWith("/semantic-duplicates/preview") ||
      normalized.endsWith("/negative-keywords/preview") ||
      normalized.endsWith("/semantic-group-color-legend/seen")
    )
  ) {
    return "semantics:read";
  }
  if (
    normalized.includes("/keywords") ||
    normalized.includes("/keyword-groups") ||
    normalized.includes("/clusters") ||
    normalized.includes("/clustering-runs") ||
    normalized.includes("/bulk-commands") ||
    normalized.includes("/semantic-") ||
    normalized.includes("/negative-keyword") ||
    normalized.includes("/imports") ||
    normalized.includes("/uploads") ||
    normalized.includes("/exports")
  ) {
    return read ? "semantics:read" : "semantics:write";
  }
  if (normalized.endsWith("/api/v1/workspaces/:workspaceId")) {
    return read ? "projects:read" : undefined;
  }
  if (
    /\/api\/v1\/workspaces\/:workspaceId\/(?:projects(?:\/order)?|operation-activity|project-capabilities)$/u.test(
      normalized
    ) ||
    /\/api\/v1\/projects\/:projectId(?:\/logo|\/archive|\/restore)?$/u.test(
      normalized
    )
  ) {
    return read ? "projects:read" : "projects:write";
  }
  return undefined;
}

function operationEstimateScope(body: unknown): ApiTokenScope | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  switch ((body as Readonly<Record<string, unknown>>).kind) {
    case "FREQUENCY_COLLECTION":
      return "frequency:run";
    case "AI_ANSWER_COLLECTION":
      return "ai:run";
    case "CLUSTERING_RUN":
      return "semantics:write";
    case "KEYWORD_RESEARCH":
      return "research:run";
    default:
      return undefined;
  }
}

function restrictedWorkspaceRouteAllowed(
  method: string,
  route: string
): boolean {
  if (!["GET", "HEAD"].includes(method.toUpperCase())) return false;
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return /\/api\/v1\/workspaces\/:workspaceId\/(?:projects|operation-activity|project-capabilities)$/u.test(
    normalized
  );
}

function forbidden(message: string): never {
  throw new DomainError({
    statusCode: 403,
    code: "FORBIDDEN",
    message
  });
}
