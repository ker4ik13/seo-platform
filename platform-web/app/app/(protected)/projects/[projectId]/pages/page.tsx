import type { Metadata } from "next";
import { AppShell } from "../../../../../../components/app-shell";
import { ProjectPageMap } from "../../../../../../components/project-page-map";
import { ProjectCrawlAudit } from "../../../../../../components/project-crawl-audit";
import { requireProtectedProjectAppContext } from "../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Карта страниц",
  robots: {
    index: false,
    follow: false
  }
};

export default async function ProjectPagesPage({
  params
}: Readonly<{
  params: Promise<{ readonly projectId: string }>;
}>) {
  const { projectId } = await params;
  const context = await requireProtectedProjectAppContext(projectId);
  const project = context.project;
  const workspace = context.workspace;
  if (!project || !workspace) {
    throw new Error("Project workspace context is missing");
  }
  return (
    <AppShell
      activeSection="pages"
      context={{ ...context, project, workspace }}
    >
      <nav aria-label="Хлебные крошки" className="app-breadcrumbs">
        <a href="/app">Проекты</a>
        <span aria-hidden="true">/</span>
        <span>{project.name}</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Карта страниц</span>
      </nav>
      <section className="page-heading tracking-context-heading">
        <div>
          <p className="eyebrow">Страницы · {project.name}</p>
          <h1>Карта страниц</h1>
          <p>
            Ведите существующие и планируемые URL, canonical и алиасы,
            метаданные, индексируемость, владельцев и привязку семантики в
            одном tenant-safe реестре.
          </p>
        </div>
      </section>
      <ProjectPageMap key={project.id} projectId={project.id} />
      <ProjectCrawlAudit
        projectDomain={project.domain}
        projectId={project.id}
      />
    </AppShell>
  );
}
