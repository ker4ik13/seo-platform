import type { Metadata } from "next";
import { AppShell } from "../../../../components/app-shell";
import { SettingsOverview } from "../../../../components/settings-overview";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Настройки"
};

export default async function SettingsOverviewPage() {
  const context = await requireProtectedAppContext();

  return (
    <AppShell activeSection="settings" context={context}>
      <section className="page-heading settings-overview-heading">
        <div>
          <h1>Настройки</h1>
          <p>
            Управляйте аккаунтом, рабочей областью и текущим проектом в одном
            месте.
          </p>
        </div>
      </section>
      <SettingsOverview context={context} />
    </AppShell>
  );
}
