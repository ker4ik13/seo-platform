import type { Metadata } from "next";
import { AppShell } from "../../../../../../../components/app-shell";
import { RankAutomations } from "../../../../../../../components/rank-automations";
import { RankingsTabs } from "../../../../../../../components/rankings-tabs";
import { requireProtectedProjectAppContext } from "../../../../../../../lib/protected-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Автоматизация съёма позиций",
  robots: {
    index: false,
    follow: false
  }
};

export default async function RankAutomationsPage({
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
        <span aria-current="page">Автоматизация</span>
      </nav>
      <section className="page-heading tracking-context-heading">
        <div>
          <p className="eyebrow">Позиции · {project.name}</p>
          <h1>Автоматизация съёма</h1>
          <p>
            Запускайте съём вручную или по расписанию с ограничением объёма,
            защитой от параллельных запусков и автоматической паузой при
            повторных ошибках.
          </p>
        </div>
      </section>
      <RankingsTabs active="automations" projectId={project.id} />
      <RankAutomations
        key={project.id}
        projectId={project.id}
      />
    </AppShell>
  );
}
