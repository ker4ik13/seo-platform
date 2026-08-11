import type { Metadata } from "next";
import { ProjectPageMap } from "../../../../../../components/project-page-map";
import { requireProtectedProjectAppContext } from "../../../../../../lib/protected-app";
import { ProjectContextSelect } from "../../../../../../components/project-context-select";

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
    <>
      <section className="page-heading page-map-heading">
        <div>
          <div className="project-page-title-row">
            <h1>Карта страниц</h1>
            <ProjectContextSelect
              destination="pages"
              projectId={project.id}
              projects={context.projects}
            />
          </div>
          <p>
            URL проекта, их состояние, семантика и результаты технических
            проверок — в одном рабочем экране.
          </p>
        </div>
      </section>
      <ProjectPageMap
        key={project.id}
        projectDomain={project.domain}
        projectId={project.id}
        projectName={project.name}
      />
    </>
  );
}
