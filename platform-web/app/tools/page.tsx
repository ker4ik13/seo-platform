import type { Metadata } from "next";
import { publicToolCapabilities } from "../../lib/tool-capabilities";

export const metadata: Metadata = {
  title: "Бесплатные SEO-инструменты",
  description:
    "Публичные инструменты для очистки ключевых фраз и предпросмотра поисковых сниппетов.",
  alternates: { canonical: "/tools" }
};

export default function ToolsPage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/ru">
          <img alt="" aria-hidden="true" height={28} src="/brand/seonorita-mark.svg" width={28} />
          SEOньорита
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
        <h1>Полезные проверки без лишней настройки</h1>
        <p className="public-lead">
          Локальные проверки работают прямо в браузере и не отправляют введённые
          данные в проект. Фоновые SEO-процессы и их история доступны после входа.
        </p>

        <div className="tool-grid">
          {publicToolCapabilities().map((tool) => (
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
