import { TaskCenter } from "../../../../components/task-center";
import { ProjectOnboarding, WorkspaceOnboarding } from "../../../../components/tenant-onboarding";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const context = await requireProtectedAppContext();
  return !context.workspace ? (
    <WorkspaceOnboarding />
  ) : !context.project ? (
    <ProjectOnboarding currentUserId={context.user.id} workspace={context.workspace} {...(context.projectCapabilities ? { capabilities: context.projectCapabilities } : {})} />
  ) : (
    <TaskCenter
      currentUserId={context.user.id}
      canReorderProjects={context.projectCapabilities?.canReorder ?? false}
      projectId={context.project.id}
      projects={context.projects}
      workspaceId={context.workspace.id}
    />
  );
}
