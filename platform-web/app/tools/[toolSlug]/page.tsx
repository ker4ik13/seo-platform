import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getToolCapability,
  publicToolCapabilities
} from "../../../lib/tool-capabilities";
import { PublicToolRunner } from "../../../components/public-tool-runner";

interface ToolPageProps {
  readonly params: Promise<{ toolSlug: string }>;
}

export function generateStaticParams() {
  return publicToolCapabilities()
    .map((tool) => ({ toolSlug: tool.slug }));
}

export async function generateMetadata({
  params
}: ToolPageProps): Promise<Metadata> {
  const { toolSlug } = await params;
  const tool = getToolCapability(toolSlug);
  if (!tool || tool.runtime.kind !== "PUBLIC_CLIENT") return {};

  return {
    title: tool.title,
    description: tool.description,
    alternates: { canonical: `/tools/${tool.slug}` }
  };
}

export default async function ToolPage({ params }: ToolPageProps) {
  const { toolSlug } = await params;
  const tool = getToolCapability(toolSlug);
  if (!tool || tool.runtime.kind !== "PUBLIC_CLIENT") notFound();

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/ru">
          <img alt="" aria-hidden="true" height={28} src="/brand/seonorita-mark.svg" width={28} />
          SEOньорита
        </a>
        <nav aria-label="Навигация Toolbox">
          <a href="/tools">Все инструменты</a>
          <a href="/docs/api">API</a>
        </nav>
        <a className="login" href="/app">Войти</a>
      </header>

      <section className="public-section tool-detail">
        <a className="back-link" href="/tools">← Toolbox</a>
        <h1>{tool.title}</h1>
        <p className="public-lead">{tool.description}</p>

        <PublicToolRunner renderer={tool.runtime.renderer} />
      </section>
    </main>
  );
}
