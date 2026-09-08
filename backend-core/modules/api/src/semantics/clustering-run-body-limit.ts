import type { FastifyInstance } from "fastify";

export const CLUSTERING_RUN_BODY_LIMIT_BYTES = 32 * 1_024 * 1_024;

interface MutableRouteOptions {
  readonly method: string | readonly string[];
  readonly url: string;
  bodyLimit?: number;
}

export function applyClusteringRunBodyLimit(
  options: MutableRouteOptions
): void {
  const methods = Array.isArray(options.method)
    ? options.method
    : [options.method];
  if (methods.some(method => String(method).toUpperCase() === "PUT") && /^\/api\/v1\/projects\/[^/]+\/tracking-contexts\/[^/]+\/keywords\/?$/u.test(options.url)) {
    options.bodyLimit = 16 * 1024 * 1024;
  }
  if (
    methods.some((method) => String(method).toUpperCase() === "POST") &&
    /^\/api\/v1\/projects\/[^/]+\/(?:clustering-runs|frequency-collections|ai-answer-collections|operation-estimates)\/?$/u.test(options.url)
  ) {
    options.bodyLimit = CLUSTERING_RUN_BODY_LIMIT_BYTES;
  }
}

export function installClusteringRunBodyLimit(fastify: FastifyInstance): void {
  fastify.addHook("onRoute", (options) => {
    applyClusteringRunBodyLimit(options);
  });
}
