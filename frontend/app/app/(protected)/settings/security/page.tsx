import { AccountSecurityProfile } from "../../../../../components/account-security-profile";
import { MfaSettings } from "../../../../../components/mfa-settings";
import { SessionSettings } from "../../../../../components/session-settings";
import { SettingsTabs } from "../../../../../components/settings-tabs";
import { requireProtectedAppContext } from "../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const context = await requireProtectedAppContext();
  return (
    <>
      <section className="page-heading">
        <div>
          <h1>Безопасность аккаунта</h1>
          <p>
            Управляйте профилем, паролем, двухфакторной защитой и активными
            входами на всех устройствах.
          </p>
        </div>
      </section>
      <SettingsTabs
        active="security"
        {...(context.project?.projectAccessLevel
          ? { projectAccessLevel: context.project.projectAccessLevel }
          : {})}
        {...(context.project ? { projectId: context.project.id } : {})}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      <div className="settings-stack">
        <AccountSecurityProfile user={context.user} />
        <MfaSettings />
        <SessionSettings />
      </div>
    </>
  );
}
