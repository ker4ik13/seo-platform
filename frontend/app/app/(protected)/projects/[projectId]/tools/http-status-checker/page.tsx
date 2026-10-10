import type { Metadata } from "next";
import { HttpStatusCheckTool } from "../../../../../../../components/http-status-check-tool";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";
import { UiText, UiElement } from "../../../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Обход сайта",
  robots: { index: false, follow: false }
};

export default async function HttpStatusCheckerPage({
  params
}: Readonly<{ params: Promise<{ readonly projectId: string }> }>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  const project = context.project;
  if (!project) throw new Error("Project context is missing");

  return (
    <>
      <UiElement tag="nav" uiLabels={{"aria-label": "Хлебные крошки"}}  className="app-breadcrumbs">
        <a href={`/app/projects/${projectId}/pages`}><UiText text="Карта страниц" /></a>
        <span aria-hidden="true">/</span>
        <span aria-current="page"><UiText text="Обход сайта" /></span>
      </UiElement>
      <HttpStatusCheckTool
        canReorderProjects={context.projectCapabilities?.canReorder ?? false}
        project={project}
        projects={context.projects}
        workspaceId={context.workspace!.id}
      />
    </>
  );
}
