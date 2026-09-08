import { NotificationCenter } from "../../../../components/notification-center";
import { requireProtectedAppContext } from "../../../../lib/protected-app";
import { UiText } from "../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const context = await requireProtectedAppContext();
  return (
    <>
      <section className="page-heading">
        <div>
          <h1><UiText text="Центр уведомлений" /></h1>
          <p>
            <UiText text="Результаты работ, упоминания, предупреждения, отчёты и системные события в одном месте." /></p>
        </div>
      </section>
      <NotificationCenter {...(context.project ? { projectId: context.project.id } : {})} />
    </>
  );
}
