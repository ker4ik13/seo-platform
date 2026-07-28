import { AppShell } from "../../../../../components/app-shell";
import { MfaSettings } from "../../../../../components/mfa-settings";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const context = await requireProtectedAppContext();
  return (
    <AppShell activeSection="settings" context={context}>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Профиль · Безопасность</p>
          <h1>Безопасность аккаунта</h1>
          <p>
            Управляйте двухфакторной защитой. Настройки сессий и способов входа
            будут находиться здесь же.
          </p>
        </div>
      </section>
      <SettingsTabs
        active="security"
        {...(context.project ? { projectId: context.project.id } : {})}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      <div className="settings-stack">
        <MfaSettings />
      </div>
    </AppShell>
  );
}
