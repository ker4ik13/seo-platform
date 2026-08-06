import type { Metadata } from "next";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { WorkspaceRoleCatalog } from "../../../../../components/workspace-role-catalog";
import { canViewWorkspaceTeam } from "../../../../../lib/app-permissions";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";

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
          <h1>Роли и права</h1>
          <p>Проверьте системную матрицу перед назначением роли участнику.</p>
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
          <strong>Рабочая область ещё не создана</strong>
          <p>Роли назначаются участникам workspace.</p>
        </section>
      ) : !canView ? (
        <section className="panel panel-empty compact">
          <strong>Недостаточно прав</strong>
          <p>Для просмотра матрицы требуется разрешение member.view.</p>
        </section>
      ) : (
        <WorkspaceRoleCatalog currentRoleCode={workspace.roleCode} />
      )}
    </>
  );
}
