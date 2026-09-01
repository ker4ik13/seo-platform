import type { Metadata } from "next";
import { ApiDocumentation } from "../../../components/api-documentation";
import { apiPublicOrigin } from "../../../lib/server-runtime-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Документация публичного API",
  description:
    "Быстрый старт, авторизация, запросы, ответы и справочник Public API v1 SEOньориты.",
  alternates: { canonical: "/docs/api" }
};

export default function ApiDocumentationPage() {
  return (
    <ApiDocumentation
      activeSection="quick-start"
      baseUrl={`${apiPublicOrigin()}/api/v1`}
    />
  );
}
