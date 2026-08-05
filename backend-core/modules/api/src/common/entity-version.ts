import type { FastifyReply } from "fastify";

export function setEntityVersion(
  reply: FastifyReply,
  version: number
): void {
  reply.header("ETag", `"v${version}"`);
}
