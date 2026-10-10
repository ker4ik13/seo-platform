import type { Metadata } from "next";
import { ProjectCatalog } from "../../../../../components/project-catalog";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";
import { UiText } from "../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Проекты рабочей области"
};

export default async function SettingsProjectsPage() {
  const context = await requireProtectedAppContext();
  const workspace = context.workspace;

  return (
    <>
      <section className="page-heading">
        <div>
          <h1><UiText text="Проекты" /></h1>
          <p>
            <UiText text="Создавайте проекты, переключайте рабочий контекст и переходите к проектным настройкам из единого каталога." /></p>
        </div>
      </section>
      <SettingsTabs
        active="projects"
        {...(context.project
          ? {
              projectId: context.project.id,
              projectAccessLevel: context.project.projectAccessLevel
            }
          : {})}
        workspaceRoleCode={workspace?.roleCode}
      />
      {!workspace ? (
        <section className="panel panel-empty compact">
          <strong><UiText text="Сначала создайте рабочую область" /></strong>
          <p><UiText text="Проекты принадлежат workspace и наследуют его команду и тариф." /></p>
          <a className="primary-button" href="/app">
            <UiText text="Перейти к созданию" /></a>
        </section>
      ) : (
        <ProjectCatalog
          currentUserId={context.user.id}
          {...(context.project ? { activeProjectId: context.project.id } : {})}
          {...(context.projectCapabilities
            ? { capabilities: context.projectCapabilities }
            : {})}
          projects={context.projects}
          workspace={workspace}
        />
      )}
    </>
  );
}
