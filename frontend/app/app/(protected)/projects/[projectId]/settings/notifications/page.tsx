import { ProjectNotificationSettings } from "../../../../../../../components/project-notification-settings";
import { SettingsTabs } from "../../../../../../../components/settings-tabs";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function ProjectNotificationSettingsPage({
  params
}: Readonly<{
  params: Promise<{ readonly projectId: string }>;
}>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  const project = context.project;
  if (!project) throw new Error("Project context is missing");

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>Уведомления проекта</h1>
          <p>
            Переопределите профиль только для нужных типов работ или временно
            приостановите проектную подписку.
          </p>
        </div>
      </section>
      <SettingsTabs
        active="project-notifications"
        {...(project.projectAccessLevel
          ? { projectAccessLevel: project.projectAccessLevel }
          : {})}
        projectId={project.id}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      <ProjectNotificationSettings
        projectId={project.id}
        projectName={project.name}
      />
    </>
  );
}
