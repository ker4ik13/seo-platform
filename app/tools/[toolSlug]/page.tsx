import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getToolCapability,
  toolCapabilities
} from "../../../lib/tool-capabilities";

interface ToolPageProps {
  readonly params: Promise<{ toolSlug: string }>;
}

export function generateStaticParams() {
  return toolCapabilities
    .filter((tool) => tool.access !== "project")
    .map((tool) => ({ toolSlug: tool.slug }));
}

export async function generateMetadata({
  params
}: ToolPageProps): Promise<Metadata> {
  const { toolSlug } = await params;
  const tool = getToolCapability(toolSlug);
  if (!tool || tool.access === "project") return {};

  return {
    title: tool.title,
    description: tool.description,
    alternates: { canonical: `/tools/${tool.slug}` }
  };
}

export default async function ToolPage({ params }: ToolPageProps) {
  const { toolSlug } = await params;
  const tool = getToolCapability(toolSlug);
  if (!tool || tool.access === "project") notFound();

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/ru"><span>S</span>SEO Workspace</a>
        <nav aria-label="Навигация Toolbox">
          <a href="/tools">Все инструменты</a>
          <a href="/docs/api">API</a>
        </nav>
        <a className="login" href="/app">Войти</a>
      </header>

      <section className="public-section tool-detail">
        <a className="back-link" href="/tools">← Toolbox</a>
        <p className="eyebrow"><i />{tool.category}</p>
        <h1>{tool.title}</h1>
        <p className="public-lead">{tool.description}</p>

        <div className="tool-placeholder">
          <div>
            <strong>Capability</strong>
            <code>{tool.code}</code>
          </div>
          <p>
            UI запуска будет подключён к общему API handler. Временный
            публичный результат получит noindex и ограниченный срок хранения.
          </p>
          <button disabled type="button">Скоро доступно</button>
        </div>
      </section>
    </main>
  );
}
