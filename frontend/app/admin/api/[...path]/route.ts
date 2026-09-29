import type { NextRequest } from "next/server";
import { proxyAdminApi } from "../../../../lib/admin-api-proxy";

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
  return proxyAdminApi(request, path);
}

export const dynamic = "force-dynamic";
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
