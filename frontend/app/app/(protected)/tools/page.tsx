import type { ReactNode } from "react";
import { Icon, type IconName } from "../../../../components/icon";
import { requireProtectedAppContext } from "../../../../lib/protected-app";
import {
  projectToolCapabilities,
  toolProjectHref,
  type ToolCapability
} from "../../../../lib/tool-capabilities";

export default async function ProjectToolsPage() {
  const context = await requireProtectedAppContext();
  const project = context.project;
  const projectTools = projectToolCapabilities();

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>Инструменты</h1>
          <p>
            Запускайте проектные проверки в фоне и возвращайтесь к результатам
            в истории операций.
          </p>
        </div>
        <a className="secondary-button tools-history-button" href="/app/tasks">
          История операций
        </a>
      </section>

      <div className="tools-workspace">
        <ToolSection
          description="Работают с выбранным сайтом, соблюдают его лимиты и сохраняют прогресс."
          title="Внутри проекта"
        >
          {projectTools.map((tool) =>
            project ? (
              <ToolCard
                href={toolProjectHref(tool, project.id)}
                key={tool.code}
                tool={tool}
              />
            ) : (
              <ToolCard
                href="/app/settings/projects"
                key={tool.code}
                note="Сначала выберите проект"
                tool={tool}
              />
            )
          )}
        </ToolSection>
      </div>
    </>
  );
}

function ToolSection({
  children,
  description,
  title
}: Readonly<{
  children: ReactNode;
  description: string;
  title: string;
}>) {
  return (
    <section className="tools-catalog-section">
      <header className="tools-section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="project-tool-grid">{children}</div>
    </section>
  );
}

function ToolCard({
  href,
  note,
  tool
}: Readonly<{
  href: string;
  note?: string;
  tool: ToolCapability;
}>) {
  return (
    <a className="panel project-tool-card" href={href}>
      <div className="project-tool-card-heading">
        <span className="tool-workflow-icon">
          <Icon name={toolIcon(tool.code)} />
        </span>
        <span>Техническое SEO</span>
      </div>
      <h2>{tool.title}</h2>
      <p>{tool.description}</p>
      <span className="project-tool-card-action">
        {note ?? "Открыть проверку"}
        <span aria-hidden="true">→</span>
      </span>
    </a>
  );
}

function toolIcon(code: string): IconName {
  if (code === "url.http_inspection.v1") return "http";
  return "tools";
}
