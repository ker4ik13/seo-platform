export const projectSemanticMutationEvent =
  "seo:project-semantic-mutation" as const;

type BrowserMutationMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function announceProjectSemanticMutation(projectId: string): void {
  if (typeof window === "undefined" || !UUID_PATTERN.test(projectId)) return;
  window.dispatchEvent(
    new CustomEvent(projectSemanticMutationEvent, { detail: { projectId } })
  );
}

export function announceSemanticMutationForRequest(
  path: string,
  method: BrowserMutationMethod
): void {
  const projectId = semanticMutationProjectId(path, method);
  if (projectId) announceProjectSemanticMutation(projectId);
}

export function semanticMutationProjectId(
  path: string,
  method: BrowserMutationMethod
): string | undefined {
  if (method === "GET") return undefined;
  const pathname = path.split(/[?#]/u, 1)[0] ?? "";
  const match = PROJECT_API_PATTERN.exec(pathname);
  if (!match) return undefined;
  const projectId = match[1] ?? "";
  const resource = match[2] ?? "";
  if (!UUID_PATTERN.test(projectId)) return undefined;

  if (/^keyword-groups(?:\/|$)/u.test(resource)) return projectId;
  if (
    method === "PATCH" &&
    resource === "semantic-group-color-legend"
  ) {
    return projectId;
  }
  if (/^keywords(?:\/|$)/u.test(resource)) {
    if (method === "POST" && /\/(?:search|bulk-preview)$/u.test(resource)) {
      return undefined;
    }
    return projectId;
  }
  if (/^bulk-commands(?:\/clean)?$/u.test(resource)) return projectId;
  if (/^(?:negative-keywords|semantic-duplicates)\/apply$/u.test(resource)) {
    return projectId;
  }
  if (/^semantic-versions\/[0-9a-f-]+\/undo$/u.test(resource)) {
    return projectId;
  }
  if (/^clustering-runs\/[0-9a-f-]+\/apply$/u.test(resource)) {
    return projectId;
  }
  if (/^keyword-research-runs\/[0-9a-f-]+\/confirm$/u.test(resource)) {
    return projectId;
  }
  if (
    /^clusters(?:\/|$)/u.test(resource) &&
    !resource.endsWith("-preview")
  ) {
    return projectId;
  }
  return undefined;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_API_PATTERN =
  /^\/app\/api\/(?:v1\/)?projects\/([^/]+)\/(.+)$/u;
