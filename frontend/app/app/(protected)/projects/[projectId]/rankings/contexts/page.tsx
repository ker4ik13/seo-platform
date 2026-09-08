import type { Metadata } from "next";
import { SettingsTabs } from "../../../../../../../components/settings-tabs";
import { TrackingContextSettingsPanel } from "../../../../../../../components/tracking-context-settings";
import { RankAutomationPanel } from "../../../../../../../components/rank-automation-panel";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";
import { UiText } from "../../../../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Съём позиций",
  robots: {
    index: false,
    follow: false
  }
};

export default async function TrackingContextsPage({
  params
}: Readonly<{
  params: Promise<{ readonly projectId: string }>;
}>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  const project = context.project;
  if (!project) throw new Error("Project context is missing");
  return (
    <>
      <section className="page-heading">
        <div>
          <h1><UiText text="Съём позиций" /></h1>
          <p>
            <UiText text="Настраивайте профили запуска, запускайте съём позже или создавайте регулярные проверки по расписанию." /></p>
        </div>
      </section>
      <SettingsTabs
        active="ranking-contexts"
        {...(project.projectAccessLevel
          ? { projectAccessLevel: project.projectAccessLevel }
          : {})}
        projectId={project.id}
        workspaceRoleCode={context.workspace?.roleCode}
      />
      <div className="ranking-contexts-settings-stack">
        <RankAutomationPanel projectId={project.id} />
        <TrackingContextSettingsPanel projectId={project.id} />
      </div>
    </>
  );
}
