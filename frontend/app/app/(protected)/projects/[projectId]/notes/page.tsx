import type { Metadata } from "next";
import { ProjectNotes } from "../../../../../../components/project-notes";
import { canEditProjectNotes } from "../../../../../../lib/app-permissions";
import { requireProtectedProjectAppContext } from "../../../../../../lib/protected-app";
import { ProjectContextSelect } from "../../../../../../components/project-context-select";

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
      <section className="page-heading project-notes-heading">
        <div>
          <div className="project-page-title-row">
            <h1>Заметки</h1>
            <ProjectContextSelect
              destination="notes"
              projectId={context.project.id}
              projects={context.projects}
            />
          </div>
          <p>
            Markdown-документы проекта. Оставляйте их участникам или
            открывайте безопасной ссылкой без индексации.
          </p>
        </div>
      </section>
      <ProjectNotes
        canEdit={canEditProjectNotes(
          context.workspace.roleCode,
          context.project.projectAccessLevel
        )}
        projectId={context.project.id}
      />
    </>
  );
}
