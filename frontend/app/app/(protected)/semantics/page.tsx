import { SemanticsWorkspace } from "../../../../components/semantics-workspace";
import { ProjectOnboarding } from "../../../../components/tenant-onboarding";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function SemanticsPage() {
  const context = await requireProtectedAppContext();
  return (
    <>
      {!context.project || !context.workspace ? (
        context.workspace ? (
          <ProjectOnboarding workspace={context.workspace} />
        ) : (
          <section className="panel panel-empty">
            <strong>Сначала создайте рабочую область</strong>
          </section>
        )
      ) : (
        <SemanticsWorkspace
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
