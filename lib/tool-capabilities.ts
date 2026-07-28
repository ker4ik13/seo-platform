export type ToolAccess = "anonymous" | "authenticated" | "project";

export interface ToolCapability {
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: "technical" | "semantics" | "serp";
  readonly access: ToolAccess;
  readonly asynchronous: boolean;
  readonly projectHistory: boolean;
}

export const toolCapabilities: readonly ToolCapability[] = [
  {
    code: "url.http_inspection.v1",
    slug: "http-status-checker",
    title: "Проверка HTTP-статуса",
    description:
      "Проверка ответа URL, цепочки редиректов и конечного адреса.",
    category: "technical",
    access: "anonymous",
    asynchronous: false,
    projectHistory: true
  },
  {
    code: "url.indexability_preview.v1",
    slug: "indexability-checker",
    title: "Проверка индексируемости",
    description:
      "Быстрая проверка robots, canonical, meta robots и HTTP-статуса.",
    category: "technical",
    access: "anonymous",
    asynchronous: false,
    projectHistory: true
  },
  {
    code: "sitemap.validation.v1",
    slug: "sitemap-validator",
    title: "Проверка sitemap",
    description:
      "Валидация sitemap.xml, URL, лимитов и базовых ошибок индексации.",
    category: "technical",
    access: "anonymous",
    asynchronous: true,
    projectHistory: true
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
    projectHistory: true
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
    projectHistory: true
  },
  {
    code: "semantics.clustering.v1",
    slug: "keyword-clustering",
    title: "Кластеризация запросов",
    description:
      "Группировка семантики по пересечению результатов поисковой выдачи.",
    category: "semantics",
    access: "project",
    asynchronous: true,
    projectHistory: true
  }
] as const;

export function getToolCapability(
  slug: string
): ToolCapability | undefined {
  return toolCapabilities.find((tool) => tool.slug === slug);
}
