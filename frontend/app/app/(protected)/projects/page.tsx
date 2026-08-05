import { AppShell } from "../../../../components/app-shell";
import { ProjectCatalog } from "../../../../components/project-catalog";
import { requireProtectedAppContext } from "../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const context = await requireProtectedAppContext();

  return (
    <AppShell activeSection="projects" context={context}>
      <section className="page-heading project-catalog-heading">
        <div>
          <h1>Проекты</h1>
          <p>Домены, доступ команды и все рабочие контуры SEO в одном месте.</p>
        </div>
      </section>
      {!context.workspace ? (
        <section className="panel panel-empty compact">
          <strong>Сначала создайте рабочую область</strong>
          <p>Проекты принадлежат workspace и наследуют его команду и тариф.</p>
          <a className="primary-button" href="/app">Перейти к созданию</a>
        </section>
      ) : (
        <ProjectCatalog
          {...(context.project ? { activeProjectId: context.project.id } : {})}
          projects={context.projects}
          workspace={context.workspace}
        />
      )}
    </AppShell>
  );
}
