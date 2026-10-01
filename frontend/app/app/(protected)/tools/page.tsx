import { redirect } from "next/navigation";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export default async function LegacyToolsPage() {
  const context = await requireProtectedAppContext();
  redirect(context.project ? `/app/projects/${context.project.id}/tools/serp` : "/app");
}
