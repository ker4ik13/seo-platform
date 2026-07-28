import { AppShell } from "../../../components/app-shell";
import { toolCapabilities } from "../../../lib/tool-capabilities";

export default function ProjectToolsPage() {
  return (
    <AppShell activeSection="tools">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Проект · Promsoyuz</p>
          <h1>Инструменты</h1>
          <p>Запуски сохраняются в проекте вместе с источником и историей.</p>
        </div>
      </section>

      <section className="project-tool-grid" aria-label="Инструменты проекта">
        {toolCapabilities.map((tool) => (
          <article className="panel project-tool-card" key={tool.code}>
            <span>{tool.category}</span>
            <h2>{tool.title}</h2>
            <p>{tool.description}</p>
            <button className="primary-button" disabled type="button">
              Настроить запуск
            </button>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
