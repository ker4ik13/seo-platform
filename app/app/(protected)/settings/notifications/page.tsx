import { AppShell } from "../../../../../components/app-shell";
import { NotificationSettings } from "../../../../../components/notification-settings";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const context = await requireProtectedAppContext();
  return (
    <AppShell activeSection="settings" context={context}>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Профиль · Уведомления</p>
          <h1>Настройки уведомлений</h1>
          <p>
            Выберите глобальные каналы, тихие часы, дайджесты и значения по
            умолчанию для проектных работ.
          </p>
        </div>
      </section>
      <SettingsTabs
        active="notifications"
        {...(context.project ? { projectId: context.project.id } : {})}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      <NotificationSettings
        email={context.user.email}
        emailVerified={context.user.emailVerified}
        {...(context.project ? { projectId: context.project.id } : {})}
      />
    </AppShell>
  );
}
