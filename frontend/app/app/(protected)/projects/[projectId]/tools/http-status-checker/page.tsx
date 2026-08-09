import type { Metadata } from "next";
import { HttpStatusCheckTool } from "../../../../../../../components/http-status-check-tool";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

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
      <nav aria-label="Хлебные крошки" className="app-breadcrumbs">
        <a href="/app/tools">Инструменты</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Обход сайта</span>
      </nav>
      <HttpStatusCheckTool project={project} projects={context.projects} />
    </>
  );
}
