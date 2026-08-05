import type { FastifyRequest } from "fastify";
import type { RequestContext } from "./identity.types.js";

export function requestContext(request: FastifyRequest): RequestContext {
  const userAgent = request.headers["user-agent"];
  return {
    requestId: request.id,
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(typeof userAgent === "string" && userAgent.trim()
      ? { userAgent: userAgent.slice(0, 2_000) }
      : {})
  };
}
