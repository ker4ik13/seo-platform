import { AppShell } from "../../../components/app-shell";
import { ProjectDashboard } from "../../../components/project-dashboard";
import {
  ProjectOnboarding,
  WorkspaceOnboarding
} from "../../../components/tenant-onboarding";
import { requireProtectedAppContext } from "../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const context = await requireProtectedAppContext();

  return (
    <AppShell activeSection="overview" context={context}>
      {!context.workspace ? (
        <WorkspaceOnboarding />
      ) : !context.project ? (
        <ProjectOnboarding workspace={context.workspace} />
      ) : (
        <>
          {context.workspace.status === "READ_ONLY" && (
            <aside className="status-banner" role="status">
              <span className="status-dot" />
              <div>
                <strong>Режим только для чтения</strong>
                <p>
                  История и результаты доступны; ограничены только новые
                  операции.
                </p>
              </div>
            </aside>
          )}
          {context.project.status === "ARCHIVED" && (
            <aside className="status-banner" role="status">
              <span className="status-dot" />
              <div>
                <strong>Проект в архиве</strong>
                <p>
                  Данные доступны для просмотра и экспорта, автоматизации
                  остановлены.
                </p>
              </div>
            </aside>
          )}
          <ProjectDashboard projectId={context.project.id} projectName={context.project.name} userName={context.user.displayName} />
        </>
      )}
    </AppShell>
  );
}
