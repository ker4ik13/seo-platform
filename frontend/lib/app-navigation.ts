export type AppNavigationSection =
  | "competitors"
  | "serp"
  | "crawl"
  | "notifications"
  | "notes"
  | "overview"
  | "pages"
  | "projects"
  | "rankings"
  | "semantics"
  | "settings"
  | "tasks"
  | "tools";

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Keep the current screen, dropping filters bound to the previous project. */
export function projectSwitchHref(pathname: string, projectId?: string): string {
  if (!pathname.startsWith("/app/") || !projectId) return "/app";
  // A result/note ID cannot be reused in another project's detail screen.
  if (/^\/app\/tasks\/[^/]+\/[^/]+/u.test(pathname)) return "/app/tasks";
  if (/^\/app\/projects\/[^/]+\/notes\/[^/]+/u.test(pathname)) {
    return `/app/projects/${encodeURIComponent(projectId)}/notes`;
  }
  if (/^\/app\/projects\/[^/]+\//u.test(pathname)) {
    return pathname.replace(/^\/app\/projects\/[^/]+/u, `/app/projects/${encodeURIComponent(projectId)}`);
  }
  return pathname;
}

interface NavigationStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const lastWorkspaceProjectStoragePrefix =
  "seonorita:last-workspace-project:v1:";

export function shouldShowWorkspaceCreationAction(
  currentUserId: string,
  workspaces: readonly Readonly<{
    owner: Readonly<{ userId: string }>;
  }>[]
): boolean {
  return !workspaces.some(
    (workspace) => workspace.owner.userId === currentUserId
  );
}

export function readLastWorkspaceProjectId(
  storage: NavigationStorage,
  currentUserId: string,
  workspaceId: string
): string | undefined {
  const key = lastWorkspaceProjectStorageKey(currentUserId, workspaceId);
  if (!key) return undefined;
  try {
    const projectId = storage.getItem(key);
    return projectId && PROJECT_ID_PATTERN.test(projectId)
      ? projectId
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeLastWorkspaceProjectId(
  storage: NavigationStorage,
  currentUserId: string,
  workspaceId: string,
  projectId: string | undefined
): void {
  const key = lastWorkspaceProjectStorageKey(currentUserId, workspaceId);
  if (!key) return;
  try {
    if (projectId && PROJECT_ID_PATTERN.test(projectId)) {
      storage.setItem(key, projectId);
    } else {
      storage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function resolveWorkspaceProjectPreference<
  Project extends Readonly<{ id: string }>
>(
  projects: readonly Project[],
  preferredProjectId: string | undefined
): Project | undefined {
  return (
    projects.find(({ id }) => id === preferredProjectId) ?? projects[0]
  );
}

export function appNavigationSection(
  pathname: string | null | undefined
): AppNavigationSection {
  const segments = appPathSegments(pathname);
  if (segments.length === 1) return "overview";
  if (segments[1] === "settings") return "settings";
  if (segments[1] === "semantics") return "semantics";
  if (segments[1] === "rankings") return "rankings";
  if (segments[1] === "tasks") return "tasks";
  if (segments[1] === "tools") return "tools";
  if (segments[1] === "competitors") return "competitors";
  if (segments[1] === "notifications") return "notifications";
  if (segments[1] !== "projects") return "overview";
  if (segments.length === 2) return "projects";
  if (segments[3] === "settings") return "settings";
  if (segments[3] === "tools" && segments[4] === "serp") return "serp";
  if (segments[3] === "tools" && segments[4] === "http-status-checker") return "crawl";
  if (segments[3] === "tools") return "tools";
  if (segments[3] === "pages") return "pages";
  if (segments[3] === "notes") return "notes";
  if (segments[3] === "rankings" && segments[4] === "contexts") {
    return "settings";
  }
  if (segments[3] === "rankings") return "rankings";
  return "projects";
}

export function appProjectIdFromPath(
  pathWithOptionalQuery: string | null | undefined
): string | undefined {
  const segments = appPathSegments(pathWithOptionalQuery);
  const candidate = segments[1] === "projects" ? segments[2] : undefined;
  return candidate && PROJECT_ID_PATTERN.test(candidate) ? candidate : undefined;
}

function appPathSegments(value: string | null | undefined): readonly string[] {
  const pathname = (value ?? "").split(/[?#]/u, 1)[0] ?? "";
  return pathname.split("/").filter(Boolean).map(safeDecodePathSegment);
}

function lastWorkspaceProjectStorageKey(
  currentUserId: string,
  workspaceId: string
): string | undefined {
  if (
    !PROJECT_ID_PATTERN.test(currentUserId) ||
    !PROJECT_ID_PATTERN.test(workspaceId)
  ) {
    return undefined;
  }
  return `${lastWorkspaceProjectStoragePrefix}${currentUserId}:${workspaceId}`;
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
