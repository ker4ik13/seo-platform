import { BillingSettings } from "../../../../../components/billing-settings";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import {
  canManageWorkspacePaymentMethods,
  canManageWorkspacePlan,
  canTopUpWorkspaceBalance,
  canViewWorkspaceBilling
} from "../../../../../lib/app-permissions";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";
import { UiText } from "../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export default async function BillingSettingsPage() {
  const context = await requireProtectedAppContext();
  const roleCode = context.workspace?.roleCode;
  const canView = canViewWorkspaceBilling(roleCode);

  return (
    <>
      <section className="page-heading">
        <div>
          <h1><UiText text="Тариф, баланс и оплата" /></h1>
          <p>
            <UiText text="Подписка определяет возможности рабочей области. Данные SEO-сервисов оплачиваются с отдельного баланса; стоимость подтверждается перед запуском." /></p>
        </div>
      </section>
      <SettingsTabs
        active="billing"
        {...(context.project?.projectAccessLevel
          ? { projectAccessLevel: context.project.projectAccessLevel }
          : {})}
        {...(context.project ? { projectId: context.project.id } : {})}
        workspaceRoleCode={roleCode}
      />
      {!context.workspace ? (
        <section className="panel panel-empty compact">
          <strong><UiText text="Сначала создайте рабочее пространство" /></strong>
          <p><UiText text="Здесь будут тариф, баланс и история платежей вашей рабочей области." /></p>
          <a className="primary-button" href="/app">
            <UiText text="Перейти к созданию" /></a>
        </section>
      ) : !canView ? (
        <section className="panel panel-empty compact">
          <strong><UiText text="Недостаточно прав" /></strong>
          <p>
            <UiText text="Владелец рабочей области может предоставить доступ к оплате." /></p>
        </section>
      ) : (
        <BillingSettings
          key={context.workspace.id}
          canManagePaymentMethods={canManageWorkspacePaymentMethods(
            roleCode
          )}
          canManagePlan={canManageWorkspacePlan(roleCode)}
          canTopUp={canTopUpWorkspaceBalance(roleCode)}
          defaultEmail={context.user.email}
          projectCount={context.projects.filter(
            ({ status }) => status !== "ARCHIVED"
          ).length}
          readOnly={context.workspace.status === "READ_ONLY"}
          workspaceId={context.workspace.id}
        />
      )}
    </>
  );
}
