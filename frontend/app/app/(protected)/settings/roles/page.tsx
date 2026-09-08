import type { Metadata } from "next";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { WorkspaceRoleCatalog } from "../../../../../components/workspace-role-catalog";
import { canViewWorkspaceTeam } from "../../../../../lib/app-permissions";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";
import { UiText } from "../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Роли и права" };

export default async function WorkspaceRolesPage() {
  const context = await requireProtectedAppContext();
  const workspace = context.workspace;
  const canView = canViewWorkspaceTeam(workspace?.roleCode);

  return (
    <>
      <section className="page-heading">
        <div>
          <h1><UiText text="Роли и права" /></h1>
          <p><UiText text="Проверьте системную матрицу перед назначением роли участнику." /></p>
        </div>
      </section>
      <SettingsTabs
        active="roles"
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
          <strong><UiText text="Рабочая область ещё не создана" /></strong>
          <p><UiText text="Роли назначаются участникам workspace." /></p>
        </section>
      ) : !canView ? (
        <section className="panel panel-empty compact">
          <strong><UiText text="Недостаточно прав" /></strong>
          <p><UiText text="Для просмотра матрицы требуется разрешение member.view." /></p>
        </section>
      ) : (
        <WorkspaceRoleCatalog currentRoleCode={workspace.roleCode} />
      )}
    </>
  );
}
