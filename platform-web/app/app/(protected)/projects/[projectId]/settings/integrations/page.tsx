import type { Metadata } from "next";
import { AppShell } from "../../../../../../../components/app-shell";
import { ProjectIntegrationSettings } from "../../../../../../../components/project-integration-settings";
import { SettingsTabs } from "../../../../../../../components/settings-tabs";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Источники данных проекта"
};

export default async function ProjectIntegrationSettingsPage({
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
        <span aria-current="page">Источники данных</span>
      </nav>
      <section className="page-heading project-integration-heading">
        <div>
          <p className="eyebrow">Проект · {project.name}</p>
          <h1>Источники данных проекта</h1>
          <p>
            Выберите проверенное workspace-подключение для съёма позиций.
            Секреты остаются в зашифрованном vault и не копируются в проект.
          </p>
        </div>
        <a
          className="secondary-button setup-link"
          href="/app/settings/integrations"
        >
          Ключи workspace
        </a>
      </section>
      <SettingsTabs
        active="project-integrations"
        projectId={project.id}
        workspaceRoleCode={workspace.roleCode}
      />
      <ProjectIntegrationSettings
        projectId={project.id}
        projectName={project.name}
        projectStatus={project.status}
        workspaceStatus={workspace.status}
      />
    </AppShell>
  );
}
