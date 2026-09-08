import { IntegrationSettings } from "../../../../../components/integration-settings";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import {
  canManageWorkspaceIntegrations,
  canTestWorkspaceIntegrations,
  canUseWorkspaceSystemCredentials,
  canViewWorkspaceIntegrations
} from "../../../../../lib/app-permissions";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";
import { UiText } from "../../../../../components/ui-locale";


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
  const canUsePlatform =
    canUseWorkspaceSystemCredentials(context.workspace?.roleCode) &&
    context.workspace?.status === "ACTIVE";

  return (
    <>
      <section className="page-heading">
        <div>
          <h1><UiText text="Подключения SEO API" /></h1>
          <p>
            {canView
              ? <UiText text="Используйте собственные API-ключи или системные XMLStock и Arsenkin с оплатой внутренними токенами. Секреты после подключения не показываются." />
              : <UiText text="Управление workspace-подключениями доступно только участникам с разрешением на просмотр интеграций." />}
          </p>
        </div>
      </section>
      <SettingsTabs
        active="integrations"
        {...(context.project?.projectAccessLevel
          ? { projectAccessLevel: context.project.projectAccessLevel }
          : {})}
        {...(context.project ? { projectId: context.project.id } : {})}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      {!context.workspace ? (
        <section className="panel panel-empty compact">
          <strong><UiText text="Сначала создайте рабочее пространство" /></strong>
          <p><UiText text="API-ключи принадлежат workspace, а не отдельному проекту." /></p>
          <a className="primary-button" href="/app">
            <UiText text="Перейти к созданию" /></a>
        </section>
      ) : !canView ? (
        <section className="panel panel-empty compact">
          <strong><UiText text="Недостаточно прав" /></strong>
          <p>
            <UiText text="Для просмотра подключений требуется разрешение" />{" "}
            <code>integration.view</code><UiText text=". Обратитесь к владельцу workspace." /></p>
          <a className="secondary-button setup-link" href="/app">
            <UiText text="Вернуться в приложение" /></a>
        </section>
      ) : (
        <IntegrationSettings
          canManage={canManage}
          canTest={canTest}
          canUsePlatform={canUsePlatform}
          readOnly={context.workspace.status === "READ_ONLY"}
          workspaceId={context.workspace.id}
        />
      )}
    </>
  );
}
