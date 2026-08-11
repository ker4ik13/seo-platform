import type { Metadata } from "next";
import { SettingsTabs } from "../../../../../../../components/settings-tabs";
import { TrackingContextSettingsPanel } from "../../../../../../../components/tracking-context-settings";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Контексты позиций",
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
          <h1>Контексты позиций</h1>
          <p>
            Сохраняйте папки, поисковик, регион, устройство и глубину для
            повторных проверок без ручной настройки.
          </p>
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
      <TrackingContextSettingsPanel projectId={project.id} />
    </>
  );
}
