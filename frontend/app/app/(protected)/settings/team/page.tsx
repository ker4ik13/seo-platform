import type { Metadata } from "next";
import { AppShell } from "../../../../../components/app-shell";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { TeamManagement } from "../../../../../components/team-management";
import { canViewWorkspaceTeam } from "../../../../../lib/app-permissions";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Команда рабочей области"
};

export default async function TeamSettingsPage() {
  const context = await requireProtectedAppContext();
  const workspace = context.workspace;
  const canView = canViewWorkspaceTeam(workspace?.roleCode);

  return (
    <AppShell activeSection="settings" context={context}>
      <section className="page-heading">
        <div>
          <h1>Команда</h1>
          <p>
            Управляйте участниками, системными ролями и ожидающими
            приглашениями текущей рабочей области.
          </p>
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
          <strong>Рабочая область ещё не создана</strong>
          <p>Создайте её на обзорной странице, затем пригласите команду.</p>
          <a className="primary-button" href="/app">
            Перейти к созданию
          </a>
        </section>
      ) : !canView ? (
        <section className="panel panel-empty compact" role="status">
          <span aria-hidden="true" className="state-icon">
            403
          </span>
          <strong>Нет доступа к списку команды</strong>
          <p>
            Требуется разрешение member.view. Обратитесь к владельцу или
            администратору рабочей области.
          </p>
          <a className="primary-button" href="/app">
            Вернуться к обзору
          </a>
        </section>
      ) : (
        <TeamManagement
          currentUserId={context.user.id}
          key={workspace.id}
          projects={context.projects}
          workspace={workspace}
        />
      )}
    </AppShell>
  );
}
