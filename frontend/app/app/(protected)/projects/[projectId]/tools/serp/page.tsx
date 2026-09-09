import type { Metadata } from "next";
import { SerpWorkbench } from "../../../../../../../components/serp-workbench";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Выдача из поиска",
  robots: { index: false, follow: false }
};

export default async function SerpWorkbenchPage({
  params
}: Readonly<{ params: Promise<{ readonly projectId: string }> }>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  if (!context.project || !context.workspace) {
    throw new Error("Project context is missing");
  }
  return <SerpWorkbench
    currentUserId={context.user.id}
    projectDomain={context.project.domain}
    projectId={context.project.id}
    {...(context.project.searchCity
      ? { projectSearchCity: context.project.searchCity }
      : {})}
    workspaceId={context.workspace.id}
  />;
}
