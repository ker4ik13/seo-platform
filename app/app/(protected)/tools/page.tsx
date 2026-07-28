import { AppShell } from "../../../../components/app-shell";
import { requireProtectedAppContext } from "../../../../lib/protected-app";
import { toolCapabilities } from "../../../../lib/tool-capabilities";

export default async function ProjectToolsPage() {
  const context = await requireProtectedAppContext();

  return (
    <AppShell activeSection="tools" context={context}>
      <section className="page-heading">
        <div>
          <p className="eyebrow">
            {context.project
              ? `Проект · ${context.project.name}`
              : "Проект не выбран"}
          </p>
          <h1>Инструменты</h1>
          <p>
            Запуски сохраняются в проекте вместе с источником, стоимостью и
            историей.
          </p>
        </div>
      </section>

      {!context.project ? (
        <section className="panel panel-empty">
          <strong>Сначала создайте или выберите проект</strong>
          <p>
            Публичный Toolbox доступен без проекта, но история и настройки
            запуска сохраняются только здесь.
          </p>
          <a className="primary-button" href="/tools">
            Открыть публичный Toolbox
          </a>
        </section>
      ) : (
        <section className="project-tool-grid" aria-label="Инструменты проекта">
          {toolCapabilities.map((tool) => (
            <article className="panel project-tool-card" key={tool.code}>
              <span>{tool.category}</span>
              <h2>{tool.title}</h2>
              <p>{tool.description}</p>
              <button
                className="primary-button"
                disabled
                title="Backend capability ещё не опубликована"
                type="button"
              >
                Настроить запуск
              </button>
            </article>
          ))}
        </section>
      )}
    </AppShell>
  );
}
