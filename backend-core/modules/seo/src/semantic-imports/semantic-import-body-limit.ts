import type { FastifyInstance } from "fastify";

export const SEMANTIC_IMPORT_CHUNK_BODY_LIMIT_BYTES = 32 * 1_024 * 1_024;
export const SEMANTIC_IMPORT_NORMALIZE_BODY_LIMIT_BYTES = 32 * 1_024 * 1_024;

interface MutableRouteOptions {
  readonly method: string | readonly string[];
  readonly url: string;
  bodyLimit?: number;
}

export function applySemanticImportBodyLimit(
  options: MutableRouteOptions
): void {
  const methods = Array.isArray(options.method)
    ? options.method
    : [options.method];
  if (!methods.some((method) => String(method).toUpperCase() === "POST")) return;
  if (/^\/internal\/v1\/semantic-imports\/[^/]+\/chunks\/?$/u.test(options.url)) {
    options.bodyLimit = SEMANTIC_IMPORT_CHUNK_BODY_LIMIT_BYTES;
  } else if (/^\/internal\/v1\/semantic-imports\/[^/]+\/normalize\/?$/u.test(options.url)) {
    options.bodyLimit = SEMANTIC_IMPORT_NORMALIZE_BODY_LIMIT_BYTES;
  }
}

export function installSemanticImportBodyLimit(fastify: FastifyInstance): void {
  fastify.addHook("onRoute", (options) => {
    applySemanticImportBodyLimit(options);
  });
}
