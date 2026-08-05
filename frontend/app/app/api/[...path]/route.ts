import type { NextRequest } from "next/server";
import { proxyPlatformApi } from "../../../../lib/platform-api-proxy";

interface RouteContext {
  readonly params: Promise<{
    readonly path: readonly string[];
  }>;
}

async function handle(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const { path } = await context.params;
  return proxyPlatformApi(request, path);
}

export const dynamic = "force-dynamic";
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
