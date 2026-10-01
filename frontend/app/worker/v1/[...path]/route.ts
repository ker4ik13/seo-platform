import type { NextRequest } from "next/server";
import { proxyWorkerGateway } from "../../../../lib/worker-gateway-proxy";

interface RouteContext { readonly params: Promise<{ readonly path: readonly string[] }> }

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyWorkerGateway(request, (await context.params).path);
}
