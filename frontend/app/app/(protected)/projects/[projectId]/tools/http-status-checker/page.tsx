import type { Metadata } from "next";
import { AppShell } from "../../../../../../../components/app-shell";
import { HttpStatusCheckTool } from "../../../../../../../components/http-status-check-tool";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Проверка HTTP-статусов",
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
    <AppShell activeSection="tools" context={context}>
      <nav aria-label="Хлебные крошки" className="app-breadcrumbs">
        <a href="/app/tools">Инструменты</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Проверка HTTP-статусов</span>
      </nav>
      <HttpStatusCheckTool project={project} projects={context.projects} />
    </AppShell>
  );
}
