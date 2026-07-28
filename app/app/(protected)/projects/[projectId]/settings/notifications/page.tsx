import { notFound } from "next/navigation";
import { AppShell } from "../../../../../../../components/app-shell";
import { ProjectNotificationSettings } from "../../../../../../../components/project-notification-settings";
import { SettingsTabs } from "../../../../../../../components/settings-tabs";
import { requireProtectedAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function ProjectNotificationSettingsPage({
  params
}: Readonly<{
  params: Promise<{ readonly projectId: string }>;
}>) {
  const [{ projectId }, context] = await Promise.all([
    params,
    requireProtectedAppContext()
  ]);
  const project = context.projects.find(({ id }) => id === projectId);
  if (!project) notFound();

  return (
    <AppShell
      activeSection="settings"
      context={{ ...context, project }}
    >
      <section className="page-heading">
        <div>
          <p className="eyebrow">Проект · {project.name}</p>
          <h1>Уведомления проекта</h1>
          <p>
            Переопределите профиль только для нужных типов работ или временно
            приостановите проектную подписку.
          </p>
        </div>
      </section>
      <SettingsTabs
        active="project-notifications"
        projectId={project.id}
      />
      <ProjectNotificationSettings
        projectId={project.id}
        projectName={project.name}
      />
    </AppShell>
  );
}
