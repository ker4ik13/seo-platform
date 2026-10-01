export type ToolAccess = "project";
export type ProjectToolWorkflow = "HTTP_STATUS_CHECK" | "SERP_WORKBENCH";

export interface ToolRuntime {
  readonly kind: "PROJECT_WORKFLOW";
  readonly workflow: ProjectToolWorkflow;
}

export interface ToolCapability {
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: "technical" | "research";
  readonly access: ToolAccess;
  readonly asynchronous: boolean;
  readonly projectHistory: boolean;
  readonly runtime: ToolRuntime;
}

export const toolCapabilities: readonly ToolCapability[] = [
  {
    code: "url.http_inspection.v1",
    slug: "http-status-checker",
    title: "Обход сайта",
    description:
      "Обход сайта, проверка ответов и построение карты страниц.",
    category: "technical",
    access: "project",
    asynchronous: true,
    projectHistory: true,
    runtime: { kind: "PROJECT_WORKFLOW", workflow: "HTTP_STATUS_CHECK" }
  },
  {
    code: "serp.comparison.v1",
    slug: "serp",
    title: "Поисковая выдача",
    description:
      "Сравнение сохранённой выдачи по городам, поисковикам и устройствам с подсветкой доменов.",
    category: "research",
    access: "project",
    asynchronous: false,
    projectHistory: false,
    runtime: { kind: "PROJECT_WORKFLOW", workflow: "SERP_WORKBENCH" }
  }
] as const;

export function getToolCapability(
  slug: string
): ToolCapability | undefined {
  return toolCapabilities.find((tool) => tool.slug === slug);
}

export function projectToolCapabilities(): readonly ToolCapability[] {
  return toolCapabilities;
}

export function toolProjectHref(
  tool: ToolCapability,
  projectId: string
): string {
  return `/app/projects/${encodeURIComponent(projectId)}/tools/${encodeURIComponent(tool.slug)}`;
}
