export type ToolAccess = "anonymous" | "authenticated" | "project";

export type PublicToolRenderer = "KEYWORD_CLEANER" | "SERP_SNIPPET_PREVIEW";
export type ProjectToolWorkflow = "SEMANTICS" | "PAGE_MAP";

export type ToolRuntime =
  | {
      readonly kind: "PUBLIC_CLIENT";
      readonly renderer: PublicToolRenderer;
    }
  | {
      readonly kind: "PROJECT_WORKFLOW";
      readonly workflow: ProjectToolWorkflow;
    };

export interface ToolCapability {
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: "technical" | "semantics" | "serp";
  readonly access: ToolAccess;
  readonly asynchronous: boolean;
  readonly projectHistory: boolean;
  readonly runtime: ToolRuntime;
}

export const toolCapabilities: readonly ToolCapability[] = [
  {
    code: "url.http_inspection.v1",
    slug: "http-status-checker",
    title: "Проверка HTTP-статуса",
    description:
      "Проверка ответа URL, цепочки редиректов и конечного адреса.",
    category: "technical",
    access: "project",
    asynchronous: true,
    projectHistory: true,
    runtime: { kind: "PROJECT_WORKFLOW", workflow: "PAGE_MAP" }
  },
  {
    code: "url.indexability_preview.v1",
    slug: "indexability-checker",
    title: "Проверка индексируемости",
    description:
      "Быстрая проверка robots, canonical, meta robots и HTTP-статуса.",
    category: "technical",
    access: "project",
    asynchronous: true,
    projectHistory: true,
    runtime: { kind: "PROJECT_WORKFLOW", workflow: "PAGE_MAP" }
  },
  {
    code: "sitemap.validation.v1",
    slug: "sitemap-validator",
    title: "Проверка sitemap",
    description:
      "Валидация sitemap.xml, URL, лимитов и базовых ошибок индексации.",
    category: "technical",
    access: "project",
    asynchronous: true,
    projectHistory: true,
    runtime: { kind: "PROJECT_WORKFLOW", workflow: "PAGE_MAP" }
  },
  {
    code: "semantics.keyword_cleanup.v1",
    slug: "keyword-cleaner",
    title: "Очистка ключевых фраз",
    description:
      "Нормализация строк, удаление явных дублей и базовая статистика.",
    category: "semantics",
    access: "anonymous",
    asynchronous: false,
    projectHistory: false,
    runtime: { kind: "PUBLIC_CLIENT", renderer: "KEYWORD_CLEANER" }
  },
  {
    code: "serp.snippet_preview.v1",
    slug: "serp-snippet-preview",
    title: "SERP snippet preview",
    description:
      "Предпросмотр заголовка, описания и URL в поисковом сниппете.",
    category: "serp",
    access: "anonymous",
    asynchronous: false,
    projectHistory: false,
    runtime: { kind: "PUBLIC_CLIENT", renderer: "SERP_SNIPPET_PREVIEW" }
  },
  {
    code: "semantics.clustering.v1",
    slug: "keyword-clustering",
    title: "Кластеризация запросов",
    description:
      "Создание, объединение и ручная проверка кластеров семантики.",
    category: "semantics",
    access: "project",
    asynchronous: false,
    projectHistory: false,
    runtime: { kind: "PROJECT_WORKFLOW", workflow: "SEMANTICS" }
  }
] as const;

export function getToolCapability(
  slug: string
): ToolCapability | undefined {
  return toolCapabilities.find((tool) => tool.slug === slug);
}

export function publicToolCapabilities(): readonly ToolCapability[] {
  return toolCapabilities.filter(
    (tool) => tool.runtime.kind === "PUBLIC_CLIENT"
  );
}

export function toolProjectHref(
  tool: ToolCapability,
  projectId: string
): string {
  if (tool.runtime.kind === "PUBLIC_CLIENT") {
    return `/tools/${encodeURIComponent(tool.slug)}`;
  }
  if (tool.runtime.workflow === "SEMANTICS") return "/app/semantics";
  return `/app/projects/${encodeURIComponent(projectId)}/pages`;
}
