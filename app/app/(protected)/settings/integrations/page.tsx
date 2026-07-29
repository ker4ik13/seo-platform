import { AppShell } from "../../../../../components/app-shell";
import { IntegrationSettings } from "../../../../../components/integration-settings";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import {
  canManageWorkspaceIntegrations,
  canTestWorkspaceIntegrations,
  canViewWorkspaceIntegrations
} from "../../../../../lib/app-permissions";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function IntegrationSettingsPage() {
  const context = await requireProtectedAppContext();
  const canView = canViewWorkspaceIntegrations(
    context.workspace?.roleCode
  );
  const canManage =
    canManageWorkspaceIntegrations(context.workspace?.roleCode) &&
    context.workspace?.status === "ACTIVE";
  const canTest =
    canTestWorkspaceIntegrations(context.workspace?.roleCode) &&
    context.workspace?.status === "ACTIVE";

  return (
    <AppShell activeSection="settings" context={context}>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Workspace · Интеграции</p>
          <h1>Подключения SEO API</h1>
          <p>
            {canView
              ? "Добавляйте собственные ключи XMLStock, Arsenkin Tools и Keys.so. После сохранения секреты больше не показываются."
              : "Управление workspace-подключениями доступно только участникам с разрешением на просмотр интеграций."}
          </p>
        </div>
      </section>
      <SettingsTabs
        active="integrations"
        {...(context.project ? { projectId: context.project.id } : {})}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      {!context.workspace ? (
        <section className="panel panel-empty compact">
          <strong>Сначала создайте рабочее пространство</strong>
          <p>API-ключи принадлежат workspace, а не отдельному проекту.</p>
          <a className="primary-button" href="/app">
            Перейти к созданию
          </a>
        </section>
      ) : !canView ? (
        <section className="panel panel-empty compact">
          <strong>Недостаточно прав</strong>
          <p>
            Для просмотра подключений требуется разрешение{" "}
            <code>integration.view</code>. Обратитесь к владельцу workspace.
          </p>
          <a className="secondary-button setup-link" href="/app">
            Вернуться в приложение
          </a>
        </section>
      ) : (
        <IntegrationSettings
          canManage={canManage}
          canTest={canTest}
          readOnly={context.workspace.status === "READ_ONLY"}
          workspaceId={context.workspace.id}
        />
      )}
    </AppShell>
  );
}
