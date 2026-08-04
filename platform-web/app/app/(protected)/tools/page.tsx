import { AppShell } from "../../../../components/app-shell";
import { Icon, type IconName } from "../../../../components/icon";
import { ProviderLogo } from "../../../../components/provider-logo";
import { requireProtectedAppContext } from "../../../../lib/protected-app";
import {
  toolCapabilities,
  toolProjectHref
} from "../../../../lib/tool-capabilities";

export default async function ProjectToolsPage() {
  const context = await requireProtectedAppContext();
  const project = context.project;

  return (
    <AppShell activeSection="tools" context={context}>
      <section className="page-heading">
        <div>
          <h1>Инструменты</h1>
          <p>
            Проектные фоновые запуски сохраняются вместе с источником,
            стоимостью, результатом и историей; локальные проверки выполняются
            сразу в браузере.
          </p>
        </div>
      </section>

      {!project ? (
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
        <div className="tools-workspace">
          <section className="tools-primary-grid" aria-label="Основные SEO-процессы">
            <a className="tool-workflow-card featured" href="/app/semantics">
              <span className="tool-workflow-icon"><Icon name="semantic" /></span>
              <div><strong>Семантическое ядро</strong><p>Запросы, группы, частотность, кластеры и массовые операции.</p></div>
              <b>Открыть →</b>
            </a>
            <a className="tool-workflow-card" href="/app/semantics">
              <ProviderLogo provider="ARSENKIN" />
              <div><strong>Проверка позиций</strong><p>Съём Яндекс и Google по выбранным запросам и папкам семантики.</p></div>
              <b>Открыть →</b>
            </a>
            <a className="tool-workflow-card" href={`/app/projects/${encodeURIComponent(project.id)}/pages`}>
              <span className="tool-workflow-icon"><Icon name="pages" /></span>
              <div><strong>Карта страниц и аудит</strong><p>Индексируемость, дубли, технические проблемы и радар.</p></div>
              <b>Открыть →</b>
            </a>
            <a className="tool-workflow-card" href="/app/competitors">
              <ProviderLogo provider="KEYS_SO" />
              <div><strong>Конкуренты</strong><p>Сбор доменов и поисковой семантики через Keys.so.</p></div>
              <b>Открыть →</b>
            </a>
          </section>

          <section className="tools-section-heading">
            <div><h2>Дополнительные инструменты</h2><p>Рабочие проектные процессы и локальные проверки без заглушек.</p></div>
            <a className="secondary-button" href="/app/tasks">История операций</a>
          </section>
          <section className="project-tool-grid" aria-label="Быстрые инструменты">
            {toolCapabilities.map((tool) => (
              <a
                className="panel project-tool-card"
                href={toolProjectHref(tool, project.id)}
                key={tool.code}
              >
                <div className="project-tool-card-heading">
                  <span className="tool-workflow-icon"><Icon name={toolIcon(tool.code)} /></span>
                  <span>{categoryLabel(tool.category)}</span>
                </div>
                <h2>{tool.title}</h2>
                <p>{tool.description}</p>
                <b>{tool.asynchronous ? "Фоновый запуск" : "Мгновенная проверка"} →</b>
              </a>
            ))}
          </section>
          <aside className="tools-api-strip">
            <div className="tools-provider-logos" aria-label="Поддерживаемые SEO API">
              <ProviderLogo provider="XMLSTOCK" size="compact" />
              <ProviderLogo provider="ARSENKIN" size="compact" />
              <ProviderLogo provider="KEYS_SO" size="compact" />
            </div>
            <div><strong>Подключения SEO API</strong><span>XMLStock, Arsenkin Tools и Keys.so используются в реальных проектных процессах.</span></div>
            <a className="secondary-button" href="/app/settings/integrations">Управлять ключами</a>
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function categoryLabel(category: (typeof toolCapabilities)[number]["category"]): string {
  if (category === "technical") return "Техническое SEO";
  if (category === "semantics") return "Семантика";
  return "SERP";
}

function toolIcon(code: string): IconName {
  if (code === "url.http_inspection.v1") return "http";
  if (code === "url.indexability_preview.v1") return "indexability";
  if (code === "sitemap.validation.v1") return "sitemap";
  if (code === "semantics.keyword_cleanup.v1") return "clean";
  if (code === "serp.snippet_preview.v1") return "serp";
  if (code === "semantics.clustering.v1") return "cluster";
  return "tools";
}
