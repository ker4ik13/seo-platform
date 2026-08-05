import type { Metadata } from "next";
import { AppShell } from "../../../../components/app-shell";
import { KeywordResearchConnectorSetup } from "../../../../components/keyword-research-connector-setup";
import { KeywordResearchWorkspace } from "../../../../components/keyword-research-workspace";
import { ProjectOnboarding } from "../../../../components/tenant-onboarding";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Конкуренты и сбор семантики",
  robots: { index: false, follow: false }
};

export default async function CompetitorsPage() {
  const context = await requireProtectedAppContext();
  return (
    <AppShell activeSection="competitors" context={context}>
      {!context.project || !context.workspace ? (
        context.workspace ? (
          <ProjectOnboarding workspace={context.workspace} />
        ) : (
          <section className="panel panel-empty">
            <strong>Сначала создайте рабочую область</strong>
          </section>
        )
      ) : (
        <>
          <section className="page-heading">
            <div>
              <h1>Конкуренты и сбор семантики</h1>
              <p>
                Получайте органические запросы конкурентов через собственный
                API-ключ Keys.so, проверяйте результат и добавляйте выбранное в
                семантическое ядро.
              </p>
            </div>
          </section>
          <KeywordResearchConnectorSetup projectId={context.project.id} />
          <KeywordResearchWorkspace
            projectDomain={context.project.domain}
            projectId={context.project.id}
          />
        </>
      )}
    </AppShell>
  );
}
