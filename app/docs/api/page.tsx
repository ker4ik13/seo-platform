import type { Metadata } from "next";
import { toolCapabilities } from "../../../lib/tool-capabilities";

export const metadata: Metadata = {
  title: "Документация публичного API",
  description:
    "Аутентификация, асинхронные задания и API всех SEO-инструментов платформы.",
  alternates: { canonical: "/docs/api" }
};

export default function ApiDocumentationPage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/ru"><span>S</span>SEO Workspace</a>
        <nav aria-label="Навигация документации">
          <a href="/tools">Toolbox</a>
          <a aria-current="page" href="/docs/api">API</a>
        </nav>
        <a className="login" href="/app">Войти</a>
      </header>

      <div className="docs-layout">
        <aside>
          <strong>API v1</strong>
          <a href="#quick-start">Быстрый старт</a>
          <a href="#tools">Инструменты</a>
          <a href="#jobs">Асинхронные задания</a>
          <a href="#errors">Ошибки</a>
        </aside>
        <article>
          <p className="eyebrow"><i />Public API</p>
          <h1>Один API для всех SEO-инструментов</h1>
          <p className="public-lead">
            Базовый API входит во все платные тарифы. UI и API используют
            одинаковые проверки прав, расчёт стоимости и модель заданий.
          </p>

          <section id="quick-start">
            <h2>Быстрый старт</h2>
            <pre><code>{`curl https://api.example.com/v1/tool-capabilities \\
  -H "Authorization: Bearer <token>"`}</code></pre>
          </section>

          <section id="tools">
            <h2>Инструменты</h2>
            <div className="api-list">
              {toolCapabilities.map((tool) => (
                <div key={tool.code}>
                  <code>{tool.code}</code>
                  <span>{tool.title}</span>
                </div>
              ))}
            </div>
          </section>

          <section id="jobs">
            <h2>Асинхронные задания</h2>
            <p>Estimate → approval → job → result. Команды идемпотентны.</p>
          </section>

          <section id="errors">
            <h2>Ошибки</h2>
            <p>Ответы используют единый код, request ID и retryable flag.</p>
          </section>
        </article>
      </div>
    </main>
  );
}
