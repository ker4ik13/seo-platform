import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiDocumentation } from "../../../../components/api-documentation";
import {
  apiDocHref,
  apiDocSection,
  apiDocSections
} from "../../../../lib/api-docs";
import { apiPublicOrigin } from "../../../../lib/server-runtime-origin";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly section: string }>;
}

export function generateStaticParams() {
  return apiDocSections
    .filter(({ slug }) => slug !== "quick-start")
    .map(({ slug }) => ({ section: slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { section: rawSection } = await params;
  const section = apiDocSection(rawSection);
  if (!section) return {};

  return {
    title: `${section.title} — документация API`,
    description: section.description,
    alternates: { canonical: apiDocHref(section.slug) }
  };
}

export default async function ApiDocumentationSectionPage({ params }: PageProps) {
  const { section: rawSection } = await params;
  const section = apiDocSection(rawSection);
  if (!section) notFound();

  return (
    <ApiDocumentation
      activeSection={section.slug}
      baseUrl={`${apiPublicOrigin()}/api/v1`}
    />
  );
}
