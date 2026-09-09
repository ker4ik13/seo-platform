import type { Metadata } from "next";
import { RankingsWorkspace } from "../../../../../../components/rankings-workspace";
import { requireProtectedProjectAppContext } from "../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Позиции",
  robots: {
    index: false,
    follow: false
  }
};

export default async function RankHistoryPage({
  params
}: Readonly<{
  params: Promise<{ readonly projectId: string }>;
}>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  if (!context.project || !context.workspace) throw new Error("Project context is missing");
  return <RankingsWorkspace
    currentUserId={context.user.id}
    projectDomain={context.project.domain}
    projectId={context.project.id}
    {...(context.project.searchCity ? { projectSearchCity: context.project.searchCity } : {})}
    workspaceId={context.workspace.id}
  />;
}
