import type { FastifyInstance } from "fastify";

export const CLUSTERING_PROPOSAL_BODY_LIMIT_BYTES = 256 * 1_024 * 1_024;

interface MutableRouteOptions {
  readonly method: string | readonly string[];
  readonly url: string;
  bodyLimit?: number;
}

export function applyClusteringProposalBodyLimit(
  options: MutableRouteOptions
): void {
  const methods = Array.isArray(options.method)
    ? options.method
    : [options.method];
  if (
    methods.some((method) => String(method).toUpperCase() === "POST") &&
    /^\/internal\/v1\/projects\/[^/]+\/clustering-proposals\/?$/u.test(
      options.url
    )
  ) {
    options.bodyLimit = CLUSTERING_PROPOSAL_BODY_LIMIT_BYTES;
  }
}

export function installClusteringProposalBodyLimit(
  fastify: FastifyInstance
): void {
  fastify.addHook("onRoute", (options) => {
    applyClusteringProposalBodyLimit(options);
  });
}
