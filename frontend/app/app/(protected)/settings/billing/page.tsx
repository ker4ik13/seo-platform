import { BillingSettings } from "../../../../../components/billing-settings";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import {
  canManageWorkspacePaymentMethods,
  canManageWorkspacePlan,
  canTopUpWorkspaceBalance,
  canViewWorkspaceBilling
} from "../../../../../lib/app-permissions";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage() {
  const context = await requireProtectedAppContext();
  const roleCode = context.workspace?.roleCode;
  const canView = canViewWorkspaceBilling(roleCode);

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>Тариф, баланс и оплата</h1>
          <p>
            Подписка оплачивает доступ к платформе, а системные SEO API
            списываются отдельно из включённых кредитов и пополненного
            баланса.
          </p>
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
          <strong>Сначала создайте рабочее пространство</strong>
          <p>Тариф и баланс принадлежат workspace.</p>
          <a className="primary-button" href="/app">
            Перейти к созданию
          </a>
        </section>
      ) : !canView ? (
        <section className="panel panel-empty compact">
          <strong>Недостаточно прав</strong>
          <p>
            Для просмотра биллинга требуется разрешение{" "}
            <code>billing.view_plan</code>.
          </p>
        </section>
      ) : (
        <BillingSettings
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
