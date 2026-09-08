import type { FastifyInstance } from "fastify";

export const KEYWORD_BULK_BODY_LIMIT_BYTES = 8 * 1_024 * 1_024;

interface MutableRouteOptions {
  readonly method: string | readonly string[];
  readonly url: string;
  bodyLimit?: number;
}

export function applyKeywordBulkBodyLimit(
  options: MutableRouteOptions
): void {
  const methods = Array.isArray(options.method)
    ? options.method
    : [options.method];
  if (methods.some(method => String(method).toUpperCase() === "PUT") && /^\/internal\/v1\/projects\/[^/]+\/tracking-contexts\/[^/]+\/keywords\/?$/u.test(options.url)) {
    options.bodyLimit = 16 * 1024 * 1024;
  }
  if (
    methods.some((method) => String(method).toUpperCase() === "POST") &&
    /^\/internal\/v1\/projects\/[^/]+\/keywords\/bulk-create\/?$/u.test(
      options.url
    )
  ) {
    options.bodyLimit = KEYWORD_BULK_BODY_LIMIT_BYTES;
  }
}

export function installKeywordBulkBodyLimit(fastify: FastifyInstance): void {
  fastify.addHook("onRoute", (options) => {
    applyKeywordBulkBodyLimit(options);
  });
}
