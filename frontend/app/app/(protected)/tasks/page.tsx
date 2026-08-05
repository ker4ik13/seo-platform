import { AppShell } from "../../../../components/app-shell";
import { TaskCenter } from "../../../../components/task-center";
import { ProjectOnboarding, WorkspaceOnboarding } from "../../../../components/tenant-onboarding";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const context = await requireProtectedAppContext();
  return (
    <AppShell activeSection="tasks" context={context}>
      {!context.workspace ? <WorkspaceOnboarding /> : !context.project ? <ProjectOnboarding workspace={context.workspace} /> : <TaskCenter projectId={context.project.id} />}
    </AppShell>
  );
}
