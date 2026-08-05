export type ToolAccess = "project";
export type ProjectToolWorkflow = "HTTP_STATUS_CHECK";

export interface ToolRuntime {
  readonly kind: "PROJECT_WORKFLOW";
  readonly workflow: ProjectToolWorkflow;
}

export interface ToolCapability {
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: "technical";
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
    runtime: { kind: "PROJECT_WORKFLOW", workflow: "HTTP_STATUS_CHECK" }
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
