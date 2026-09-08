import type { Metadata } from "next";
import { KeywordResearchConnectorSetup } from "../../../../components/keyword-research-connector-setup";
import { KeywordResearchWorkspace } from "../../../../components/keyword-research-workspace";
import { ProjectOnboarding } from "../../../../components/tenant-onboarding";
import { WordstatExpansionConnectorSetup } from "../../../../components/wordstat-expansion-connector-setup";
import { requireProtectedAppContext } from "../../../../lib/protected-app";
import { UiText } from "../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Keys.so и Wordstat",
  robots: { index: false, follow: false }
};

export default async function CompetitorsPage() {
  const context = await requireProtectedAppContext();
  return (
    <>
      {!context.project || !context.workspace ? (
        context.workspace ? (
          <ProjectOnboarding workspace={context.workspace} />
        ) : (
          <section className="panel panel-empty">
            <strong><UiText text="Сначала создайте рабочую область" /></strong>
          </section>
        )
      ) : (
        <>
          <section className="page-heading">
            <div>
              <h1><UiText text="Keys.so и Wordstat" /></h1>
              <p>
                <UiText text="Анализируйте домены в Keys.so и расширяйте выбранные запросы через Wordstat, не покидая проект." /></p>
            </div>
          </section>
          <KeywordResearchConnectorSetup projectId={context.project.id} />
          <WordstatExpansionConnectorSetup projectId={context.project.id} />
          <KeywordResearchWorkspace
            projectDomain={context.project.domain}
            projectId={context.project.id}
            projectSearchCity={context.project.searchCity}
            workspaceId={context.workspace.id}
          />
        </>
      )}
    </>
  );
}
