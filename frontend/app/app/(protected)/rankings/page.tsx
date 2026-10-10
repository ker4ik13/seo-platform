import type { Metadata } from "next";
import { RankingsWorkspace } from "../../../../components/rankings-workspace";
import { ProjectOnboarding } from "../../../../components/tenant-onboarding";
import { requireProtectedAppContext } from "../../../../lib/protected-app";
import { UiText } from "../../../../components/ui-locale";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Позиции",
  robots: {
    index: false,
    follow: false
  }
};

export default async function RankingsPage() {
  const context = await requireProtectedAppContext();
  if (!context.project || !context.workspace) {
    return context.workspace ? (
      <ProjectOnboarding currentUserId={context.user.id} workspace={context.workspace} {...(context.projectCapabilities ? { capabilities: context.projectCapabilities } : {})} />
    ) : (
      <section className="panel panel-empty">
        <strong><UiText text="Сначала создайте рабочую область" /></strong>
      </section>
    );
  }
  return (
    <RankingsWorkspace
          {...(context.project.onboarding ? { onboarding: context.project.onboarding } : {})}
      currentUserId={context.user.id}
      projectDomain={context.project.domain}
      projectId={context.project.id}
      {...(context.project.searchCity
        ? { projectSearchCity: context.project.searchCity }
        : {})}
      workspaceId={context.workspace.id}
    />
  );
}
