import { SemanticsWorkspace } from "../../../../components/semantics-workspace";
import { ProjectOnboarding } from "../../../../components/tenant-onboarding";
import { requireProtectedAppContext } from "../../../../lib/protected-app";
import { UiText } from "../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export default async function SemanticsPage() {
  const context = await requireProtectedAppContext();
  return (
    <>
      {!context.project || !context.workspace ? (
        context.workspace ? (
          <ProjectOnboarding currentUserId={context.user.id} workspace={context.workspace} {...(context.projectCapabilities ? { capabilities: context.projectCapabilities } : {})} />
        ) : (
          <section className="panel panel-empty">
            <strong><UiText text="Сначала создайте рабочую область" /></strong>
          </section>
        )
      ) : (
        <SemanticsWorkspace
          canReorderProjects={context.projectCapabilities?.canReorder ?? false}
          currentUserId={context.user.id}
          projectId={context.project.id}
          projectName={context.project.name}
          projects={context.projects}
          workspaceId={context.workspace.id}
          workspaceRoleCode={context.workspace.roleCode}
        />
      )}
    </>
  );
}
