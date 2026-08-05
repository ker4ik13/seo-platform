import { BadRequestException } from "@nestjs/common";
import {
  internalCommandContext,
  internalUuid,
  type InternalCommandContext
} from "../internal/internal-command-context.js";

export type RankManifestInternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

export function rankManifestRouteContext(
  routeProjectId: string,
  headers: RankManifestInternalHeaders
): InternalCommandContext {
  const context = internalCommandContext(headers);
  if (internalUuid(routeProjectId, "projectId") !== context.projectId) {
    throw new BadRequestException(
      "Route project identifier does not match trusted context"
    );
  }
  return context;
}
