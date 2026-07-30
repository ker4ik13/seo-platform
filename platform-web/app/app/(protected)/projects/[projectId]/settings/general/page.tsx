import type { Metadata } from "next";
import { AppShell } from "../../../../../../../components/app-shell";
import { ProjectSettings } from "../../../../../../../components/project-settings";
import { SettingsTabs } from "../../../../../../../components/settings-tabs";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Настройки проекта"
};

export default async function ProjectSettingsPage({
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
      activeSection="settings"
      context={{ ...context, project, workspace }}
    >
      <nav aria-label="Хлебные крошки" className="app-breadcrumbs">
        <a href="/app">Проекты</a>
        <span aria-hidden="true">/</span>
        <span>{project.name}</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Настройки</span>
      </nav>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Проект · {project.name}</p>
          <h1>Основные настройки проекта</h1>
          <p>
            Изменяйте домен и региональные параметры, архивируйте или
            восстанавливайте проект без удаления данных.
          </p>
        </div>
      </section>
      <SettingsTabs
        active="project"
        {...(project.projectAccessLevel
          ? { projectAccessLevel: project.projectAccessLevel }
          : {})}
        projectId={project.id}
        workspaceRoleCode={workspace.roleCode}
      />
      <ProjectSettings
        project={project}
        workspaceRoleCode={workspace.roleCode}
        workspaceStatus={workspace.status}
      />
    </AppShell>
  );
}
