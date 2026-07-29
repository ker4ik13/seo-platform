import type { Metadata } from "next";
import { AppShell } from "../../../../../../../components/app-shell";
import { TrackingContextSettings } from "../../../../../../../components/tracking-context-settings";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Контексты отслеживания позиций",
  robots: {
    index: false,
    follow: false
  }
};

export default async function TrackingContextsPage({
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
    <AppShell
      activeSection="positions"
      context={{ ...context, project, workspace }}
    >
      <nav aria-label="Хлебные крошки" className="app-breadcrumbs">
        <a href="/app">Проекты</a>
        <span aria-hidden="true">/</span>
        <span>{project.name}</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Контексты позиций</span>
      </nav>
      <section className="page-heading tracking-context-heading">
        <div>
          <p className="eyebrow">Позиции · {project.name}</p>
          <h1>Контексты отслеживания</h1>
          <p>
            Зафиксируйте поисковую систему, географию, устройство и правило
            сопоставления домена. Изменения создают новую версию конфигурации и
            не переписывают историю позиций.
          </p>
        </div>
      </section>
      <TrackingContextSettings
        key={project.id}
        projectId={project.id}
        projectName={project.name}
        projectStatus={project.status}
        workspaceStatus={workspace.status}
      />
    </AppShell>
  );
}
