import type { Metadata } from "next";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { TeamManagement } from "../../../../../components/team-management";
import { canViewWorkspaceTeam } from "../../../../../lib/app-permissions";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";
import { UiText } from "../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Команда рабочей области"
};

export default async function TeamSettingsPage() {
  const context = await requireProtectedAppContext();
  const workspace = context.workspace;
  const canView = canViewWorkspaceTeam(workspace?.roleCode);

  return (
    <>
      <section className="page-heading">
        <div>
          <h1><UiText text="Команда" /></h1>
          <p>
            <UiText text="Управляйте участниками, системными ролями и ожидающими приглашениями текущей рабочей области." /></p>
        </div>
      </section>
      <SettingsTabs
        active="team"
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
          <span aria-hidden="true" className="state-icon">
            0
          </span>
          <strong><UiText text="Рабочая область ещё не создана" /></strong>
          <p><UiText text="Создайте её на обзорной странице, затем пригласите команду." /></p>
          <a className="primary-button" href="/app">
            <UiText text="Перейти к созданию" /></a>
        </section>
      ) : !canView ? (
        <section className="panel panel-empty compact" role="status">
          <span aria-hidden="true" className="state-icon">
            403
          </span>
          <strong><UiText text="Нет доступа к списку команды" /></strong>
          <p>
            <UiText text="Требуется разрешение member.view. Обратитесь к владельцу или администратору рабочей области." /></p>
          <a className="primary-button" href="/app">
            <UiText text="Вернуться к обзору" /></a>
        </section>
      ) : (
        <TeamManagement
          currentUserId={context.user.id}
          key={workspace.id}
          projects={context.projects}
          workspace={workspace}
        />
      )}
    </>
  );
}
