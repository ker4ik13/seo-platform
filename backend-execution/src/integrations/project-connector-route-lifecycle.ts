import type { Prisma } from "../generated/prisma/client.js";

interface ProjectRouteScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly bindingId: string;
}

export interface ActiveProjectRouteReplacement {
  readonly position: number;
  readonly sourceKind: "WORKSPACE_CREDENTIAL";
  readonly credentialId: string;
  readonly routingScope:
    | "PROJECT_OVERRIDE"
    | "WORKSPACE_DEFAULT"
    | "WORKSPACE_FALLBACK";
  readonly workspaceRouteId?: string;
}

/**
 * Replaces only the active route projection. Retired rows remain immutable
 * references for in-flight and historical provider executions.
 */
export async function replaceActiveProjectConnectorRoutes(
  transaction: Prisma.TransactionClient,
  scope: ProjectRouteScope,
  replacements: readonly ActiveProjectRouteReplacement[],
  retainedRouteIds: readonly string[] = []
): Promise<void> {
  await transaction.projectConnectorRoute.updateMany({
    where: {
      ...scope,
      retiredAt: null,
      ...(retainedRouteIds.length > 0
        ? { id: { notIn: [...retainedRouteIds] } }
        : {})
    },
    data: { retiredAt: new Date() }
  });
  if (replacements.length === 0) return;
  await transaction.projectConnectorRoute.createMany({
    data: replacements.map((route) => ({
      ...scope,
      ...route,
      workspaceRouteId: route.workspaceRouteId ?? null
    }))
  });
}
