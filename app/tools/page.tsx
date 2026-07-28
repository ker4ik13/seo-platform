import type { Metadata } from "next";
import { toolCapabilities } from "../../lib/tool-capabilities";

export const metadata: Metadata = {
  title: "Бесплатные SEO-инструменты",
  description:
    "Публичные инструменты для проверки URL, sitemap, сниппетов и ключевых фраз.",
  alternates: { canonical: "/tools" }
};

export default function ToolsPage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/ru">
          <span>S</span>SEO Workspace
        </a>
        <nav aria-label="Навигация Toolbox">
          <a href="/ru">Продукт</a>
          <a aria-current="page" href="/tools">Toolbox</a>
          <a href="/docs/api">API</a>
        </nav>
        <div className="header-actions">
          <a className="login" href="/app">Войти</a>
        </div>
      </header>

      <section className="public-section">
        <p className="eyebrow"><i />SEO Toolbox</p>
        <h1>Полезные проверки без лишней настройки</h1>
        <p className="public-lead">
          Начните с небольшой публичной проверки. После входа результат можно
          сохранить в проект, добавить в историю и запускать по расписанию.
        </p>

        <div className="tool-grid">
          {toolCapabilities
            .filter((tool) => tool.access !== "project")
            .map((tool) => (
              <a className="tool-card" href={`/tools/${tool.slug}`} key={tool.code}>
                <span>{tool.category}</span>
                <h2>{tool.title}</h2>
                <p>{tool.description}</p>
                <small>
                  {tool.asynchronous ? "Асинхронная проверка" : "Быстрый результат"} →
                </small>
              </a>
            ))}
        </div>
      </section>
    </main>
  );
}
