import type { Metadata } from "next";
import { AppShell } from "../../../../../../components/app-shell";
import { RankHistory } from "../../../../../../components/rank-history";
import { RankingsTabs } from "../../../../../../components/rankings-tabs";
import { requireProtectedProjectAppContext } from "../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "История позиций",
  robots: {
    index: false,
    follow: false
  }
};

export default async function RankHistoryPage({
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
      activeSection="positions"
      context={{ ...context, project, workspace }}
    >
      <nav aria-label="Хлебные крошки" className="app-breadcrumbs">
        <a href="/app">Проекты</a>
        <span aria-hidden="true">/</span>
        <span>{project.name}</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">История позиций</span>
      </nav>
      <section className="page-heading tracking-context-heading">
        <div>
          <p className="eyebrow">Позиции · {project.name}</p>
          <h1>История позиций</h1>
          <p>
            Просматривайте сохранённые снимки по контексту, запросу и
            календарному диапазону UTC. История не переписывается при изменении
            настроек.
          </p>
        </div>
      </section>
      <RankingsTabs active="history" projectId={project.id} />
      <RankHistory
        key={project.id}
        projectId={project.id}
        projectStatus={project.status}
        workspaceStatus={workspace.status}
      />
    </AppShell>
  );
}
