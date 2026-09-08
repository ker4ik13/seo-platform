import { ProjectCatalog } from "../../../../components/project-catalog";
import { requireProtectedAppContext } from "../../../../lib/protected-app";
import { UiText } from "../../../../components/ui-locale";


export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams
}: Readonly<{
  searchParams: Promise<{ readonly create?: string }>;
}>) {
  const context = await requireProtectedAppContext();
  const query = await searchParams;

  return (
    <>
      <section className="page-heading project-catalog-heading">
        <div>
          <h1><UiText text="Проекты" /></h1>
          <p><UiText text="Домены, доступ команды и все рабочие контуры SEO в одном месте." /></p>
        </div>
      </section>
      {!context.workspace ? (
        <section className="panel panel-empty compact">
          <strong><UiText text="Сначала создайте рабочую область" /></strong>
          <p><UiText text="Проекты принадлежат workspace и наследуют его команду и тариф." /></p>
          <a className="primary-button" href="/app"><UiText text="Перейти к созданию" /></a>
        </section>
      ) : (
        <ProjectCatalog
          {...(context.project ? { activeProjectId: context.project.id } : {})}
          {...(context.projectCapabilities
            ? { capabilities: context.projectCapabilities }
            : {})}
          initialCreateOpen={query.create === "1"}
          projects={context.projects}
          workspace={context.workspace}
        />
      )}
    </>
  );
}
