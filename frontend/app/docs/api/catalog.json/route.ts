import { apiAgentCatalog } from "../../../../lib/api-docs";
import { apiPublicOrigin } from "../../../../lib/server-runtime-origin";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    apiAgentCatalog(`${apiPublicOrigin()}/api/v1`),
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "Content-Type": "application/json; charset=utf-8",
        "X-Robots-Tag": "noindex"
      }
    }
  );
}
