import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SEO-инструменты",
  description:
    "Проектные SEO-проверки с фоновым выполнением и сохранением истории.",
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
        <h1>SEO-проверки с сохранением результата</h1>
        <p className="public-lead">
          Инструменты работают с выбранным проектом, выполняются в фоне и
          сохраняют прогресс в истории операций. Для запуска войдите в приложение.
        </p>

        <div className="tool-grid">
          <a className="tool-card" href="/app/tools">
            <span>Техническое SEO</span>
            <h2>Проверка HTTP-статусов</h2>
            <p>
              Обход URL, sitemap и внутренних ссылок с цепочками редиректов,
              фильтрами и отдельной страницей результата.
            </p>
            <small>Войти и открыть инструменты →</small>
          </a>
        </div>
      </section>
    </main>
  );
}
