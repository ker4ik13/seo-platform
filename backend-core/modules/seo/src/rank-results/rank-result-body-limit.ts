import type { FastifyInstance } from "fastify";

export const RANK_RESULT_BODY_LIMIT_BYTES = 64 * 1_024 * 1_024;

interface MutableRouteOptions {
  readonly method: string | readonly string[];
  readonly url: string;
  bodyLimit?: number;
}

export function applyRankResultBodyLimit(
  options: MutableRouteOptions
): void {
  const methods = Array.isArray(options.method)
    ? options.method
    : [options.method];
  if (
    methods.some((method) => String(method).toUpperCase() === "POST") &&
    /^\/internal\/v1\/projects\/[^/]+\/rank-manifests\/[^/]+\/chunks\/(?:[^/]+\/results|results-batch)\/?$/u.test(
      options.url
    )
  ) {
    options.bodyLimit = RANK_RESULT_BODY_LIMIT_BYTES;
  }
}

export function installRankResultBodyLimit(fastify: FastifyInstance): void {
  fastify.addHook("onRoute", (options) => {
    applyRankResultBodyLimit(options);
  });
}
