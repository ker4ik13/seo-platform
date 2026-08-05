import type { FastifyInstance } from "fastify";
import type {
  SeoDataRequestTransport,
  SeoDataTransportRequest,
  SeoDataTransportResponse
} from "@seo-platform/backend-core-api/core-composition";

export function seoDataLocalTransport(
  server: FastifyInstance
): SeoDataRequestTransport {
  return {
    request: (input) => injectWithTimeout(server, input)
  };
}

async function injectWithTimeout(
  server: FastifyInstance,
  input: SeoDataTransportRequest
): Promise<SeoDataTransportResponse> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    const reply = await Promise.race([
      server.inject({
        method: input.method,
        url: `${input.url.pathname}${input.url.search}`,
        headers: input.headers,
        ...(input.body === undefined ? {} : { payload: input.body })
      }),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error("SEO_DATA_LOCAL_REQUEST_TIMEOUT")),
          input.timeoutMs
        );
        timeoutHandle.unref();
      })
    ]);
    return {
      ok: reply.statusCode >= 200 && reply.statusCode < 300,
      status: reply.statusCode,
      json: async (): Promise<unknown> => reply.json()
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
