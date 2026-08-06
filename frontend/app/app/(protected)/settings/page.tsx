import type { Metadata } from "next";
import { SettingsOverview } from "../../../../components/settings-overview";
import { SettingsTabs } from "../../../../components/settings-tabs";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Настройки"
};

export default async function SettingsOverviewPage() {
  const context = await requireProtectedAppContext();

  return (
    <>
      <section className="page-heading settings-overview-heading">
        <div>
          <h1>Настройки</h1>
          <p>
            Управляйте аккаунтом, рабочей областью и текущим проектом в одном
            месте.
          </p>
        </div>
      </section>
      <SettingsTabs
        active="overview"
        {...(context.project
          ? {
              projectId: context.project.id,
              projectAccessLevel: context.project.projectAccessLevel
            }
          : {})}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      <SettingsOverview context={context} />
    </>
  );
}
