import type { Metadata } from "next";
import { ProjectNotes } from "../../../../../../components/project-notes";
import { canEditProjectNotes } from "../../../../../../lib/app-permissions";
import { requireProtectedProjectAppContext } from "../../../../../../lib/protected-app";
import { ProjectContextSelect } from "../../../../../../components/project-context-select";
import { UiText } from "../../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Заметки",
  robots: { index: false, follow: false }
};

export default async function ProjectNotesPage({
  params
}: Readonly<{ params: Promise<{ readonly projectId: string }> }>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  if (!context.project || !context.workspace) {
    throw new Error("Project workspace context is missing");
  }
  return (
    <>
      <ProjectNotes
        heading={<div className="project-notes-compact-title"><h1><UiText text="Заметки" /></h1><ProjectContextSelect canReorder={context.projectCapabilities?.canReorder ?? false} destination="notes" projectId={context.project.id} projects={context.projects} workspaceId={context.workspace.id} /></div>}
        canEdit={canEditProjectNotes(
          context.workspace.roleCode,
          context.project.projectAccessLevel
        )}
        projectId={context.project.id}
      />
    </>
  );
}
