import { AppShell } from "../../../../components/app-shell";
import { NotificationCenter } from "../../../../components/notification-center";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const context = await requireProtectedAppContext();
  return (
    <AppShell activeSection="notifications" context={context}>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Профиль · События</p>
          <h1>Центр уведомлений</h1>
          <p>
            Результаты работ, упоминания, предупреждения, отчёты и системные
            события в одном месте.
          </p>
        </div>
      </section>
      <NotificationCenter />
    </AppShell>
  );
}
