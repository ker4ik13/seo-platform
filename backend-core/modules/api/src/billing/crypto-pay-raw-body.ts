import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
const bodies = new WeakMap<FastifyRequest, Buffer>();
export const cryptoPayRawBody = (request: FastifyRequest): Buffer | undefined => bodies.get(request);
export function installCryptoPayRawBody(fastify: FastifyInstance): void {
  fastify.addHook("preParsing", async (request, _reply, payload) => {
    if (request.method !== "POST" || request.url.split("?")[0] !== "/api/v1/billing/providers/crypto-pay/webhook") return payload;
    const parts: Buffer[] = []; let size = 0;
    const timeout = setTimeout(() => payload.destroy(new Error("Webhook body timeout")), 10_000);
    try {
      for await (const part of payload) {
        const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
        size += bytes.length;
        if (size > 65_536) { const error = new Error("Webhook body too large") as Error & { statusCode: number }; error.statusCode = 413; throw error; }
        parts.push(bytes);
      }
    } finally { clearTimeout(timeout); }
    const body = Buffer.concat(parts); bodies.set(request, body);
    const stream = Readable.from([body]) as Readable & { receivedEncodedLength: number };
    stream.receivedEncodedLength = size;
    return stream;
  });
}
