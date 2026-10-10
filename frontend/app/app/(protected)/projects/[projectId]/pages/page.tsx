import type { Metadata } from "next";
import { ProjectPageMap } from "../../../../../../components/project-page-map";
import { requireProtectedProjectAppContext } from "../../../../../../lib/protected-app";
import { ProjectContextSelect } from "../../../../../../components/project-context-select";
import { UiText } from "../../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Карта страниц",
  robots: {
    index: false,
    follow: false
  }
};

export default async function ProjectPagesPage({
  params
}: Readonly<{
  params: Promise<{ readonly projectId: string }>;
}>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  const project = context.project;
  const workspace = context.workspace;
  if (!project || !workspace) {
    throw new Error("Project workspace context is missing");
  }
  return (
    <ProjectPageMap
        heading={<div className="page-map-title"><h1><UiText text="Карта страниц" /></h1><ProjectContextSelect
          canReorder={context.projectCapabilities?.canReorder ?? false}
          destination="pages"
          projectId={project.id}
          projects={context.projects}
          workspaceId={workspace.id}
        /></div>}
        key={project.id}
        currentUserId={context.user.id}
        projectDomain={project.domain}
        projectId={project.id}
        projectName={project.name}
    />
  );
}
