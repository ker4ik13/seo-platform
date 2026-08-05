import type { Metadata } from "next";
import { AppShell } from "../../../../../../../components/app-shell";
import { ProjectIntegrationRouting } from "../../../../../../../components/project-integration-routing";
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
      <section className="page-heading project-integration-heading">
        <div>
          <h1>Источники данных проекта</h1>
          <p>
            Наследуйте маршруты рабочей области или назначьте отдельные
            аккаунты и fallback-цепочки для операций этого проекта.
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
        {...(project.projectAccessLevel
          ? { projectAccessLevel: project.projectAccessLevel }
          : {})}
        projectId={project.id}
        workspaceRoleCode={workspace.roleCode}
      />
      <ProjectIntegrationRouting
        projectId={project.id}
        workspaceId={workspace.id}
      />
    </AppShell>
  );
}
