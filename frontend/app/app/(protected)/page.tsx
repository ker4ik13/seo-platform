import { ProjectDashboard } from "../../../components/project-dashboard";
import {
  ProjectOnboarding,
  WorkspaceOnboarding
} from "../../../components/tenant-onboarding";
import { shouldShowWorkspaceCreationAction } from "../../../lib/app-navigation";
import { requireProtectedAppContext } from "../../../lib/protected-app";
import { UiText } from "../../../components/ui-locale";


export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams
}: Readonly<{
  searchParams: Promise<{ readonly createWorkspace?: string }>;
}>) {
  const context = await requireProtectedAppContext();
  const query = await searchParams;
  const showWorkspaceOnboarding =
    !context.workspace ||
    (query.createWorkspace === "1" &&
      shouldShowWorkspaceCreationAction(context.user.id, context.workspaces));

  return (
    <>
      {showWorkspaceOnboarding ? (
        <WorkspaceOnboarding />
      ) : !context.project ? (
        <ProjectOnboarding workspace={context.workspace} />
      ) : (
        <>
          {context.workspace.status === "READ_ONLY" && (
            <aside className="status-banner" role="status">
              <span className="status-dot" />
              <div>
                <strong><UiText text="Режим только для чтения" /></strong>
                <p>
                  <UiText text="История и результаты доступны; ограничены только новые операции." /></p>
              </div>
            </aside>
          )}
          {context.project.status === "ARCHIVED" && (
            <aside className="status-banner" role="status">
              <span className="status-dot" />
              <div>
                <strong><UiText text="Проект в архиве" /></strong>
                <p>
                  <UiText text="Данные доступны для просмотра и экспорта, автоматизации остановлены." /></p>
              </div>
            </aside>
          )}
          <ProjectDashboard projectId={context.project.id} projectName={context.project.name} userName={context.user.displayName} />
        </>
      )}
    </>
  );
}
