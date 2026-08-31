export const rankExecutionGrantControllerPath =
  "internal/v1/workspaces/:workspaceId/projects/:projectId" as const;
export const rankExecutionGrantActionPath =
  "rank-execution-grants" as const;
export const rankExecutionGrantRoutePattern =
  `/${rankExecutionGrantControllerPath}/${rankExecutionGrantActionPath}` as const;
export const rankExecutionGrantSettlementActionPath =
  "rank-execution-grants/:grantId/settlements" as const;
export const rankExecutionGrantSettlementRoutePattern =
  `/${rankExecutionGrantControllerPath}/${rankExecutionGrantSettlementActionPath}` as const;

interface RankExecutionGrantRouteRequest {
  readonly method: string;
  readonly routeOptions: {
    readonly url: string | undefined;
  };
}

interface RankExecutionGrantRouteReply {
  header(name: string, value: string): unknown;
}

/**
 * Runs from Fastify's global onSend hook, including parser and guard errors
 * that happen before the Nest controller handler can set response headers.
 */
export function applyRankExecutionGrantNoStore(
  request: RankExecutionGrantRouteRequest,
  reply: RankExecutionGrantRouteReply
): void {
  if (
    request.method === "POST" &&
    (request.routeOptions.url === rankExecutionGrantRoutePattern ||
      request.routeOptions.url ===
        rankExecutionGrantSettlementRoutePattern)
  ) {
    reply.header("Cache-Control", "no-store");
  }
}
